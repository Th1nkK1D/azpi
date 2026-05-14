import { describe, expect, it, mock } from "bun:test";
import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import type { AgentSideConnection } from "@agentclientprotocol/sdk";

let capturedCreateAgentSessionOptions: any;

mock.module("@earendil-works/pi-coding-agent", () => ({
  VERSION: "0.0.0-test",
  AuthStorage: {
    create: () => ({}),
  },
  ModelRegistry: {
    create: () => ({
      getAvailable: () => [],
      find: () => undefined,
    }),
  },
  SessionManager: {
    create: () => ({
      getSessionId: () => "real-session-id",
      getSessionFile: () => "/tmp/real-session.jsonl",
    }),
    list: mock(async () => []),
    listAll: mock(async () => []),
  },
  createAgentSession: mock(async (options: any) => {
    capturedCreateAgentSessionOptions = options;
    return {
      session: {
        sessionId: options.sessionManager.getSessionId(),
        sessionFile: options.sessionManager.getSessionFile(),
        model: undefined,
        thinkingLevel: "medium",
        getAvailableThinkingLevels: () => ["off", "low", "medium", "high"],
        setModel: mock(async () => {}),
        setThinkingLevel: mock(() => {}),
        subscribe: () => () => {},
        prompt: mock(async () => {}),
        abort: mock(async () => {}),
        dispose: mock(() => {}),
        bindExtensions: mock(async () => {}),
        resourceLoader: {
          getAgentsFiles: () => ({ agentsFiles: [] }),
          getSkills: () => ({ skills: [], diagnostics: [] }),
          getPrompts: () => ({ prompts: [], diagnostics: [] }),
          getThemes: () => ({ themes: [], diagnostics: [] }),
          getExtensions: () => ({ extensions: [], errors: [] }),
          getSystemPrompt: () => undefined,
          getAppendSystemPrompt: () => [],
          extendResources: mock(async () => {}),
          reload: mock(async () => {}),
        },
        sessionManager: options.sessionManager,
      },
    };
  }),
  defineTool: (tool: any) => tool,
}));

const { PiAcpAgent } = await import("../src/pi-acp-agent");

function createMockConnection(): AgentSideConnection & {
  sessionUpdate: ReturnType<typeof mock>;
  createTerminal: ReturnType<typeof mock>;
} {
  const sessionUpdate = mock(async () => {});
  const createTerminal = mock(async () => ({
    currentOutput: mock(async () => ({
      output: "",
      exitStatus: { exitCode: 0 },
      truncated: false,
    })),
    kill: mock(async () => {}),
    release: mock(async () => {}),
  }));
  return {
    closed: Promise.resolve(),
    extMethod: mock(async () => ({})),
    extNotification: mock(async () => {}),
    requestPermission: mock(async () => ({ action: "allow" as const })),
    sessionUpdate,
    createTerminal,
    signal: new AbortController().signal,
  } as unknown as AgentSideConnection & {
    sessionUpdate: ReturnType<typeof mock>;
    createTerminal: ReturnType<typeof mock>;
  };
}

describe("PiAcpAgent newSession without sessionFactory", () => {
  it("creates proxy tools with the real sessionId", async () => {
    const conn = createMockConnection();
    const agent = new PiAcpAgent(conn, {
      authStorage: {} as any,
      modelRegistry: {
        getAvailable: () => [],
        find: () => undefined,
      } as any,
    });

    await agent.initialize({
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
      clientInfo: { name: "test", version: "1.0" },
      protocolVersion: PROTOCOL_VERSION,
    });

    const result = await agent.newSession({ cwd: "/test", mcpServers: [] });
    expect(result.sessionId).toBe("real-session-id");

    expect(capturedCreateAgentSessionOptions).toBeDefined();
    expect(capturedCreateAgentSessionOptions.customTools).toBeDefined();
    expect(capturedCreateAgentSessionOptions.customTools.length).toBeGreaterThan(0);

    const bashTool = capturedCreateAgentSessionOptions.customTools.find(
      (t: any) => t.name === "bash",
    );
    expect(bashTool).toBeDefined();

    await bashTool.execute("tc-1", { command: "echo hello" }, undefined, undefined, {} as any);

    expect(conn.createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "real-session-id",
        command: "echo hello",
      }),
    );
  });
});
