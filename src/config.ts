import type { SessionModelState, SessionConfigOption } from "@agentclientprotocol/sdk";
import type { Model } from "@mariozechner/pi-ai";
import type { AgentSession } from "@mariozechner/pi-coding-agent";

type SessionConfigWithOptions = SessionConfigOption & {
  options: { value: string; name: string }[];
};

export function buildModelState(
  availableModels: Model<any>[],
  currentModel?: Model<any>,
): SessionModelState {
  return {
    availableModels: availableModels.map(({ provider, id, name }) => ({
      modelId: `${provider}/${id}`,
      name,
    })),
    currentModelId: currentModel ? `${currentModel.provider}/${currentModel.id}` : "",
  };
}

export function buildModelConfigOption(
  session: AgentSession,
  availableModels: Model<any>[],
): SessionConfigWithOptions {
  return {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: session.model ? `${session.model.provider}/${session.model.id}` : "",
    options: availableModels.map((m) => ({
      value: `${m.provider}/${m.id}`,
      name: m.name,
    })),
  };
}

export function buildThinkingLevelConfigOption(session: AgentSession): SessionConfigWithOptions {
  const levels = session.getAvailableThinkingLevels();
  return {
    id: "thinking-level",
    name: "Thinking Level",
    category: "thought_level",
    type: "select",
    currentValue: session.thinkingLevel,
    options: levels.map((level) => ({
      value: level,
      name: level.charAt(0).toUpperCase() + level.slice(1),
    })),
  };
}
