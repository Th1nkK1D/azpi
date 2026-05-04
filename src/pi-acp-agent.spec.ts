import { describe, expect, it, mock } from "bun:test";
import * as acp from "@agentclientprotocol/sdk";
import { PiAcpAgent } from "./pi-acp-agent";
import { mapSessionEvent, mapStopReason } from "./event-bridge";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import type { Model } from "@mariozechner/pi-ai";

// ─── Helpers ───────────────────────────────────────────────────────

function createMockConnection(): acp.AgentSideConnection & {
  sessionUpdate: ReturnType<typeof mock>;
} {
  const sessionUpdate = mock(async () => {});
  return {
    closed: Promise.resolve(),
    extMethod: mock(async () => ({})),
    extNotification: mock(async () => {}),
    requestPermission: mock(async () => ({ action: "allow" as const })),
    sessionUpdate,
    signal: new AbortController().signal,
  } as unknown as acp.AgentSideConnection & { sessionUpdate: ReturnType<typeof mock> };
}

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
  const subscribers: Array<(event: any) => void> = [];

  const mockResourceLoader = {
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getExtensions: () => ({ extensions: [], errors: [] }),
  };

  return {
    model: createMockModel(),
    thinkingLevel: "medium",
    getAvailableThinkingLevels: () => ["off", "low", "medium", "high"],
    setModel: mock(async () => {}),
    setThinkingLevel: mock(() => {}),
    subscribe: (cb: any) => {
      subscribers.push(cb);
      return () => {
        const idx = subscribers.indexOf(cb);
        if (idx !== -1) subscribers.splice(idx, 1);
      };
    },
    prompt: mock(async () => {}),
    abort: mock(async () => {}),
    dispose: mock(() => {}),
    resourceLoader: mockResourceLoader,
    _subscribers: subscribers,
    ...overrides,
  } as unknown as AgentSession;
}

function createMockRegistry(models: Model<any>[]) {
  return {
    getAvailable: () => models,
    find: (provider: string, id: string) =>
      models.find((m) => m.provider === provider && m.id === id),
  };
}

function createMockAuthStorage() {
  return {} as any;
}

function newSessionReq(): acp.NewSessionRequest {
  return { cwd: "/test", mcpServers: [] };
}

describe("PiAcpAgent", () => {
  describe("initialize", () => {
    it("returns protocol version and agent info", async () => {
      const conn = createMockConnection();
      const agent = new PiAcpAgent(conn);
      const result = await agent.initialize({
        clientCapabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
        protocolVersion: acp.PROTOCOL_VERSION,
      });
      expect(result.protocolVersion).toBe(acp.PROTOCOL_VERSION);
      expect(result.agentInfo?.name).toBe("azpi");
      expect(result.agentInfo?.version).toBe("0.1.0");
    });

    it("advertises correct capabilities", async () => {
      const conn = createMockConnection();
      const agent = new PiAcpAgent(conn);
      const result = await agent.initialize({
        clientCapabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
        protocolVersion: acp.PROTOCOL_VERSION,
      });
      expect(result.agentCapabilities?.loadSession).toBe(false);
      expect(result.agentCapabilities?.promptCapabilities?.image).toBe(false);
      expect(result.agentCapabilities?.sessionCapabilities?.close).toBeTruthy();
    });
  });

  describe("newSession", () => {
    it("returns sessionId with models and configOptions", async () => {
      const models = [createMockModel({ provider: "openai", id: "gpt-4", name: "GPT-4" })];
      const mockSession = createMockSession({ model: models[0] });
      const conn = createMockConnection();
      const agent = new PiAcpAgent(conn, {
        authStorage: createMockAuthStorage(),
        modelRegistry: createMockRegistry(models) as any,
        sessionFactory: async () => ({ session: mockSession }),
      });

      const result = await agent.newSession(newSessionReq());
      expect(result.sessionId).toBeDefined();
      expect(result.models).toBeDefined();
      expect(result.models!.currentModelId).toBe("openai/gpt-4");
      expect(result.configOptions).toBeDefined();
      expect(result.configOptions).toHaveLength(2);
      expect(result.configOptions![0]!.id).toBe("model");
      expect(result.configOptions![0]!.category).toBe("model");
      expect(result.configOptions![0]!.currentValue).toBe("openai/gpt-4");
      expect(result.configOptions![1]!.id).toBe("thinking-level");
      expect(result.configOptions![1]!.category).toBe("thought_level");
      expect(result.configOptions![1]!.currentValue).toBe("medium");
    });

    it("falls back to first available model when session has no model", async () => {
      const models = [createMockModel({ provider: "anthropic", id: "claude-3", name: "Claude 3" })];
      let currentModel: Model<any> | undefined = undefined;
      const mockSession = createMockSession({
        model: undefined,
        setModel: mock(async (model: Model<any>) => {
          currentModel = model;
        }),
      });
      Object.defineProperty(mockSession, "model", {
        get: () => currentModel,
        configurable: true,
      });
      const conn = createMockConnection();
      const agent = new PiAcpAgent(conn, {
        authStorage: createMockAuthStorage(),
        modelRegistry: createMockRegistry(models) as any,
        sessionFactory: async () => ({ session: mockSession }),
      });

      const result = await agent.newSession(newSessionReq());
      expect(result.models).toBeDefined();
      expect(result.models!.currentModelId).toBe("anthropic/claude-3");
      expect(mockSession.setModel).toHaveBeenCalled();
    });
  });

  describe("unstable_setSessionModel", () => {
    it("changes the model and sends config_option_update", async () => {
      const mockSession = createMockSession();
      const models = [
        createMockModel({ provider: "openai", id: "gpt-4", name: "GPT-4" }),
        createMockModel({ provider: "anthropic", id: "claude-3", name: "Claude 3" }),
      ];
      const conn = createMockConnection();
      const agent = new PiAcpAgent(conn, {
        authStorage: createMockAuthStorage(),
        modelRegistry: createMockRegistry(models) as any,
        sessionFactory: async () => ({ session: mockSession }),
      });

      const newSessionResult = await agent.newSession(newSessionReq());
      const result = await agent.unstable_setSessionModel({
        sessionId: newSessionResult.sessionId,
        modelId: "anthropic/claude-3",
      });

      expect(result).toEqual({});
      expect(mockSession.setModel).toHaveBeenCalled();
      const calls = conn.sessionUpdate.mock.calls as any[];
      const configUpdateCalls = calls.filter(
        (call) => call[0].update.sessionUpdate === "config_option_update",
      );
      expect(configUpdateCalls.length).toBeGreaterThanOrEqual(1);
    });

    it("throws invalidParams for unknown modelId", async () => {
      const mockSession = createMockSession();
      const models = [createMockModel({ provider: "openai", id: "gpt-4" })];
      const conn = createMockConnection();
      const agent = new PiAcpAgent(conn, {
        authStorage: createMockAuthStorage(),
        modelRegistry: createMockRegistry(models) as any,
        sessionFactory: async () => ({ session: mockSession }),
      });

      await agent.newSession(newSessionReq());
      await expect(
        agent.unstable_setSessionModel({
          sessionId: "test-session",
          modelId: "unknown/model",
        }),
      ).rejects.toBeInstanceOf(acp.RequestError);
    });

    it("throws invalidParams for malformed modelId", async () => {
      const mockSession = createMockSession();
      const models = [createMockModel()];
      const conn = createMockConnection();
      const agent = new PiAcpAgent(conn, {
        authStorage: createMockAuthStorage(),
        modelRegistry: createMockRegistry(models) as any,
        sessionFactory: async () => ({ session: mockSession }),
      });

      await agent.newSession(newSessionReq());
      await expect(
        agent.unstable_setSessionModel({
          sessionId: "test-session",
          modelId: "no-slash",
        }),
      ).rejects.toBeInstanceOf(acp.RequestError);
    });
  });

  describe("setSessionConfigOption", () => {
    it("updates thinking level and returns configOptions", async () => {
      let currentThinkingLevel: AgentSession["thinkingLevel"] = "medium";
      const mockSession = createMockSession({
        thinkingLevel: currentThinkingLevel,
        setThinkingLevel: mock((level: AgentSession["thinkingLevel"]) => {
          currentThinkingLevel = level;
        }),
      });
      Object.defineProperty(mockSession, "thinkingLevel", {
        get: () => currentThinkingLevel,
        configurable: true,
      });
      const models = [createMockModel()];
      const conn = createMockConnection();
      const agent = new PiAcpAgent(conn, {
        authStorage: createMockAuthStorage(),
        modelRegistry: createMockRegistry(models) as any,
        sessionFactory: async () => ({ session: mockSession }),
      });

      const newSessionResult = await agent.newSession(newSessionReq());
      const result = await agent.setSessionConfigOption({
        sessionId: newSessionResult.sessionId,
        configId: "thinking-level",
        value: "high",
      });

      expect(mockSession.setThinkingLevel).toHaveBeenCalledWith("high");
      expect(result.configOptions).toHaveLength(2);
      expect(result.configOptions[0]!.id).toBe("model");
      expect(result.configOptions[1]!.id).toBe("thinking-level");
      expect(result.configOptions[1]!.currentValue).toBe("high");
    });

    it("updates model via config option and returns configOptions", async () => {
      const models = [
        createMockModel({ provider: "openai", id: "gpt-4", name: "GPT-4" }),
        createMockModel({ provider: "anthropic", id: "claude-3", name: "Claude 3" }),
      ];
      let currentModel: Model<any> | undefined = models[0];
      const mockSession = createMockSession({
        model: currentModel,
        setModel: mock(async (model: Model<any>) => {
          currentModel = model;
        }),
      });
      Object.defineProperty(mockSession, "model", {
        get: () => currentModel,
        configurable: true,
      });
      const conn = createMockConnection();
      const agent = new PiAcpAgent(conn, {
        authStorage: createMockAuthStorage(),
        modelRegistry: createMockRegistry(models) as any,
        sessionFactory: async () => ({ session: mockSession }),
      });

      const newSessionResult = await agent.newSession(newSessionReq());
      const result = await agent.setSessionConfigOption({
        sessionId: newSessionResult.sessionId,
        configId: "model",
        value: "anthropic/claude-3",
      });

      expect(mockSession.setModel).toHaveBeenCalled();
      expect(result.configOptions).toHaveLength(2);
      expect(result.configOptions[0]!.id).toBe("model");
      expect(result.configOptions[0]!.currentValue).toBe("anthropic/claude-3");
      expect(result.configOptions[1]!.id).toBe("thinking-level");
    });

    it("throws invalidParams for invalid model config value", async () => {
      const mockSession = createMockSession();
      const models = [createMockModel()];
      const conn = createMockConnection();
      const agent = new PiAcpAgent(conn, {
        authStorage: createMockAuthStorage(),
        modelRegistry: createMockRegistry(models) as any,
        sessionFactory: async () => ({ session: mockSession }),
      });

      await agent.newSession(newSessionReq());
      await expect(
        agent.setSessionConfigOption({
          sessionId: "test-session",
          configId: "model",
          value: "no-slash",
        }),
      ).rejects.toBeInstanceOf(acp.RequestError);
    });

    it("throws invalidParams for unknown configId", async () => {
      const mockSession = createMockSession();
      const models = [createMockModel()];
      const conn = createMockConnection();
      const agent = new PiAcpAgent(conn, {
        authStorage: createMockAuthStorage(),
        modelRegistry: createMockRegistry(models) as any,
        sessionFactory: async () => ({ session: mockSession }),
      });

      await agent.newSession(newSessionReq());
      await expect(
        agent.setSessionConfigOption({
          sessionId: "test-session",
          configId: "unknown-option",
          value: "whatever",
        }),
      ).rejects.toBeInstanceOf(acp.RequestError);
    });
  });

  describe("onEvent thinking_level_changed", () => {
    it("sends config_option_update notification", async () => {
      const mockSession = createMockSession();
      const models = [createMockModel()];
      const conn = createMockConnection();
      const agent = new PiAcpAgent(conn, {
        authStorage: createMockAuthStorage(),
        modelRegistry: createMockRegistry(models) as any,
        sessionFactory: async () => ({ session: mockSession }),
      });

      await agent.newSession(newSessionReq());
      conn.sessionUpdate.mockClear?.();

      const subscribers = (mockSession as any)._subscribers as Array<(event: any) => void>;
      for (const subscriber of subscribers) {
        subscriber({ type: "thinking_level_changed", level: "high" });
      }

      await new Promise((r) => setTimeout(r, 10));

      const calls = conn.sessionUpdate.mock.calls as any[];
      const configUpdateCalls = calls.filter(
        (call) => call[0].update.sessionUpdate === "config_option_update",
      );
      expect(configUpdateCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("prompt text extraction", () => {
    it("extracts text from simple content blocks", () => {
      const blocks: acp.ContentBlock[] = [
        { text: "Hello ", type: "text" },
        { text: "world", type: "text" },
      ];
      expect(blocks.length).toBe(2);
      const textBlocks = blocks.filter(
        (b): b is acp.TextContent & { type: "text" } => b.type === "text",
      );
      expect(textBlocks[0]!.text).toBe("Hello ");
      expect(textBlocks[1]!.text).toBe("world");
    });

    it("handles resource_link blocks", () => {
      const block: acp.ContentBlock = {
        name: "test.txt",
        type: "resource_link",
        uri: "file:///test.txt",
      };
      expect(block.type).toBe("resource_link");
    });
  });
});

describe("mapStopReason", () => {
  it("maps aborted to cancelled", () => {
    expect(mapStopReason({ stopReason: "aborted" })).toBe("cancelled");
  });

  it("maps end_turn to end_turn", () => {
    expect(mapStopReason({ stopReason: "end_turn" })).toBe("end_turn");
  });

  it("maps error to end_turn", () => {
    expect(mapStopReason({ stopReason: "error" })).toBe("end_turn");
  });
});

describe("mapSessionEvent", () => {
  it("returns null for agent_end (handled separately)", () => {
    const result = mapSessionEvent({ messages: [], type: "agent_end" }, "sid");
    expect(result).toBeNull();
  });

  it("emits tool_call for tool_execution_start", () => {
    const result = mapSessionEvent(
      {
        args: { path: "test.txt" },
        toolCallId: "1",
        toolName: "read",
        type: "tool_execution_start",
      },
      "sid",
    );
    expect(result).not.toBeNull();
    expect(result!.update.sessionUpdate).toBe("tool_call");
    expect((result!.update as any).toolCallId).toBe("1");
  });
});
