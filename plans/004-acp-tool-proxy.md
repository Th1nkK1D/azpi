# Plan: ACP Client-Method Tool Proxy (Future Improvement 1)

## Context

The MVP adapter lets Pi use its native direct tools (`read`, `bash`, `edit`, `write`). Future Improvement 1 replaces those with ACP client-method proxies so the agent asks the **client** (Zed, etc.) to perform filesystem and terminal operations. This gives proper sandboxing, remote-client support, and full ACP spec compliance.

## Goal

When the ACP client advertises `fs.readTextFile`, `fs.writeTextFile`, and/or `terminal` capabilities, `azpi` selectively overrides the matching Pi built-in tools with proxy implementations that route tool calls through the client's JSON-RPC methods. Unadvertised capabilities continue using Pi's native tools.

## Approach

1. **Capability-gated opt-in** — During `initialize`, record `clientCapabilities`. In `newSession`, if the client supports the required capabilities, create proxy tools instead of native tools.

2. **Override built-ins via `customTools`** — Pass `tools: ["read", "bash", "edit", "write"]` as an allowlist and `customTools: [acpReadProxy, ...]` for only the advertised capabilities. Pi's SDK overrides built-in tool registrations when a custom tool has the same name, so the proxy replaces the built-in while untouched tools stay native.

3. **Proxy tools return normal Pi-format results** — Each proxy tool's `execute()` calls the ACP client methods and returns a standard Pi `AgentToolResult`. Pi's core agent runtime automatically emits `tool_execution_start` / `update` / `end` events, which the existing event bridge maps to ACP notifications. No direct `sessionUpdate()` calls from the proxy tools — this avoids duplicate notifications because Pi always fires tool lifecycle events for all tools (including custom ones).

4. **Bash streaming via terminal polling** — ACP terminals are polled (`currentOutput()`). The proxy polls at a regular interval and emits ACP `tool_call_update` notifications with the latest content.

## Files to create / modify

| File                         | Action     | Purpose                                                                                    |
| ---------------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| `src/acp-tool-proxy.ts`      | **Create** | Factory that builds proxy `ToolDefinition[]` using `defineTool()`                          |
| `src/acp-tool-proxy.spec.ts` | **Create** | Unit tests for each proxy tool (mocked `AgentSideConnection`)                              |
| `src/pi-acp-agent.ts`        | **Modify** | Store `clientCapabilities`; wire proxy tools into `newSession`                             |
| `src/pi-acp-agent.spec.ts`   | **Modify** | Tests for capability-based tool selection                                                  |
| `src/tool-mapper.ts`         | **Modify** | Add helpers to build ACP `ToolCall` / `ToolCallUpdate` shapes from proxy execution context |
| `src/tool-mapper.spec.ts`    | **Modify** | Tests for new mapper helpers                                                               |

## Reuse

- `@agentclientprotocol/sdk` — `AgentSideConnection.readTextFile()`, `writeTextFile()`, `createTerminal()` (returns `TerminalHandle` with `currentOutput()`, `waitForExit()`, `release()`).
- `@earendil-works/pi-coding-agent` — `defineTool()` for custom tool definitions; `customTools` to override built-ins by name.
- Existing `src/tool-mapper.ts` — add helpers for building ACP shapes so proxy tools stay readable.

## Detailed Design

### 1. Tool-by-tool mapping

| Pi tool | ACP client method(s)                                                                              | Notes                                                                                                                                                                                       |
| ------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read`  | `fs/read_text_file`                                                                               | Read full file, then apply offset/limit/truncation locally so Pi's truncation semantics are preserved. Images: ACP returns text only; skip image support in v1 and return placeholder text. |
| `write` | `fs/write_text_file`                                                                              | Straight passthrough after ensuring absolute path.                                                                                                                                          |
| `edit`  | `fs/read_text_file` → local diff → `fs/write_text_file`                                           | Read original, apply Pi's exact-text-replacement logic, write back.                                                                                                                         |
| `bash`  | `terminal/create` → poll `terminal/currentOutput` → `terminal/wait_for_exit` → `terminal/release` | Poll every 250 ms, emit ACP `tool_call_update`. Respect `timeout` param by calling `terminal.kill()` and releasing.                                                                         |

### 2. Tool schemas

The proxy tools must expose **exactly** the same parameter schemas as Pi's built-ins so the LLM prompt doesn't change:

- `read`: `{ path: string, offset?: number, limit?: number }`
- `write`: `{ path: string, content: string }`
- `edit`: `{ path: string, edits: { oldText: string, newText: string }[] }`
- `bash`: `{ command: string, timeout?: number }`

We can import the schemas from Pi's SDK if they are exported, or inline them (they are simple TypeBox objects).

### 3. ACP notification flow inside a proxy tool

```
1. LLM requests tool call
2. Pi calls proxyTool.execute(toolCallId, params, signal, onUpdate, ctx)
3. Pi emits tool_execution_start (event bridge maps to ACP tool_call)
4. Proxy calls ACP client method(s)
5. Proxy calls onUpdate() for streaming tools (bash), Pi emits tool_execution_update
6. Proxy returns { content, details } to Pi
7. Pi emits tool_execution_end (event bridge maps to final ACP tool_call_update)
```

**Responsibility is clear:** `event-bridge.ts` remains the single source of truth for ALL Pi → ACP notification mapping. Proxy tools do not call `connection.sessionUpdate()` themselves. To get cleaner output, we improve `tool-mapper.ts` so it extracts human-readable text from Pi tool results instead of JSON-stringifying them.

### 4. `PiAcpAgent` changes

- Add `private clientCapabilities?: acp.ClientCapabilities`
- In `initialize(params)`, store `this.clientCapabilities = params.clientCapabilities`
- In `newSession(params, sessionId)`:

  ```ts
  const proxyTools = createAcpProxyTools({
    connection: this.connection,
    sessionId,
    capabilities: this.clientCapabilities,
    cwd,
  });

  const { session } = await createAgentSession({
    cwd,
    sessionManager: SessionManager.inMemory(),
    // Custom tools with same names as built-ins override them;
    // the allowlist keeps all 4 tool slots regardless of which we override.
    tools: ["read", "bash", "edit", "write"],
    customTools: proxyTools,
    authStorage: this.authStorage,
    modelRegistry: this.modelRegistry,
    ...this.options.sessionOptions,
  });
  ```

### 5. `createAcpProxyTools` factory signature

```ts
export interface AcpProxyToolOptions {
  connection: acp.AgentSideConnection;
  sessionId: string;
  capabilities: acp.ClientCapabilities | undefined;
  cwd: string;
}

export function createAcpProxyTools(options: AcpProxyToolOptions): ToolDefinition[];
```

The factory inspects `capabilities.fs?.readTextFile`, `capabilities.fs?.writeTextFile`, and `capabilities.terminal` to decide which proxies to build. It returns an array of `ToolDefinition[]` (each created via `defineTool()`) using the same names as the built-ins they override. Only the advertised capabilities are included; missing ones are omitted. If no capabilities are advertised, the factory returns an empty array and the `customTools` parameter is simply empty (native tools remain active).

## Steps

- [ ] **Step 1 — Verify `customTools` override behaviour**  
       Confirm that Pi SDK `createAgentSession({ tools: ["read", "bash", "edit", "write"], customTools: [acpReadProxy] })` replaces only the `read` built-in with the proxy while keeping `bash`, `edit`, and `write` native.

- [ ] **Step 2 — Create `src/acp-tool-proxy.ts`**  
       Implement `createAcpProxyTools()` returning `ToolDefinition[]`. Include read/write/edit/bash proxies using `defineTool()`, path resolution, truncation helpers for read, and terminal polling for bash.

- [ ] **Step 3 — Implement read proxy**  
       Call `connection.readTextFile()`, apply offset/limit/truncation locally, return Pi-format result. The event bridge will map Pi's tool lifecycle events to ACP notifications.

- [ ] **Step 4 — Implement write proxy**  
       Call `connection.writeTextFile()`, return success message in Pi format.

- [ ] **Step 5 — Implement edit proxy**  
       Call `connection.readTextFile()` → apply exact-text-replacement locally → `connection.writeTextFile()`. Return success message in Pi format.

- [ ] **Step 6 — Implement bash proxy**  
       Call `connection.createTerminal()`, poll `currentOutput()` every 250 ms, call Pi `onUpdate()` with partial output so Pi emits `tool_execution_update`. On completion or timeout, call `release()` and return final result. The event bridge maps Pi's streaming events to ACP notifications.

- [ ] **Step 7 — Wire into `PiAcpAgent.newSession()`**  
       Store capabilities, call factory, always pass `tools: ["read", "bash", "edit", "write"]` + `customTools` (which may be empty when no capabilities advertised).

- [ ] **Step 8 — Improve `tool-mapper.ts` formatting**  
       Update `mapToolCallStart`, `mapToolCallUpdate`, and `mapToolCallEnd` to extract clean human-readable text from Pi tool results instead of `JSON.stringify`. For example, `mapToolCallEnd` should check if `event.result` has `{ content: [{ type: "text", text: ... }] }` and use that text directly. This makes output clean for both native and proxy tools.

- [ ] **Step 9 — Unit tests**  
       Mock `AgentSideConnection` and `TerminalHandle`. Assert that each proxy calls the right client method, emits the right notifications, and returns the right Pi-format result. Test bash polling and timeout behaviour.

- [ ] **Step 10 — E2E verification**  
       Run adapter against an ACP client that advertises `fs` + `terminal` capabilities. Send a prompt that triggers read, edit, and bash. Verify the client performs the operations and the adapter streams updates correctly.

## Decisions

| Topic                                         | Decision                                                                                                                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Topic                                         | Decision                                                                                                                                            |
| -------                                       | ----------                                                                                                                                          |
| **Override mechanism**                        | Use `customTools` with same-named tools (not `baseToolsOverride`). Custom tools override built-ins in `_toolRegistry`.                              |
| **Fallback when capabilities are missing**    | Only proxy what the client advertises, omit the rest. Always pass `tools: ["read","bash","edit","write"]` allowlist; `customTools` may be empty.    |
| **Image support in read proxy**               | Skip for v1 — return placeholder text. ACP `fs/read_text_file` is text-only.                                                                        |
| **Who emits final `tool_call_update`**        | `event-bridge.ts` handles all notifications. Proxy tools return normal Pi-format results. `tool-mapper.ts` is improved for cleaner text extraction. |
| **Bash poll interval**                        | 250 ms — balances responsiveness vs RPC overhead.                                                                                                   |
| **Edit tool: reuse Pi edit logic or inline?** | Inline the algorithm (read → split → replace → join → write) to avoid depending on Pi's internal file-IO helpers.                                   |

## Verification

1. `bun test` passes for `acp-tool-proxy.spec.ts` and updated `pi-acp-agent.spec.ts`.
2. Manual test: connect to an ACP client (e.g. Zed), verify that:
   - `initialize` response doesn't change.
   - File read prompts show `tool_call` → `tool_call_update` via the client.
   - Bash prompts stream output in the client's UI.
   - Cancellation (`session/cancel`) aborts a running bash proxy (terminal `kill()` + `release()`).

## Risks

- **Pi SDK tool-override behaviour** — Need to confirm that `customTools` with the same name as built-in tools correctly overrides them without leaking native implementations. The SDK source confirms custom tools are registered after built-ins in `_toolRegistry`, so `Map.set` overwrites. Verified in Step 1.
- **ACP terminal API latency** — Polling `terminalOutput` every 250 ms adds RPC chatter. If the client is remote, this could be slow. We can make the interval configurable later.
- **Path resolution** — Pi tools resolve relative paths against `cwd`. The proxy must `resolve(cwd, path)` to absolute before calling ACP methods, because ACP requires absolute paths.
