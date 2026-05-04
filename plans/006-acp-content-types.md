# Plan: Support ACP Content Types (Text, Image, Resource, Resource Link)

## Context

ACP specifies five content block types: `text`, `image`, `audio`, `resource`, and `resource_link`. Currently the Pi ACP adapter only supports `text`. The user wants support for all types **except audio**.

## Investigation Summary

### How Pi handles images

- Pi's `AgentSession.prompt(text, options?: { images?: ImageContent[] })` accepts images as a separate array.
- Pi's `sendUserMessage(content: string | (TextContent | ImageContent)[], ...)` also accepts mixed content, but internally normalizes it back to `text + images` array — **interleaving is NOT preserved**.
- Pi's user message construction puts all text blocks first, then all image blocks.
- Pi's `ImageContent` shape is `{ type: "image", data: string, mimeType: string }` — compatible with ACP's `ImageContent`.

### Does Pi know if the current model supports images?

- **Yes.** Every Pi `Model` has `input: ("text" | "image")[]`.
- Models like `amazon.nova-pro-v1:0` advertise `["text", "image"]`; `amazon.nova-micro-v1:0` advertises `["text"]` only.
- Pi does NOT validate this at runtime — it forwards images to the provider regardless. The provider errors if the model doesn't support vision.

### Pi output limitations

- Pi `AssistantMessage.content` only contains `TextContent | ThinkingContent | ToolCall`.
- Pi never produces `image`, `audio`, `resource`, or `resource_link` output.
- Therefore **output-side changes are minimal** — we only need to handle input content types.

## Approach

### 1. Prompt ingestion (`src/pi-acp-agent.ts`)

Replace the current `extractPromptText()` with a richer `convertPromptContent()` that returns:

- `text: string` — concatenated text from `text`, `resource` (text), and `resource_link` blocks
- `images: ImageContent[]` — extracted from `image` blocks and `resource` blocks with image MIME types
- Rejects images if the current session's model does not support vision (fail fast with clear error)

ACP → Pi mapping:
| ACP Block | Pi mapping |
|-----------|-----------|
| `text` | Included in prompt text |
| `image` | Added to `images` array |
| `resource` (text) | Included in prompt text as fenced code block |
| `resource` (blob, image mime) | Added to `images` array |
| `resource` (blob, non-image mime) | Included as placeholder text `[Binary resource: {uri}]` |
| `resource_link` | Included as placeholder text `[Resource: {uri}]` |

### 2. Capability advertisement

- `image`: advertise `true` in `initialize()` **if any model in `availableModels` supports images**.
  - Rationale: ACP capabilities are global (per-agent), but model selection is per-session. Advertising `true` when any model supports it avoids crippling the client. Per-session validation handles the mismatch case.
- `embeddedContext`: advertise `true` — we can ingest text resources and image blobs.
- `audio`: keep `false` (out of scope).

### 3. No output-side changes needed

- Pi only outputs text. `event-bridge.ts`, `tool-call-mapper.ts`, and `client-tool-proxy.ts` already correctly emit `text` content.
- No changes needed for final message mapping or tool call mapping.

## Files to modify

| File                       | Changes                                                                                                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/pi-acp-agent.ts`      | `initialize()`: dynamic `image` capability; `prompt()`: pass images to `session.prompt()`; replace `extractPromptText()` with `convertPromptContent()`; add per-session image validation |
| `src/pi-acp-agent.spec.ts` | Add tests for mixed content blocks, resource blocks, image validation error                                                                                                              |

## Reuse

- `session.model?.input.includes("image")` — Pi model capability check
- `session.prompt(text, { images })` — Pi's existing image prompt API
- `acp.ImageContent` → Pi `ImageContent` — structurally compatible (ACP has optional `uri`)

## Steps

- [ ] **Step 1 — Refactor prompt extraction**
  - Rename `extractPromptText()` → `convertPromptContent(content: acp.ContentBlock[], session: AgentSession): { text: string; images: ImageContent[] }`
  - Handle all content block types per mapping table above
  - Throw `acp.RequestError.invalidParams("Current model does not support images")` if images present but `session.model?.input.includes("image")` is false

- [ ] **Step 2 — Wire images into `prompt()`**
  - Update `prompt()` to destructure `{ text, images }` from `convertPromptContent()`
  - Pass `images` as `session.prompt(text, { images })`

- [ ] **Step 3 — Dynamic capability advertisement**
  - In `initialize()`, compute `anyModelSupportsImage = this.availableModels.some(m => m.input.includes("image"))`
  - Set `promptCapabilities.image = anyModelSupportsImage`
  - Set `promptCapabilities.embeddedContext = true`

- [ ] **Step 4 — Tests**
  - Test `convertPromptContent` with mixed text/image/resource/resource_link blocks
  - Test image rejection when model only supports text
  - Test `initialize()` returns correct capabilities based on available models

## Verification

1. Unit tests pass: `bun test src/pi-acp-agent.spec.ts`
2. Manual check: Initialize agent with a vision-capable model selected, send a prompt with an `image` block — agent should forward to Pi without error.
3. Manual check: Initialize agent with a text-only model selected, send a prompt with an `image` block — agent should return `invalidParams` error.

## Open Questions

1. **Resource links**: For `resource_link` blocks with `file://` URIs, should we attempt to read them via ACP client `readTextFile` when the client advertises `fs.readTextFile` capability? Or keep the simple placeholder approach?
2. **Non-image binary resources**: Should binary blob resources (e.g., PDFs) be converted to a base64 markdown block, or kept as the simple `[Binary resource]` placeholder?
3. **Error on unsupported images**: If the current model doesn't support images but images are sent, should we throw an error or silently convert images to placeholders so the text prompt still goes through?
