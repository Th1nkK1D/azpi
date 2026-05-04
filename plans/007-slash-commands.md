# Plan: Slash Commands Support

## Context

Pi has a rich slash-command ecosystem that we need to expose through the ACP adapter:

1. **Built-in commands** (e.g. `/compact`, `/name`, `/copy`, `/export`) — handled by Pi's interactive UI layer; `AgentSession.prompt()` does NOT process these.
2. **Skill activation** (`/skill:name`) — `AgentSession.prompt()` expands skill blocks automatically.
3. **Custom extension commands** — registered via `pi.registerCommand()`; `AgentSession.prompt()` executes them via the extension runner.
4. **Prompt templates** (`/templatename`) — `AgentSession.prompt()` expands them automatically.

ACP has a native `available_commands_update` notification that lets clients show command suggestions. Currently `azpi` forwards raw prompt text to `session.prompt()` without any command interception or advertisement.

## Initial Findings

- ACP schema defines `AvailableCommand`, `AvailableCommandsInput`, and `AvailableCommandsUpdate` (`sessionUpdate: "available_commands_update"`).
- `AgentSession` exposes:
  - `resourceLoader.getSkills()` — loaded skills
  - `resourceLoader.getPrompts()` — loaded prompt templates
  - `extensionRunner` + `getCommands()` — extension-registered commands (once bound)
- `AgentSession.prompt()` already handles extension commands, skill blocks, and prompt-template expansion.
- Built-in commands are **not** handled by `AgentSession.prompt()`; they are implemented in Pi's interactive/print/RPC mode layers.
- Extension commands may require `ExtensionCommandContext` (with UI methods like `select()`, `confirm()`, `input()`). In ACP mode there is no TUI, so interactive extension commands will fail at runtime. We cannot statically determine which extension commands are TUI-dependent.

## Approach

### Command categories to expose

| Category           | Discovery source                                                  | Execution path                                                                         |
| ------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Built-in           | Hard-coded subset (non-TUI only) mapped to `AgentSession` methods | Intercepted in `PiAcpAgent.prompt()`, routed to session method                         |
| Skills             | `session.resourceLoader.getSkills()`                              | Passed through to `session.prompt()` (auto-expanded)                                   |
| Extension commands | `session.extensionRunner.getCommands()` (after binding)           | Passed through to `session.prompt()` (auto-executed). May fail if command requires TUI |
| Prompt templates   | `session.resourceLoader.getPrompts()`                             | Passed through to `session.prompt()` (auto-expanded)                                   |

### Built-in commands to support (non-TUI only)

| Command             | `AgentSession` mapping                 | Notes                                                                                   |
| ------------------- | -------------------------------------- | --------------------------------------------------------------------------------------- |
| `/name <name>`      | `session.setSessionName(name)`         | Simple setter                                                                           |
| `/session`          | `session.getSessionStats()`            | Returns formatted stats text                                                            |
| `/compact [prompt]` | `session.compact(customInstructions?)` | Optional custom instructions                                                            |
| `/export [file]`    | `session.exportToHtml(outputPath?)`    | Optional path; defaults auto-generated                                                  |
| `/reload`           | `session.reload()`                     | Reloads extensions, skills, prompts. After success, re-emit `available_commands_update` |

**Excluded built-in commands:** `/login`, `/logout`, `/model`, `/scoped-models`, `/settings`, `/resume`, `/new`, `/tree`, `/fork`, `/clone`, `/copy`, `/share`, `/hotkeys`, `/changelog`, `/quit` — all require TUI interaction or are not applicable to the ACP adapter.

### Advertising commands

Send `available_commands_update`:

- After `newSession` response is sent
- After `/reload` completes successfully (commands may have changed)
- (Optional) After extension resource changes if the SDK emits a signal

Format for ACP:

- Built-ins: `name` without leading `/` (e.g. `"compact"`), `description` from Pi docs
- Skills: `name` as `skill:<skillname>`, `description` from skill metadata
- Prompts: `name` as prompt template name, `description` from prompt metadata
- Extension commands: `name` as registered command name, `description` from registration

All commands that accept free-form arguments will declare `input: { type: "unstructured" }`.

### Prompt interception

In `PiAcpAgent.prompt()`:

1. Concatenate text content blocks into the raw prompt string.
2. If the string starts with `/`:
   - Parse command name and arguments.
   - If it matches a supported built-in, execute the corresponding `AgentSession` method.
   - Return a synthetic `PromptResponse` with `stopReason: "end_turn"` and any command output as agent message chunks.
   - If it matches a known skill/prompt/extension command prefix, pass through to `session.prompt()` as-is.
3. If not a command (or unknown command), pass the text through to `session.prompt()` normally.

### Extension command TUI limitation

Extension commands are only advertised when the `PI_ACP_ALLOW_EXTENSION_COMMANDS` environment variable is set. It contains a comma-separated list of command names to expose (e.g. `PI_ACP_ALLOW_EXTENSION_COMMANDS="stats,deploy"`). When unset or empty, no extension commands are advertised.

We will **not** provide a `ExtensionUIContext` implementation in ACP mode. Commands that call `ctx.ui.select/confirm/input/...` will throw at runtime. In `PiAcpAgent.prompt()`, any extension command execution is wrapped in a `try/catch`. On failure, we send the error text to the client as an `agent_message_chunk`, then resolve the prompt with `stopReason: "end_turn"`, allowing the client to continue. This is acceptable because:

- We cannot statically determine TUI requirements from command metadata.
- Non-interactive extension commands (e.g. toggles, state dumps) will work fine.
- If demand grows, a future iteration can add a minimal `ExtensionUIContext` bridge using ACP elicitations.

### `/reload` side effects

When `/reload` is invoked:

1. Call `session.reload()`.
2. Await completion.
3. Re-run command discovery.
4. Emit `available_commands_update` with the refreshed list.

## Files to create / modify

| File                         | Purpose                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/slash-commands.ts`      | **New.** Built-in command registry, argument parsing, discovery helpers for skills/prompts/extension commands, ACP `AvailableCommand[]` builder.  |
| `src/slash-commands.spec.ts` | **New.** Tests for command parsing, discovery, and built-in routing.                                                                              |
| `src/pi-acp-agent.ts`        | Intercept slash commands in `prompt()`, route built-ins, pass-through others. Emit `available_commands_update` after session creation and reload. |
| `src/pi-acp-agent.spec.ts`   | Add tests for built-in command routing and `available_commands_update` emission.                                                                  |
| `src/event-bridge.ts`        | Ensure `available_commands_update` can be emitted (type-safe wrapper if needed).                                                                  |
| `src/startup-message.ts`     | Optionally mention that slash commands are available via ACP command palette.                                                                     |

## Steps

- [ ] **Step 1 — Define built-in command mappings**
      Create `src/slash-commands.ts` with the built-in command table (name → handler factory). Each handler receives `(session: AgentSession, args: string)` and returns `{ text: string }` (command output). Include: `/name`, `/session`, `/compact`, `/export`, `/reload`.
      **Test:** `slash-commands.spec.ts` — assert each built-in parses args correctly and calls the right `AgentSession` method.

- [ ] **Step 2 — Implement command discovery**
      Add helpers in `src/slash-commands.ts` to collect commands from:
  - Hard-coded built-ins
  - `session.resourceLoader.getSkills()`
  - `session.resourceLoader.getPrompts()`
  - `session.extensionRunner.getCommands()` (after binding)
    Map them to ACP `AvailableCommand[]` format.
    **Test:** Mock `ResourceLoader` and `ExtensionRunner`, assert discovery returns correct `AvailableCommand` shapes.

- [ ] **Step 3 — Emit `available_commands_update`**
      In `PiAcpAgent.newSession()`, after the startup message, call the discovery helper and send a `sessionUpdate` with `sessionUpdate: "available_commands_update"`.
      **Test:** `pi-acp-agent.spec.ts` — assert `connection.sessionUpdate` is called with the correct command list after session creation.

- [ ] **Step 4 — Intercept prompts and route built-ins**
      In `PiAcpAgent.prompt()`, before calling `session.prompt()`, check if the text starts with `/`. Parse `/<name> [args]`. If `name` is a supported built-in, invoke its handler, stream the output as `agent_message_chunk` notifications, and resolve the prompt with `stopReason: "end_turn"`. Otherwise pass the text through unchanged.
      **Test:** `pi-acp-agent.spec.ts` — simulate `/name foo`, verify `session.setSessionName` is called and prompt resolves with `end_turn`. Simulate `/unknown`, verify it falls through to `session.prompt()`.

- [ ] **Step 5 — Handle `/reload` side effects**
      When the `/reload` built-in handler runs, await `session.reload()`, then re-run command discovery and emit an updated `available_commands_update`.
      **Test:** `pi-acp-agent.spec.ts` — mock `session.reload()` to mutate available skills, assert a second `available_commands_update` is emitted with the new list.

- [ ] **Step 6 — Tests**
      Run `bun test` and fix failures.

## Decisions

| Topic                 | Decision                                                                            | Rationale                                                                                                  |
| --------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Built-in commands     | Support only non-TUI subset (`/name`, `/session`, `/compact`, `/export`, `/reload`) | TUI commands (`/model`, `/settings`, `/tree`, etc.) require interactive UI primitives not available in ACP |
| `/model`              | **Excluded**                                                                        | Client can change model via ACP's `unstable_setSessionModel` or config options                             |
| `/share`              | **Excluded**                                                                        | Would require gist upload logic; out of scope                                                              |
| `/reload`             | **Included**                                                                        | Feasible; just calls `session.reload()`. After completion we re-emit command list                          |
| Extension command TUI | Advertise all, fail at runtime if TUI used                                          | Cannot statically determine TUI requirements from command metadata                                         |
| Command update timing | Emit on `newSession` and after `/reload`                                            | Covers initial load and dynamic changes                                                                    |
