import { describe, expect, it, mock } from "bun:test";
import { RequestError } from "@agentclientprotocol/sdk";
import type { AgentSession, ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { Model } from "@mariozechner/pi-ai";
import {
  buildModelConfigOption,
  buildModelState,
  buildThinkingLevelConfigOption,
  resolveModelById,
} from "../src/model";

function createMockModel(overrides?: Partial<Model<any>>): Model<any> {
  return {
    id: "test-model",
    name: "Test Model",
    api: "openai-completions",
    provider: "openai",
    baseUrl: "https://api.openai.com",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
    ...overrides,
  } as Model<any>;
}

function createMockSession(overrides?: Partial<AgentSession>): AgentSession {
  return {
    model: createMockModel(),
    thinkingLevel: "medium",
    getAvailableThinkingLevels: () => ["off", "low", "medium", "high"],
    setModel: mock(async () => {}),
    setThinkingLevel: mock(() => {}),
    subscribe: () => () => {},
    prompt: mock(async () => {}),
    abort: mock(async () => {}),
    dispose: mock(() => {}),
    ...overrides,
  } as unknown as AgentSession;
}

describe("buildModelState", () => {
  it("maps available models to ACP model list", () => {
    const models = [
      createMockModel({ provider: "openai", id: "gpt-4", name: "GPT-4" }),
      createMockModel({ provider: "anthropic", id: "claude-3", name: "Claude 3" }),
    ];
    const state = buildModelState(models);
    expect(state.availableModels).toHaveLength(2);
    expect(state.availableModels[0]).toEqual({ modelId: "openai/gpt-4", name: "GPT-4" });
    expect(state.availableModels[1]).toEqual({ modelId: "anthropic/claude-3", name: "Claude 3" });
  });

  it("sets currentModelId when currentModel provided", () => {
    const current = createMockModel({ provider: "openai", id: "gpt-4" });
    const state = buildModelState([], current);
    expect(state.currentModelId).toBe("openai/gpt-4");
  });

  it("uses empty string for currentModelId when no currentModel", () => {
    const state = buildModelState([]);
    expect(state.currentModelId).toBe("");
  });
});

describe("buildModelConfigOption", () => {
  it("builds select config option with current session model", () => {
    const models = [
      createMockModel({ provider: "openai", id: "gpt-4", name: "GPT-4" }),
      createMockModel({ provider: "anthropic", id: "claude-3", name: "Claude 3" }),
    ];
    const session = createMockSession({ model: models[1] });
    const option = buildModelConfigOption(session, models);

    expect(option.id).toBe("model");
    expect(option.name).toBe("Model");
    expect(option.category).toBe("model");
    expect(option.type).toBe("select");
    expect(option.currentValue).toBe("anthropic/claude-3");
    expect(option.options).toHaveLength(2);
    expect(option.options![0]).toEqual({ value: "openai/gpt-4", name: "GPT-4" });
    expect(option.options![1]).toEqual({ value: "anthropic/claude-3", name: "Claude 3" });
  });

  it("uses empty string when session has no model", () => {
    const models = [createMockModel()];
    const session = createMockSession({ model: undefined });
    const option = buildModelConfigOption(session, models);
    expect(option.currentValue).toBe("");
  });
});

describe("buildThinkingLevelConfigOption", () => {
  it("builds select config option with current thinking level", () => {
    const session = createMockSession({
      thinkingLevel: "low",
      getAvailableThinkingLevels: () => ["off", "low", "medium"],
    });
    const option = buildThinkingLevelConfigOption(session);

    expect(option.id).toBe("thinking-level");
    expect(option.name).toBe("Thinking Level");
    expect(option.category).toBe("thought_level");
    expect(option.type).toBe("select");
    expect(option.currentValue).toBe("low");
    expect(option.options).toHaveLength(3);
    expect(option.options![0]).toEqual({ value: "off", name: "Off" });
    expect(option.options![1]).toEqual({ value: "low", name: "Low" });
    expect(option.options![2]).toEqual({ value: "medium", name: "Medium" });
  });

  it("capitalizes level names correctly", () => {
    const session = createMockSession({
      getAvailableThinkingLevels: () => ["high"],
    });
    const option = buildThinkingLevelConfigOption(session);
    expect(option.options![0]).toEqual({ value: "high", name: "High" });
  });
});

describe("resolveModelById", () => {
  function createMockRegistry(models: Model<any>[]): ModelRegistry {
    return {
      find: (provider: string, id: string) =>
        models.find((m) => m.provider === provider && m.id === id),
      getAvailable: () => models,
    } as unknown as ModelRegistry;
  }

  it("resolves a valid provider/model string", () => {
    const models = [
      createMockModel({ provider: "openai", id: "gpt-4", name: "GPT-4" }),
      createMockModel({ provider: "anthropic", id: "claude-3", name: "Claude 3" }),
    ];
    const registry = createMockRegistry(models);
    const result = resolveModelById(registry, "anthropic/claude-3");
    expect(result.provider).toBe("anthropic");
    expect(result.id).toBe("claude-3");
  });

  it("throws RequestError for malformed modelId (no slash)", () => {
    const registry = createMockRegistry([]);
    expect(() => resolveModelById(registry, "bogus")).toThrow(RequestError);
    try {
      resolveModelById(registry, "bogus");
    } catch (e) {
      expect((e as RequestError).message).toBe("Invalid params");
    }
  });

  it("throws RequestError for unknown model", () => {
    const models = [createMockModel({ provider: "openai", id: "gpt-4" })];
    const registry = createMockRegistry(models);
    expect(() => resolveModelById(registry, "openai/unknown")).toThrow(RequestError);
  });

  it("throws RequestError for empty parts after split", () => {
    const registry = createMockRegistry([]);
    expect(() => resolveModelById(registry, "/only-slash")).toThrow(RequestError);
    expect(() => resolveModelById(registry, "only-slash/")).toThrow(RequestError);
  });
});
