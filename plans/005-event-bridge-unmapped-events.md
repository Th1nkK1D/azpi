# Plan: Map Unmapped Pi Events in event-bridge.ts

## Context

`src/event-bridge.ts:72-85` groups 11 Pi `AgentSessionEvent` types into a single `return null` block labelled "These events don't map to ACP notifications in the MVP". We need to decide, event-by-event, whether each should remain unmapped or be bridged to an ACP `SessionUpdate`, and implement the mappings.

Additionally, Pi's `message_update` event can carry `assistantMessageEvent.type === "thinking_delta"` (model reasoning tokens), but the bridge currently only handles `text_delta`. These thinking tokens should map to ACP's `agent_thought_chunk`.

## Current Unmapped Events

| Pi Event                 | Payload                                                                              | Current Handling                                   |
| ------------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `agent_start`            | `{ type: "agent_start" }`                                                            | `return null`                                      |
| `agent_end`              | `{ type: "agent_end"; messages: AgentMessage[] }`                                    | `return null`                                      |
| `turn_start`             | `{ type: "turn_start" }`                                                             | `return null`                                      |
| `turn_end`               | `{ type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }`      | `return null`                                      |
| `queue_update`           | `{ type: "queue_update"; steering: readonly string[]; followUp: readonly string[] }` | `return null`                                      |
| `compaction_start`       | `{ type: "compaction_start"; reason: "manual" \| "threshold" \| "overflow" }`        | `return null`                                      |
| `compaction_end`         | `{ type: "compaction_end"; reason; result; aborted; willRetry; errorMessage? }`      | `return null`                                      |
| `session_info_changed`   | `{ type: "session_info_changed"; name: string \| undefined }`                        | `return null`                                      |
| `thinking_level_changed` | `{ type: "thinking_level_changed"; level: ThinkingLevel }`                           | `return null` (special-cased in `pi-acp-agent.ts`) |
| `auto_retry_start`       | `{ type: "auto_retry_start"; attempt; maxAttempts; delayMs; errorMessage }`          | `return null`                                      |
| `auto_retry_end`         | `{ type: "auto_retry_end"; success; attempt; finalError? }`                          | `return null`                                      |

## Analysis & Final Verdicts

### 1. `agent_end` — Keep unmapped

- **Rationale:** `pi-acp-agent.ts:289` catches `agent_end` directly to resolve the pending `prompt()` promise with a `PromptResponse` (stop reason). Streaming the final content is already done via preceding `message_update`/`tool_execution_*` events. Sending an additional notification would be redundant.

### 2. `thinking_level_changed` — **Move into `mapSessionEvent`**

- **Rationale:** Currently special-cased in `pi-acp-agent.ts:275` before `mapSessionEvent` is called. For consistency, it should live inside `mapSessionEvent` like all other event-to-notification mappings.
- **Implementation:**
  - Add an optional `configOptions` parameter to `mapSessionEvent`:
    ```ts
    export function mapSessionEvent(
      event: AgentSessionEvent,
      sessionId: string,
      configOptions?: acp.SessionConfigOption[],
    ): acp.SessionNotification | null;
    ```
  - In `mapSessionEvent`, add:
    ```ts
    case "thinking_level_changed": {
      if (!configOptions) return null;
      return {
        sessionId,
        update: {
          sessionUpdate: "config_option_update",
          configOptions,
        },
      };
    }
    ```
  - In `pi-acp-agent.ts`, build `configOptions` from the session and pass it to `mapSessionEvent`, then remove the special-case branch.

### 3. `session_info_changed` — **Map to `session_info_update`**

- **Rationale:** ACP has a first-class `session_info_update` notification with a `title` field. Pi's `session_info_changed` carries `name` (the session display name). This is a clean 1-to-1 mapping.
- **Implementation:**
  ```ts
  case "session_info_changed": {
    return {
      sessionId,
      update: {
        sessionUpdate: "session_info_update",
        title: event.name ?? null,
      },
    };
  }
  ```

### 4. `thinking_delta` (inside `message_update`) — **Map to `agent_thought_chunk`**

- **Rationale:** Pi providers (Anthropic, OpenAI, Bedrock, Mistral, etc.) emit `thinking_delta` events containing model reasoning tokens. ACP has a matching `agent_thought_chunk` update type. These are currently dropped because `message_update` only handles `text_delta`.
- **Implementation:** Extend the `message_update` case:
  ```ts
  case "message_update": {
    const assistantEvent = event.assistantMessageEvent;
    if (assistantEvent?.type === "text_delta") {
      const delta = assistantEvent.delta;
      if (typeof delta !== "string" || delta.length === 0) return null;
      return {
        sessionId,
        update: {
          content: { text: delta, type: "text" },
          sessionUpdate: "agent_message_chunk",
        },
      };
    }
    if (assistantEvent?.type === "thinking_delta") {
      const delta = assistantEvent.delta;
      if (typeof delta !== "string" || delta.length === 0) return null;
      return {
        sessionId,
        update: {
          content: { text: delta, type: "text" },
          sessionUpdate: "agent_thought_chunk",
        },
      };
    }
    return null;
  }
  ```

### 5. `agent_start` / `turn_start` / `turn_end` / `queue_update` / `compaction_start` / `compaction_end` / `auto_retry_start` / `auto_retry_end` — Keep unmapped

- **Rationale:** These are Pi-internal lifecycle or queue-management events with no ACP equivalent. The client already knows processing started because it called `prompt()`. Compaction, retry, and queue state are Pi-specific concepts. We will **not** synthesise `agent_thought_chunk` notifications for them.

## Files to Modify

- `src/event-bridge.ts`
  - Add `thinking_delta` → `agent_thought_chunk` mapping inside the `message_update` branch.
  - Add `session_info_changed` → `session_info_update` mapping.
  - Move `thinking_level_changed` → `config_option_update` mapping from `pi-acp-agent.ts` into `mapSessionEvent`.
- `src/pi-acp-agent.ts`
  - Remove the special-case `thinking_level_changed` branch from `onEvent()`.
- `src/event-bridge.spec.ts`
  - Add test for `thinking_delta` → `agent_thought_chunk`.
  - Add test for `session_info_changed` → `session_info_update`.
  - Add test for `thinking_level_changed` → `config_option_update`.

## Implementation Steps

- [ ] In `event-bridge.ts`, extend `message_update` handling to map `thinking_delta` to `agent_thought_chunk`.
- [ ] In `event-bridge.ts`, add `case "session_info_changed"` mapping to `session_info_update`.
- [ ] In `event-bridge.ts`, add an optional `configOptions` parameter to `mapSessionEvent` and handle `thinking_level_changed` by returning a `config_option_update` when `configOptions` is provided.
- [ ] In `pi-acp-agent.ts`, remove the `if (event.type === "thinking_level_changed")` special-case from `onEvent()`. Instead, build `configOptions` via `this.buildConfigOptions(session)` and pass it to `mapSessionEvent`.
- [ ] In `event-bridge.spec.ts`, add unit tests for the three new mappings (including passing mock `configOptions` for the `thinking_level_changed` test).
- [ ] In `pi-acp-agent.spec.ts`, update or remove tests that assert on the old special-case `thinking_level_changed` behaviour.

## Verification

- Run `bun test` (or equivalent) to ensure all existing tests pass.
- New tests should verify:
  - `thinking_delta` produces `sessionUpdate: "agent_thought_chunk"` with the delta text.
  - `session_info_changed` produces `sessionUpdate: "session_info_update"` with the name as title.
  - `thinking_level_changed` with `configOptions` produces `sessionUpdate: "config_option_update"`; without `configOptions` returns `null`.
  - `agent_start`, `agent_end`, `turn_start`, `turn_end`, `queue_update`, `compaction_start`, `compaction_end`, `auto_retry_start`, `auto_retry_end` all still return `null`.
