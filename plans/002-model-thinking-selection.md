# Plan: Model & Thinking Selection Sync

## Context

The `azpi` ACP adapter currently creates Pi `AgentSession`s without passing a `ModelRegistry` or `AuthStorage`, and does not expose model/thinking configuration to ACP clients. We need to:

1. **Load available models** from Pi's `ModelRegistry` (built-in + custom `models.json`).
2. **Sync model selection** between ACP and Pi (ACP `session/set_model` ↔ Pi `session.setModel()`).
3. **Sync thinking level selection** between ACP and Pi (ACP `session/set_config_option` ↔ Pi `session.setThinkingLevel()`).

The Pi SDK example ([`02-custom-model.ts`](https://github.com/badlogic/pi-mono/raw/refs/heads/main/packages/coding-agent/examples/sdk/02-custom-model.ts)) shows the pattern:

- `AuthStorage.create()` + `ModelRegistry.create(authStorage)`
- `modelRegistry.getAvailable()` → `createAgentSession({ model, thinkingLevel, authStorage, modelRegistry })`
- `session.setModel(model)` and `session.setThinkingLevel(level)` at runtime

## Current Architecture

- `src/main.ts` — bootstrap: stdio → `ndJsonStream` → `AgentSideConnection` → `PiAcpAgent`
- `src/pi-acp-agent.ts` — implements `acp.Agent`; manages `Map<string, AgentSession>`
- `src/event-bridge.ts` — maps Pi `AgentSessionEvent` → ACP `SessionNotification`

ACP primitives we will use:

- `NewSessionResponse.models` / `NewSessionResponse.configOptions` — initial per-session state
- `SessionConfigOption` with `category: "model"` — model selector rendered by ACP clients
- `SessionConfigOption` with `category: "thought_level"` — thinking-level selector
- `Agent.unstable_setSessionModel()` — ACP → Pi model change (unstable `session/set_model` endpoint)
- `Agent.setSessionConfigOption()` — ACP → Pi config change (handles both `"model"` and `"thinking-level"`)
- `SessionNotification` with `sessionUpdate: "config_option_update"` — Pi → ACP config changes

## Approach

1. **Shared auth & registry** — Create one `AuthStorage.create()` and `ModelRegistry.create(authStorage)` in `PiAcpAgent` (default `~/.pi/agent` paths, transparently sharing Pi CLI config).
2. **Model mapping** — Map Pi `Model<Api>` → ACP `ModelInfo` using `${provider}/${id}` as `modelId`. Cache `modelRegistry.getAvailable()` in the constructor.
3. **Session bootstrap** — Pass `authStorage` and `modelRegistry` to `createAgentSession`. After creation, ensure a model is selected (fallback to first available) and read `session.thinkingLevel`.
4. **Model as config option** — ACP clients render the model selector from `configOptions` with `category: "model"`, not from the unstable `models` field alone. We expose model selection as a `SessionConfigOption` (`id: "model"`, `type: "select"`, `category: "model"`) alongside the thinking-level option.
5. **ACP ↔ Pi sync** —
   - `session/set_model` → `session.setModel()` → proactive `config_option_update` notification (model + thinking options may both change).
   - `session/set_config_option` (`model`) → `session.setModel()` → return updated full config options.
   - `session/set_config_option` (`thinking-level`) → `session.setThinkingLevel()` → return updated full config options.
   - Pi `thinking_level_changed` event → `config_option_update` notification with full config array.
6. **Dynamic filtering** — `buildThinkingLevelConfigOption()` reads `session.getAvailableThinkingLevels()` and `session.thinkingLevel`; `buildModelConfigOption()` reads `session.model` and `availableModels`. Both are recomputed and sent together on every model or level change.

## Files to modify

- `src/pi-acp-agent.ts` — add registry/auth, `models`/`configOptions` in session responses, implement `unstable_setSessionModel` + `setSessionConfigOption`, handle `thinking_level_changed` in `onEvent`.
- `src/pi-acp-agent.spec.ts` — unit tests for model selection, thinking level sync, and config-option notifications.

## Reuse

- `AuthStorage.create()` and `ModelRegistry.create(authStorage)` from `@earendil-works/pi-coding-agent` (default paths).
- `ModelRegistry.getAvailable()` — synchronous list of auth-ready models.
- `ModelRegistry.find(provider, modelId)` — resolve model from ACP `modelId`.
- `AgentSession.setModel(model)` — async model switch.
- `AgentSession.setThinkingLevel(level)` — sync level switch.
- `AgentSession.getAvailableThinkingLevels()` — levels valid for current model.
- `AgentSession.thinkingLevel` / `AgentSession.model` getters — current state.

## Steps

- [x] **1. Add registry & auth to `PiAcpAgent`**
  - Import `AuthStorage`, `ModelRegistry`.
  - Add `readonly authStorage = AuthStorage.create()`.
  - Add `readonly modelRegistry = ModelRegistry.create(this.authStorage)`.
  - Add `readonly availableModels = this.modelRegistry.getAvailable()`.
  - Add helper `mapPiModelToAcpModelInfo(model)` → `{ modelId: "provider/id", name }`.
  - Add helper `buildModelState(currentModel)` → `SessionModelState`.

- [x] **2. Update `newSession`**
  - Pass `authStorage` and `modelRegistry` to `createAgentSession`.
  - If `session.model` is undefined and `availableModels.length > 0`, call `await session.setModel(availableModels[0])`.
  - Build `SessionModelState` from the resolved model.
  - Build `SessionConfigOption` for model (`id: "model"`, `category: "model"`, `type: "select"`, options from `availableModels`, `currentValue` from `session.model`).
  - Build `SessionConfigOption` for thinking level (`id: "thinking-level"`, `category: "thought_level"`, `type: "select"`, options from `session.getAvailableThinkingLevels()`, `currentValue` from `session.thinkingLevel`).
  - Return both `models` and `configOptions` in `NewSessionResponse`.

- [x] **3. Implement `unstable_setSessionModel`**
  - Parse `params.modelId` as `provider/id`.
  - Look up model via `this.modelRegistry.find(provider, id)`.
  - Throw `RequestError.invalidParams` if not found.
  - Call `await session.setModel(model)`.
  - After success, call internal `sendConfigOptionsUpdate(sessionId)` (rebuilds both model and thinking-level options and sends `config_option_update`).
  - Return `{}`.

- [x] **4. Implement `setSessionConfigOption`**
  - For `configId === "model"`, parse `params.value` as `provider/id`, look up model, call `await session.setModel(model)`.
  - For `configId === "thinking-level"`, call `session.setThinkingLevel(value)`.
  - Reject unknown `configId` with `invalidParams`.
  - Return `SetSessionConfigOptionResponse` with the full config-options array (model + thinking-level).

- [x] **5. Handle Pi → ACP thinking-level changes**
  - In `onEvent`, intercept `event.type === "thinking_level_changed"` before calling `mapSessionEvent`.
  - Call `sendConfigOptionsUpdate(sessionId)` (sends full config array including model) and return early (skip default event mapping).

- [x] **6. Tests**
  - Mock `AuthStorage`, `ModelRegistry`, and `AgentSession`.
  - Verify `newSession` returns correct `models` and `configOptions` (both model and thinking-level).
  - Verify `unstable_setSessionModel` updates model and sends `config_option_update`.
  - Verify `setSessionConfigOption` updates both model and thinking level and returns updated options.
  - Verify `thinking_level_changed` Pi event triggers ACP notification.

## Verification

- `bun test` passes (including new tests).
- Manual check: connect an ACP client, confirm model selector and thinking-level dropdown populate, and changes sync bidirectionally.
