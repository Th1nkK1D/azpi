# Plan: Pi Agent ACP Adapter

## Context

We want to make the [pi coding agent](https://github.com/badlogic/pi-mono) accessible via the [Agent Client Protocol (ACP)](https://agentclientprotocol.com). ACP is a JSON-RPC 2.0 protocol that standardizes communication between code editors (Clients) and AI coding agents. Pi already has a rich TypeScript SDK (`@earendil-works/pi-coding-agent`) and its own proprietary RPC mode, but no native ACP support.

The goal is a new adapter that wraps the Pi SDK so that any ACP-compatible client (e.g. Zed, or generic ACP clients) can launch and converse with pi.

## Existing Resources

- **ACP TypeScript SDK**: `@agentclientprotocol/sdk` provides `AgentSideConnection`, `acp.Agent` interface, `ndJsonStream`, and stdio transport.  
  _Example_: `github.com/agentclientprotocol/typescript-sdk/src/examples/agent.ts`
- **Pi SDK**: `@earendil-works/pi-coding-agent` provides `createAgentSession()`, `AgentSession`, event streaming, built-in tools, session management, etc.
- **Current codebase**: Nearly empty (`azpi` package). We are building the adapter from scratch.

## Approach

Build a TypeScript agent binary that:

1. Uses `@agentclientprotocol/sdk` to handle ACP JSON-RPC stdio transport and connection lifecycle.
2. Implements the `acp.Agent` interface.
3. Inside each ACP session, creates a Pi `AgentSession` via `createAgentSession()`.
4. Maps ACP `session/prompt` → `session.prompt()` and streams pi events back as ACP `session/update` notifications.
5. Uses Pi's built-in tools directly (read, bash, edit, write) within the `cwd` provided by the ACP client.

### Tool access model (MVP: Option A)

ACP defines `fs/read_text_file`, `fs/write_text_file`, and `terminal/*` as **Client** methods. In principle, an ACP agent should ask the client to perform file/terminal operations. However, Pi's SDK is designed around agent-side tools that access the filesystem directly.

**MVP decision:** Keep Pi's native direct tools (Option A). The adapter will let Pi use its own tools and report them to the client as ACP `tool_call` / `tool_call_update` notifications. This preserves Pi behavior, streaming bash output, and edit-tool logic without rebuilding the tool layer.

> **Future improvement:** Replace Pi tools with ACP client method proxies (Option B) for proper sandboxing and spec compliance.

### Session scope (MVP: In-memory only)

- One ACP session = one Pi `AgentSession`.
- `cwd` from ACP `session/new` is passed to Pi's `createAgentSession({ cwd })`.
- **MVP decision:** Use `SessionManager.inMemory()` only. ACP `session/load` and `session/resume` are out of scope for the first version.

> **Future improvement:** Leverage Pi's `SessionManager.create()` / `AgentSessionRuntime` to support ACP `session/load`, `session/resume`, `session/close`, and `session/list`.

### Event mapping (Pi → ACP)

| Pi event                          | ACP notification                                                    |
| --------------------------------- | ------------------------------------------------------------------- |
| `message_update` (text_delta)     | `session/update` → `agent_message_chunk` (text)                     |
| `message_update` (thinking_delta) | `session/update` → `agent_message_chunk` (text, possibly annotated) |
| `tool_execution_start`            | `session/update` → `tool_call` (pending)                            |
| `tool_execution_update`           | `session/update` → `tool_call_update` (in_progress)                 |
| `tool_execution_end`              | `session/update` → `tool_call_update` (completed / failed)          |
| `agent_start`                     | (optional) `session/update` → `plan` or no-op                       |
| `agent_end`                       | `session/prompt` resolves with `stopReason: end_turn`               |
| `turn_end`                        | intermediate checkpoint                                             |

### Cancellation

- ACP `session/cancel` notification → `session.abort()`.
- If abort succeeds, resolve the pending `session/prompt` with `stopReason: cancelled`.

### Permission model (MVP: Option A)

Pi does not have a built-in user-approval gate for destructive tools (edit, write, bash).

**MVP decision:** Auto-allow all tool calls (Option A). The adapter will not intercept tool executions or call ACP `requestPermission`.

> **Future improvement:** Intercept Pi tool executions and call ACP `requestPermission` before destructive operations (edit, write, bash) for safer multi-user or remote-client scenarios.

## Files to create / modify

| File                       | Purpose                                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `package.json`             | Add deps: `@agentclientprotocol/sdk`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `typebox` (peer of pi sdk) |
| `src/main.ts`              | Entry point: wire stdio to `acp.ndJsonStream` and instantiate `PiAcpAgent`                                                   |
| `src/main.spec.ts`         | Unit tests for bootstrap / stdio transport wiring                                                                            |
| `src/pi-acp-agent.ts`      | Core class implementing `acp.Agent`, managing session lifecycle and event bridging                                           |
| `src/pi-acp-agent.spec.ts` | Unit tests for `initialize`, `newSession`, `prompt`, `cancel`, session management                                            |
| `src/event-bridge.ts`      | Maps Pi `AgentSessionEvent`s to ACP `SessionUpdate` objects                                                                  |
| `src/event-bridge.spec.ts` | Unit tests for every event mapping permutation                                                                               |
| `src/tool-mapper.ts`       | Helpers to map Pi tool metadata to ACP `tool_call` shapes                                                                    |
| `src/tool-mapper.spec.ts`  | Unit tests for tool metadata → ACP shape conversion                                                                          |
| `tsconfig.json`            | Ensure ESM / Node 20+ compatibility                                                                                          |

## Reuse

- `@agentclientprotocol/sdk` — handles JSON-RPC parsing, stdio transport, `AgentSideConnection`, request routing, and type definitions.
- `createAgentSession()` from Pi SDK — handles model setup, LLM interaction, tool execution, compaction, retries.
- `SessionManager.inMemory()` — lightweight session storage for MVP.
- `createCodingTools(cwd)` — ensures Pi tools resolve paths relative to the ACP-provided `cwd`.

## Steps

- [ ] **Step 1 — Project setup**  
       Install `@agentclientprotocol/sdk`, `@earendil-works/pi-coding-agent`, and peers. Configure `package.json` bin entry and tsconfig. Add `test` script using Bun's built-in test runner.

- [ ] **Step 2 — Bootstrap stdio transport**  
       Create `src/main.ts` that creates an `acp.ndJsonStream` over `process.stdin`/`process.stdout` and passes it to `acp.AgentSideConnection` with our agent factory.  
       **Test:** Create `src/main.spec.ts` that mocks `process.stdin`/`process.stdout`, verifies `ndJsonStream` is created, and ensures the agent factory is invoked.

- [ ] **Step 3 — Implement `initialize`**  
       Return `protocolVersion: acp.PROTOCOL_VERSION`, agent info (`name: "pi"`), and capabilities.  
       Capabilities to decide: `loadSession`, `promptCapabilities.image`, `sessionCapabilities.close`, etc.  
       **Test:** In `src/pi-acp-agent.spec.ts`, assert the `initialize` response contains the expected protocol version, agent info, and capabilities.

- [ ] **Step 4 — Implement `newSession`**  
       Accept `cwd` from ACP params. Create Pi session with `SessionManager.inMemory()` and `createCodingTools(cwd)`. Store in a local `Map<string, AgentSession>`.  
       **Test:** In `src/pi-acp-agent.spec.ts`, call `newSession` with a mock `cwd`, verify the returned `sessionId` is present, and assert the internal session map contains the new entry.

- [ ] **Step 5 — Implement `prompt` + event bridge**  
       Convert ACP `ContentBlock[]` to a string (concatenate text blocks; embed resources as markdown code blocks or URIs). Call `session.prompt(text)`. Subscribe to pi events and forward via `connection.sessionUpdate()`. Resolve the ACP prompt promise with the correct `StopReason` when `agent_end` fires.  
       **Test:** In `src/pi-acp-agent.spec.ts`, mock a Pi `AgentSession`, simulate `prompt()` resolution, and assert the method returns `{ stopReason: "end_turn" }`. In `src/event-bridge.spec.ts`, test each Pi event → ACP update conversion with mocked events.

- [ ] **Step 6 — Implement `cancel`**  
       Look up session, call `session.abort()`, ensure pending `prompt` promise resolves with `stopReason: cancelled`.  
       **Test:** In `src/pi-acp-agent.spec.ts`, start a mocked prompt, send `cancel`, and assert the pending `prompt` resolves with `stopReason: "cancelled"`.

- [ ] **Step 7 — Implement `authenticate` / `close` / `setSessionMode`**  
       Stub or implement based on chosen capabilities.  
       **Test:** In `src/pi-acp-agent.spec.ts`, assert these methods return the expected empty/stub responses without throwing.

- [ ] **Step 8 — Tool call mapping**  
       Ensure Pi `tool_execution_start/end/update` events generate properly shaped ACP `tool_call` / `tool_call_update` notifications with `toolCallId`, `title`, `kind`, `status`, and `content`.  
       **Test:** In `src/tool-mapper.spec.ts`, verify each mapper function outputs valid ACP shapes. In `src/event-bridge.spec.ts`, assert that tool events produce the correct `tool_call` / `tool_call_update` notifications.

- [ ] **Step 9 — Verification**
  1. Run all unit tests: `bun test` (covers `*.spec.ts`).
  2. Run the adapter from an ACP client or the official TypeScript SDK client example. Send a prompt, observe streamed text and tool calls, verify cancellation works.

## Decisions (MVP)

| Topic               | Decision                    | Rationale                                                       |
| ------------------- | --------------------------- | --------------------------------------------------------------- |
| Tool access model   | **A** — Native direct tools | Preserves Pi behavior, streaming, and edit logic; simplest path |
| Session persistence | **In-memory only**          | Avoids file-system session complexity for first version         |
| Permission requests | **A** — Auto-allow all      | Fastest path; acceptable for local/trusted client use           |

## Future Improvements

1. **Tool access model → Option B** — Replace Pi's native tools with ACP client method proxies (`fs/read_text_file`, `fs/write_text_file`, `terminal/*`) for proper sandboxing and full ACP spec compliance.
2. **Session persistence** — Wire Pi's `SessionManager.create()` and `AgentSessionRuntime` into ACP `session/load`, `session/resume`, `session/close`, and `session/list`.
3. **Permission gating** — Intercept destructive tool calls and use ACP `requestPermission` before executing edit/write/bash operations.
4. **Rich content support** — Enable `promptCapabilities.image`, `audio`, and `embeddedContext` once Pi SDK supports them.
5. **Config options & modes** — Surface Pi's `thinkingLevel`, model cycling, and session config options through ACP `session/set_mode` and `session/set_config_option`.
