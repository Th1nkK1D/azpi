# Plan: Persistent Sessions & ACP Session Lifecycle

## Context

The MVP adapter (`001-pi-acp-adapter.md`) uses `SessionManager.inMemory()`, meaning all sessions are ephemeral. The user wants persistent sessions that:

1. Use Pi's default session storage location (`~/.pi/agent/sessions/<encoded-cwd>/`)
2. Can be shared between `azpi` and the Pi CLI (e.g. `pi -c`, `pi --session <id>`)
3. Support the full ACP session lifecycle: `new`, `load`, `resume`, `list`, `close`

## ACP Spec Summary

- **`session/new`** → Create new persistent session
- **`session/load`** → Restore session + replay full conversation history via `session/update` notifications
- **`session/resume`** → Restore session without replaying history
- **`session/list`** → Discover existing sessions (filter by `cwd`, cursor pagination)
- **`session/close`** → Cancel work and free resources
- **`session_info_update`** notification → Push metadata changes (title, updatedAt, \_meta)

## Pi SDK Relevant APIs

- `SessionManager.create(cwd)` — New persistent session at default location
- `SessionManager.open(path)` — Open existing session file
- `SessionManager.continueRecent(cwd)` — Continue most recent (not used for ACP `new`)
- `SessionManager.list(cwd)` — List sessions for a directory
- `SessionManager.listAll()` — List all sessions across all projects
- `AgentSession.sessionId` — UUID from session header (stable)
- `AgentSession.sessionFile` — Path to JSONL file
- `AgentSession.sessionManager` — Access raw entries for history replay

## Approach

### 1. Session ID mapping

Use Pi's `sessionId` (UUID from session header) as the ACP `sessionId`. This makes sessions naturally addressable by both `azpi` and Pi CLI.

For `load`/`resume`, we need to resolve a UUID → file path. A helper will:

1. Check an in-memory cache first
2. Fall back to `SessionManager.list(cwd)` (or `listAll()` for cross-cwd) to find the matching `id`
3. Return the `path`

### 2. `newSession` — persistent by default

Replace `SessionManager.inMemory()` with `SessionManager.create(cwd)` in `newSession`. Use `session.sessionId` as the returned `sessionId` instead of `crypto.randomUUID()`.

### 3. `resumeSession` — restore without replay

Find the session file by UUID, open with `SessionManager.open(path)`, create the `AgentSession`, subscribe to events, and return `{}`.

### 4. `loadSession` — restore + replay history

Find and open the session file, create the `AgentSession`, then replay conversation history as `session/update` notifications before returning.

**MVP simplification:** Replay user and assistant text messages only. Tool calls and other entries are skipped for now (future improvement). We can iterate over `session.sessionManager.getBranch()` (reversed) and emit `user_message_chunk` / `agent_message_chunk` for `message` entries.

### 5. `listSessions` — discovery

Call `SessionManager.list(params.cwd)` and map Pi `SessionInfo` to ACP `SessionInfo`:

| Pi field                   | ACP field   |
| -------------------------- | ----------- |
| `id`                       | `sessionId` |
| `cwd`                      | `cwd`       |
| `name` \|\| `firstMessage` | `title`     |
| `modified.toISOString()`   | `updatedAt` |
| `{ messageCount }`         | `_meta`     |

Pagination: For MVP, return all sessions (Pi's `list()` is already fast). Return `nextCursor` only when we implement a page size limit later.

### 6. `closeSession` — already implemented

`closeSession` already calls `cleanupSession`. Ensure it also removes from the in-memory cache.

### 7. Capabilities update

In `initialize`, set:

- `loadSession: true`
- `sessionCapabilities.list: {}`
- `sessionCapabilities.resume: {}`
- `sessionCapabilities.close: {}` (already present)

### 8. Session info updates

Pi already emits `session_info_changed` when the session name changes (mapped in `event-bridge.ts`). Additionally, emit `session_info_update` with `updatedAt` after every `agent_end` event so ACP clients stay in sync without polling.

## Files to modify / create

| File                       | Action     | Purpose                                                                                           |
| -------------------------- | ---------- | ------------------------------------------------------------------------------------------------- |
| `src/pi-acp-agent.ts`      | **Modify** | Persistent session creation, `loadSession`, `resumeSession`, `listSessions`, UUID-based sessionId |
| `src/pi-acp-agent.spec.ts` | **Modify** | Tests for new capabilities and session methods                                                    |
| `src/session.ts`           | **Create** | Merged: `SessionResolver` (UUID → file path) + `replaySessionHistory()` (history replay)          |
| `src/session.spec.ts`      | **Create** | Tests for both resolver and replay                                                                |

## Reuse

- `SessionManager.create(cwd)`, `SessionManager.open(path)`, `SessionManager.list(cwd)` — Pi SDK
- `session.sessionId`, `session.sessionFile`, `session.sessionManager` — Pi `AgentSession` properties
- `mapSessionEvent()` in `event-bridge.ts` — For formatting Pi events to ACP notifications
- `this.connection.sessionUpdate()` — ACP SDK for streaming history

## Steps

- [ ] **Step 1 — Update capabilities**
  - In `initialize()`, set `loadSession: true`, `sessionCapabilities.list: {}`, `sessionCapabilities.resume: {}`
  - Update tests to assert new capabilities

- [ ] **Step 2 — Create `src/session.ts` (SessionResolver)**
  - `SessionResolver` class with `resolveSessionPath()`, `registerSession()`, `unregisterSession()`, `warmCache()`
  - Checks in-memory cache, then `SessionManager.list(cwd)`, then `SessionManager.listAll()`

- [ ] **Step 3 — Modify `newSession` for persistence**
  - Use `SessionManager.continueRecent(cwd)` instead of `inMemory()`
  - Use `session.sessionId` as ACP `sessionId`
  - Register sessionId → path in resolver cache
  - Keep `sessionFactory` override for tests

- [ ] **Step 4 — Implement `resumeSession`**
  - Resolve UUID → path via `SessionResolver` in `session.ts`
  - Open with `SessionManager.open(path)`, create `AgentSession`
  - Subscribe to events, store in maps
  - Return `{}`

- [ ] **Step 5 — Add `replaySessionHistory` to `src/session.ts`**
  - `replaySessionHistory(session, sessionId, connection)` function
  - Iterate `session.sessionManager.getEntries()`
  - For each `message` entry: emit `user_message_chunk` (role=user) or `agent_message_chunk` (role=assistant)
  - Skip tool results, compactions, custom entries for MVP

- [ ] **Step 6 — Implement `loadSession`**
  - Resolve UUID → path, open session
  - Call `replaySessionHistory()` before returning
  - Return `{}`

- [ ] **Step 7 — Implement `listSessions`**
  - Call `SessionManager.list(params.cwd ?? process.cwd())`
  - Map to ACP `SessionInfo[]`
  - Populate resolver cache with discovered sessions
  - Return `{ sessions }` (no pagination for MVP)

- [ ] **Step 8 — Update `closeSession` and cleanup**
  - Ensure `cleanupSession` removes from resolver cache
  - Verify no memory leaks

- [ ] **Step 9 — Update unit tests**
  - Create `src/session.spec.ts` with tests for both `SessionResolver` and `replaySessionHistory`
  - Update `pi-acp-agent.spec.ts` for new session lifecycle methods
  - Mock `SessionManager` static methods in tests
  - Test resolver cache hits/misses, history replay edge cases

- [ ] **Step 10 — E2E verification**
  - Run `bun test`
  - Run adapter, create session, close adapter, restart, call `session/list` and `session/resume`
  - Verify Pi CLI can see the same session (`pi -r` or `--session <id>`)

## Decisions

| Topic                         | Decision                             | Rationale                                                                                                                                         |
| ----------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session ID                    | Use Pi `sessionId` UUID              | Natural sharing with Pi CLI; stable across restarts                                                                                               |
| Default persistence           | `SessionManager.continueRecent(cwd)` | Behaves like `pi -c` — picks up the most recent session for the current project, or creates new if none exists. Seamless sharing with Pi CLI.     |
| In-memory fallback            | Keep via `sessionFactory` option     | Tests can still inject mock sessions                                                                                                              |
| `session/load` history replay | Text messages only for MVP           | Pi's `SessionManager.open()` fully restores LLM context internally. ACP replay is purely for client UI. Full tool call replay can be added later. |
| `session/list` pagination     | Return all results for MVP           | Pi's `list()` is fast enough for typical project session counts                                                                                   |
| `updatedAt` push              | Emit after every `agent_end`         | Sends `session_info_update` with fresh `updatedAt` so clients stay in sync without polling                                                        |
| Cross-cwd session lookup      | Use `listAll()` fallback             | Enables `resume` even when cwd changed slightly                                                                                                   |

## Implementation Detail: `newSession` with `continueRecent`

```typescript
const sessionManager = SessionManager.continueRecent(cwd);
const { session } = await createAgentSession({
  cwd,
  sessionManager,
  tools: ["read", "bash", "edit", "write"],
  customTools: proxyTools,
  authStorage: this.authStorage,
  modelRegistry: this.modelRegistry,
  ...this.options.sessionOptions,
});
// session.sessionId is the existing or new UUID
// session.sessionFile points to the JSONL file
```

Because `continueRecent` may return an existing session, the ACP `sessionId` will be the Pi UUID of the continued session. The client receives this UUID and can later `session/resume` or `session/load` it.

## Implementation Detail: `session_info_update` on turn end

In `onEvent`, when `agent_end` fires, emit an additional `session_info_update` notification with the current timestamp:

```typescript
if (event.type === "agent_end") {
  // ... existing prompt resolution ...

  // Push updatedAt to client
  this.connection
    .sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "session_info_update",
        updatedAt: new Date().toISOString(),
      },
    })
    .catch(() => {});
}
```
