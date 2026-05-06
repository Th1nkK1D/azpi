/* eslint-disable no-underscore-dangle */
import { describe, expect, it, mock } from "bun:test";
import { PROTOCOL_VERSION, RequestError } from "@agentclientprotocol/sdk";
import type {
  AgentSideConnection,
  NewSessionRequest,
  PromptRequest,
} from "@agentclientprotocol/sdk";
import { PiAcpAgent } from "../src/pi-acp-agent";
import { mapSessionEvent, mapStopReason } from "../src/event-bridge";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import type { Model } from "@mariozechner/pi-ai";

function createMockConnection(): AgentSideConnection & {
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
  } as unknown as AgentSideConnection & { sessionUpdate: ReturnType<typeof mock> };
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
  const mockSessionId = overrides?.sessionId || `mock-session-${crypto.randomUUID()}`;
  const mockSessionFile = overrides?.sessionFile || `/tmp/sessions/${mockSessionId}.jsonl`;

  const mockResourceLoader = {
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getExtensions: () => ({ extensions: [], errors: [] }),
    getSystemPrompt: () => undefined,
    getAppendSystemPrompt: () => [],
    extendResources: mock(async () => {}),
    reload: mock(async () => {}),
  };

  const mockSessionManager = {
    getEntries: () => [],
    getBranch: () => [],
  };

  return {
    sessionId: mockSessionId,
    sessionFile: mockSessionFile,
    model: createMockModel(),
    thinkingLevel: "medium",
    getAvailableThinkingLevels: () => ["off", "low", "medium", "high"],
    setModel: mock(async () => {}),
    setThinkingLevel: mock(() => {}),
    setSessionName: mock(() => {}),
    sessionName: undefined,
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
    sessionManager: mockSessionManager,
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

function newSessionReq(): NewSessionRequest {
  return { cwd: "/test", mcpServers: [] };
}

function promptReq(sessionId: string, text: string): PromptRequest {
  return {
    sessionId,
    prompt: [{ text, type: "text" }],
  };
}

describe("PiAcpAgent", () => {
  describe("initialize", () => {
    it("returns protocol version and agent info", async () => {
      const conn = createMockConnection();
      const agent = new PiAcpAgent(conn);
      const result = await agent.initialize({
        clientCapabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
        protocolVersion: PROTOCOL_VERSION,
      });
      expect(result.protocolVersion).toBe(PROTOCOL_VERSION);
      expect(result.agentInfo?.name).toBe("azpi");
      expect(result.agentInfo?.version).toBe("0.1.0");
    });

    it("advertises correct capabilities", async () => {
      const models = [createMockModel({ id: "text-only", input: ["text"] })];
      const conn = createMockConnection();
      const agent = new PiAcpAgent(conn, {
        authStorage: createMockAuthStorage(),
        modelRegistry: createMockRegistry(models) as any,
      });
      const result = await agent.initialize({
        clientCapabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
        protocolVersion: PROTOCOL_VERSION,
      });
      expect(result.agentCapabilities?.loadSession).toBe(true);
      expect(result.agentCapabilities?.promptCapabilities?.image).toBe(false);
      expect(result.agentCapabilities?.promptCapabilities?.embeddedContext).toBe(true);
      expect(result.agentCapabilities?.sessionCapabilities?.close).toBeTruthy();
      expect(result.agentCapabilities?.sessionCapabilities?.list).toBeTruthy();
      expect(result.agentCapabilities?.sessionCapabilities?.resume).toBeTruthy();
    });
  });

  describe("initialize capabilities", () => {
    it("advertises image: true when at least one model supports images", async () => {
      const models = [
        createMockModel({ id: "text-only", input: ["text"] }),
        createMockModel({ id: "vision", input: ["text", "image"] }),
      ];
      const conn = createMockConnection();
      const agent = new PiAcpAgent(conn, {
        authStorage: createMockAuthStorage(),
        modelRegistry: createMockRegistry(models) as any,
      });
      const result = await agent.initialize({
        clientCapabilities: {},
        clientInfo: { name: "test", version: "1.0" },
        protocolVersion: PROTOCOL_VERSION,
      });
      expect(result.agentCapabilities?.promptCapabilities?.image).toBe(true);
      expect(result.agentCapabilities?.promptCapabilities?.embeddedContext).toBe(true);
    });

    it("advertises image: false when no models support images", async () => {
      const models = [
        createMockModel({ id: "text-only-1", input: ["text"] }),
        createMockModel({ id: "text-only-2", input: ["text"] }),
      ];
      const conn = createMockConnection();
      const agent = new PiAcpAgent(conn, {
        authStorage: createMockAuthStorage(),
        modelRegistry: createMockRegistry(models) as any,
      });
      const result = await agent.initialize({
        clientCapabilities: {},
        clientInfo: { name: "test", version: "1.0" },
        protocolVersion: PROTOCOL_VERSION,
      });
      expect(result.agentCapabilities?.promptCapabilities?.image).toBe(false);
      expect(result.agentCapabilities?.promptCapabilities?.embeddedContext).toBe(true);
    });
  });

  describe("newSession", () => {
    it("stores clientCapabilities from initialize", async () => {
      const models = [createMockModel()];
      const conn = createMockConnection();
      const agent = new PiAcpAgent(conn, {
        authStorage: createMockAuthStorage(),
        modelRegistry: createMockRegistry(models) as any,
        sessionFactory: async () => ({ session: createMockSession() }),
      });

      await agent.initialize({
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true,
        },
        clientInfo: { name: "test", version: "1.0" },
        protocolVersion: PROTOCOL_VERSION,
      });

      const result = await agent.newSession(newSessionReq());
      expect(result.sessionId).toBeDefined();
    });

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

    it("emits available_commands_update on newSession", async () => {
      const models = [createMockModel()];
      const mockSession = createMockSession({ model: models[0] });
      const conn = createMockConnection();
      const agent = new PiAcpAgent(conn, {
        authStorage: createMockAuthStorage(),
        modelRegistry: createMockRegistry(models) as any,
        sessionFactory: async () => ({ session: mockSession }),
      });

      await agent.newSession(newSessionReq());

      const calls = conn.sessionUpdate.mock.calls as any[];
      const cmdUpdateCalls = calls.filter(
        (call) => call[0].update.sessionUpdate === "available_commands_update",
      );
      expect(cmdUpdateCalls.length).toBe(1);
      const cmds = cmdUpdateCalls[0][0].update.availableCommands;
      expect(cmds.length).toBeGreaterThanOrEqual(5);
      expect(cmds.map((c: any) => c.name)).toContain("name");
      expect(cmds.map((c: any) => c.name)).toContain("reload");
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

  describe("loadSession", () => {
    it("creates a new session when session is not found", async () => {
      const models = [createMockModel()];
      const mockSession = createMockSession({ model: models[0] });
      const conn = createMockConnection();
      const agent = new PiAcpAgent(conn, {
        authStorage: createMockAuthStorage(),
        modelRegistry: createMockRegistry(models) as any,
        sessionFactory: async () => ({ session: mockSession }),
      });

      const result = await agent.loadSession({
        sessionId: "nonexistent",
        cwd: "/test",
        mcpServers: [],
      });
      expect(result.configOptions).toBeDefined();
    });
  });

  describe("resumeSession", () => {
    it("creates a new session when session is not found", async () => {
      const models = [createMockModel()];
      const mockSession = createMockSession({ model: models[0] });
      const conn = createMockConnection();
      const agent = new PiAcpAgent(conn, {
        authStorage: createMockAuthStorage(),
        modelRegistry: createMockRegistry(models) as any,
        sessionFactory: async () => ({ session: mockSession }),
      });

      const result = await agent.unstable_resumeSession({ sessionId: "nonexistent", cwd: "" });
      expect(result).toEqual({});
    });
  });

  describe("unstable_listSessions", () => {
    it("returns empty sessions list when no sessions exist", async () => {
      const models = [createMockModel()];
      const conn = createMockConnection();
      const agent = new PiAcpAgent(conn, {
        authStorage: createMockAuthStorage(),
        modelRegistry: createMockRegistry(models) as any,
      });

      const result = await agent.unstable_listSessions({});
      expect(result.sessions).toBeDefined();
      expect(Array.isArray(result.sessions)).toBe(true);
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
      expect(
        agent.unstable_setSessionModel({
          sessionId: "test-session",
          modelId: "unknown/model",
        }),
      ).rejects.toBeInstanceOf(RequestError);
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
      expect(
        agent.unstable_setSessionModel({
          sessionId: "test-session",
          modelId: "no-slash",
        }),
      ).rejects.toBeInstanceOf(RequestError);
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
      expect(
        agent.setSessionConfigOption({
          sessionId: "test-session",
          configId: "model",
          value: "no-slash",
        }),
      ).rejects.toBeInstanceOf(RequestError);
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
      expect(
        agent.setSessionConfigOption({
          sessionId: "test-session",
          configId: "unknown-option",
          value: "whatever",
        }),
      ).rejects.toBeInstanceOf(RequestError);
    });
  });

  describe("slash commands", () => {
    it("handles /session as a built-in command", async () => {
      const models = [createMockModel()];
      const mockSession = createMockSession({
        model: models[0],
        sessionName: "test-sesh",
        getSessionStats: () => ({
          sessionFile: "/tmp/test.jsonl",
          sessionId: "abc-123",
          userMessages: 2,
          assistantMessages: 1,
          toolCalls: 3,
          toolResults: 3,
          totalMessages: 3,
          tokens: { total: 500, input: 300, output: 200, cacheRead: 0, cacheWrite: 0 },
          cost: 0.001,
          contextUsage: { tokens: 500, contextWindow: 128000, percent: 0.39 },
        }),
      });
      const conn = createMockConnection();
      const agent = new PiAcpAgent(conn, {
        authStorage: createMockAuthStorage(),
        modelRegistry: createMockRegistry(models) as any,
        sessionFactory: async () => ({ session: mockSession }),
      });

      const newResult = await agent.newSession(newSessionReq());
      conn.sessionUpdate.mockClear?.();

      const result = await agent.prompt(promptReq(newResult.sessionId, "/session"));
      expect(result.stopReason).toBe("end_turn");

      expect(mockSession.prompt).not.toHaveBeenCalled();

      const calls = conn.sessionUpdate.mock.calls as any[];
      const msgCalls = calls.filter(
        (call) => call[0].update.sessionUpdate === "agent_message_chunk",
      );
      expect(msgCalls.length).toBe(1);
      expect(msgCalls[0][0].update.content.text).toContain("abc-123");
    });

    it("passes non-slash commands through to session.prompt", async () => {
      const models = [createMockModel()];
      const mockSession = createMockSession({ model: models[0] });
      const conn = createMockConnection();
      const agent = new PiAcpAgent(conn, {
        authStorage: createMockAuthStorage(),
        modelRegistry: createMockRegistry(models) as any,
        sessionFactory: async () => ({ session: mockSession }),
      });

      const newResult = await agent.newSession(newSessionReq());

      const subscribers = (mockSession as any)._subscribers as Array<(event: any) => void>;
      setTimeout(() => {
        for (const sub of subscribers) {
          sub({ type: "agent_end", messages: [{ stopReason: "end_turn" }] });
        }
      }, 5);

      await agent.prompt(promptReq(newResult.sessionId, "Hello, how are you?"));
      expect(mockSession.prompt).toHaveBeenCalled();
    });

    it("passes unknown slash commands through to session.prompt", async () => {
      const models = [createMockModel()];
      const mockSession = createMockSession({ model: models[0] });
      const conn = createMockConnection();
      const agent = new PiAcpAgent(conn, {
        authStorage: createMockAuthStorage(),
        modelRegistry: createMockRegistry(models) as any,
        sessionFactory: async () => ({ session: mockSession }),
      });

      const newResult = await agent.newSession(newSessionReq());

      const subscribers = (mockSession as any)._subscribers as Array<(event: any) => void>;
      setTimeout(() => {
        for (const sub of subscribers) {
          sub({ type: "agent_end", messages: [{ stopReason: "end_turn" }] });
        }
      }, 5);

      await agent.prompt(promptReq(newResult.sessionId, "/unknown arg"));
      expect(mockSession.prompt).toHaveBeenCalled();
    });
  });

  describe("auto session naming", () => {
    it("sets session name from first prompt when no existing name", async () => {
      const models = [createMockModel()];
      const mockSession = createMockSession({ model: models[0], sessionName: undefined });
      const conn = createMockConnection();
      const agent = new PiAcpAgent(conn, {
        authStorage: createMockAuthStorage(),
        modelRegistry: createMockRegistry(models) as any,
        sessionFactory: async () => ({ session: mockSession }),
      });

      const newResult = await agent.newSession(newSessionReq());

      const subscribers = (mockSession as any)._subscribers as Array<(event: any) => void>;
      setTimeout(() => {
        for (const sub of subscribers) {
          sub({ type: "agent_end", messages: [{ stopReason: "end_turn" }] });
        }
      }, 5);

      await agent.prompt(promptReq(newResult.sessionId, "Hello, how are you?"));
      expect(mockSession.setSessionName).toHaveBeenCalledWith("Hello, how are you?");
    });

    it("does not override existing session name", async () => {
      const models = [createMockModel()];
      const mockSession = createMockSession({ model: models[0], sessionName: "Existing Name" });
      const conn = createMockConnection();
      const agent = new PiAcpAgent(conn, {
        authStorage: createMockAuthStorage(),
        modelRegistry: createMockRegistry(models) as any,
        sessionFactory: async () => ({ session: mockSession }),
      });

      const newResult = await agent.newSession(newSessionReq());

      const subscribers = (mockSession as any)._subscribers as Array<(event: any) => void>;
      setTimeout(() => {
        for (const sub of subscribers) {
          sub({ type: "agent_end", messages: [{ stopReason: "end_turn" }] });
        }
      }, 5);

      await agent.prompt(promptReq(newResult.sessionId, "Hello, how are you?"));
      expect(mockSession.setSessionName).not.toHaveBeenCalled();
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

  describe("agent_end emits session_info_update", () => {
    it("emits session_info_update with updatedAt when agent_end fires", async () => {
      const models = [createMockModel()];
      const mockSession = createMockSession({ model: models[0] });
      const conn = createMockConnection();
      const agent = new PiAcpAgent(conn, {
        authStorage: createMockAuthStorage(),
        modelRegistry: createMockRegistry(models) as any,
        sessionFactory: async () => ({ session: mockSession }),
      });

      const newResult = await agent.newSession(newSessionReq());
      conn.sessionUpdate.mockClear?.();

      const subscribers = (mockSession as any)._subscribers as Array<(event: any) => void>;
      setTimeout(() => {
        for (const sub of subscribers) {
          sub({ type: "agent_end", messages: [{ stopReason: "end_turn" }] });
        }
      }, 5);

      const promptPromise = agent.prompt(promptReq(newResult.sessionId, "test"));
      await promptPromise;

      await new Promise((r) => setTimeout(r, 10));

      const calls = conn.sessionUpdate.mock.calls as any[];
      const infoUpdateCalls = calls.filter(
        (call) => call[0].update.sessionUpdate === "session_info_update",
      );
      expect(infoUpdateCalls.length).toBeGreaterThanOrEqual(1);
      expect(infoUpdateCalls[0][0].update.updatedAt).toBeDefined();
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
