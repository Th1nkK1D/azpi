# Plan: Show Startup Message in ACP Client

## Context

The `azpi` project is an ACP (Agent Client Protocol) adapter for the Pi coding agent. When a client connects and creates a session, we want to display a startup message containing metadata about the agent environment.

## Approach

Send an `agent_message_chunk` session update immediately after `newSession` returns (fire-and-forget to avoid blocking the response). The message will be formatted as markdown and include:

1. **Agent name and version** — from `package.json` (already imported as `AGENT_NAME`, `AGENT_VERSION`)
2. **Pi coding agent version** — from `@earendil-works/pi-coding-agent` `VERSION` export
3. **Context files read** — from `session.resourceLoader.getAgentsFiles()`
4. **Installed skills** — from `session.resourceLoader.getSkills()`
5. **Installed extensions** — from `session.resourceLoader.getExtensions()`

### Why `agent_message_chunk`?

ACP does not have a dedicated "startup / welcome" notification type. `agent_message_chunk` is the standard way for an agent to stream text to the client UI. Sending it as a single complete chunk will render as a static assistant message.

### Timing

We’ll fire the notification asynchronously _after_ `newSession` returns its response so the client already knows the `sessionId` and won’t drop the update.

## Files to modify

- `src/startup-info.ts` — new module: builds the startup message markdown string from session metadata
- `src/pi-acp-agent.ts` — import builder and send the message in `newSession`

## Reuse

- `AGENT_NAME`, `AGENT_VERSION` from `package.json` already imported in `src/pi-acp-agent.ts`
- `VERSION` from `@earendil-works/pi-coding-agent/dist/config.js`
- `session.resourceLoader` APIs:
  - `getAgentsFiles()` → `{ agentsFiles: Array<{ path, content }> }`
  - `getSkills()` → `{ skills: Array<{ name, description, filePath }> }`
  - `getExtensions()` → `{ extensions: Array<{ path, resolvedPath, sourceInfo }> }`
- `connection.sessionUpdate(notification)` already used throughout `pi-acp-agent.ts`

## Steps

- [ ] Create `src/startup-info.ts` with:
  - Import `VERSION` from `@earendil-works/pi-coding-agent`
  - Import `AGENT_NAME`, `AGENT_VERSION` from `../package.json`
  - Export `buildStartupMessage(session): string` that reads `session.resourceLoader` for:
    - Context files via `getAgentsFiles()`
    - Skills via `getSkills()`
    - Extensions via `getExtensions()`
  - Returns a markdown string with the 5 requested sections
- [ ] In `src/pi-acp-agent.ts`:
  - Import `buildStartupMessage`
  - At the end of `newSession`, inline the send logic: call `buildStartupMessage(session)`, construct an `agent_message_chunk` notification, and fire it via `this.connection.sessionUpdate(...)` without awaiting

## Verification

- Build the project: `bun run build`
- Run tests: `bun test`
- Manual check: connect an ACP client, create a session, and verify the startup message appears in the chat UI with all 5 sections populated

## Open Questions

1. **Format preference**: Should the startup message be a compact markdown list, or multi-line with headers/emoji for readability?
2. **Per-session vs. per-connection**: Should this message appear on every `newSession`, or only for the first session created after `initialize`?
3. **Extension detail level**: Should extensions list show just the file path / resolved path, or also include registered tools/commands count if available?
