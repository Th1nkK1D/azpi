import { describe, expect, it, mock, beforeEach } from "bun:test";
import { SessionResolver, replaySessionHistory, deriveSessionName } from "../src/session";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import type { AgentSideConnection } from "@agentclientprotocol/sdk";

mock.module("@mariozechner/pi-coding-agent", () => ({
  SessionManager: {
    list: mock(async () => []),
    listAll: mock(async () => []),
  },
}));

describe("SessionResolver", () => {
  let resolver: SessionResolver;

  beforeEach(() => {
    resolver = new SessionResolver();
  });

  describe("registerSession / unregisterSession", () => {
    it("registers a session and returns it from cache", async () => {
      resolver.registerSession("session-1", "/path/to/session-1.jsonl");
      const result = await resolver.resolveSessionPath("/test", "session-1");
      expect(result).toBe("/path/to/session-1.jsonl");
    });

    it("unregisters a session so it is no longer in cache", async () => {
      resolver.registerSession("session-1", "/path/to/session-1.jsonl");
      resolver.unregisterSession("session-1");
      const result = await resolver.resolveSessionPath("/test", "session-1");
      expect(result).toBeUndefined();
    });
  });

  describe("resolveSessionPath", () => {
    it("checks cache first before calling SessionManager", async () => {
      resolver.registerSession("cached", "/cached/path.jsonl");
      const listMock = mock(async () => []);
      (SessionManager.list as any) = listMock;
      (SessionManager.listAll as any) = mock(async () => []);

      const result = await resolver.resolveSessionPath("/test", "cached");
      expect(result).toBe("/cached/path.jsonl");
      expect(listMock).not.toHaveBeenCalled();
    });

    it("falls back to SessionManager.list when not in cache", async () => {
      const listMock = mock(async () => [
        {
          id: "session-a",
          path: "/path/a.jsonl",
          cwd: "/test",
          modified: new Date(),
          messageCount: 5,
        },
      ]);
      (SessionManager.list as any) = listMock;
      (SessionManager.listAll as any) = mock(async () => []);

      const result = await resolver.resolveSessionPath("/test", "session-a");
      expect(result).toBe("/path/a.jsonl");
      expect(listMock).toHaveBeenCalledWith("/test");
    });

    it("falls back to SessionManager.listAll when not found in cwd", async () => {
      const listMock = mock(async () => []);
      const listAllMock = mock(async () => [
        {
          id: "session-b",
          path: "/path/b.jsonl",
          cwd: "/other",
          modified: new Date(),
          messageCount: 3,
        },
      ]);
      (SessionManager.list as any) = listMock;
      (SessionManager.listAll as any) = listAllMock;

      const result = await resolver.resolveSessionPath("/test", "session-b");
      expect(result).toBe("/path/b.jsonl");
      expect(listAllMock).toHaveBeenCalled();
    });

    it("returns undefined when session is not found", async () => {
      (SessionManager.list as any) = mock(async () => []);
      (SessionManager.listAll as any) = mock(async () => []);

      const result = await resolver.resolveSessionPath("/test", "nonexistent");
      expect(result).toBeUndefined();
    });

    it("caches the result after finding via SessionManager", async () => {
      const listMock = mock(async () => [
        {
          id: "found",
          path: "/found/path.jsonl",
          cwd: "/test",
          modified: new Date(),
          messageCount: 2,
        },
      ]);
      (SessionManager.list as any) = listMock;
      (SessionManager.listAll as any) = mock(async () => []);

      const result1 = await resolver.resolveSessionPath("/test", "found");
      expect(result1).toBe("/found/path.jsonl");

      const result2 = await resolver.resolveSessionPath("/test", "found");
      expect(result2).toBe("/found/path.jsonl");
      expect(listMock.mock.calls.length).toBe(1);
    });
  });

  describe("warmCache", () => {
    it("populates cache from SessionManager.list", async () => {
      const listMock = mock(async () => [
        { id: "s1", path: "/path/s1.jsonl", cwd: "/test", modified: new Date(), messageCount: 1 },
        { id: "s2", path: "/path/s2.jsonl", cwd: "/test", modified: new Date(), messageCount: 2 },
      ]);
      (SessionManager.list as any) = listMock;

      await resolver.warmCache("/test");

      const r1 = await resolver.resolveSessionPath("/test", "s1");
      const r2 = await resolver.resolveSessionPath("/test", "s2");
      expect(r1).toBe("/path/s1.jsonl");
      expect(r2).toBe("/path/s2.jsonl");
    });
  });
});

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

function createMockSessionWithEntries(entries: any[]): AgentSession {
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

  const mockSessionManager = { getEntries: () => entries };

  return {
    sessionId: "test-session",
    sessionFile: "/tmp/test.jsonl",
    model: undefined,
    thinkingLevel: "medium",
    getAvailableThinkingLevels: () => ["off", "low", "medium", "high"],
    setModel: mock(async () => {}),
    setThinkingLevel: mock(() => {}),
    subscribe: () => () => {},
    prompt: mock(async () => {}),
    abort: mock(async () => {}),
    dispose: mock(() => {}),
    resourceLoader: mockResourceLoader,
    sessionManager: mockSessionManager,
  } as unknown as AgentSession;
}

describe("replaySessionHistory", () => {
  it("replays user messages as user_message_chunk", async () => {
    const conn = createMockConnection();
    const session = createMockSessionWithEntries([
      { type: "message", message: { role: "user", content: "Hello, world!" } },
    ]);

    await replaySessionHistory(session, "test-session", conn);

    expect(conn.sessionUpdate).toHaveBeenCalledTimes(1);
    expect(conn.sessionUpdate).toHaveBeenCalledWith({
      sessionId: "test-session",
      update: {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "Hello, world!" },
      },
    });
  });

  it("replays assistant messages as agent_message_chunk", async () => {
    const conn = createMockConnection();
    const session = createMockSessionWithEntries([
      { type: "message", message: { role: "assistant", content: "Hi there!" } },
    ]);

    await replaySessionHistory(session, "test-session", conn);

    expect(conn.sessionUpdate).toHaveBeenCalledTimes(1);
    expect(conn.sessionUpdate).toHaveBeenCalledWith({
      sessionId: "test-session",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Hi there!" },
      },
    });
  });

  it("skips tool result messages", async () => {
    const conn = createMockConnection();
    const session = createMockSessionWithEntries([
      { type: "message", message: { role: "tool", content: "tool result" } },
    ]);

    await replaySessionHistory(session, "test-session", conn);
    expect(conn.sessionUpdate).not.toHaveBeenCalled();
  });

  it("skips non-message entries", async () => {
    const conn = createMockConnection();
    const session = createMockSessionWithEntries([
      { type: "compaction", data: "some data" },
      { type: "custom", customType: "something" },
    ]);

    await replaySessionHistory(session, "test-session", conn);
    expect(conn.sessionUpdate).not.toHaveBeenCalled();
  });

  it("replays multiple messages in order", async () => {
    const conn = createMockConnection();
    const session = createMockSessionWithEntries([
      { type: "message", message: { role: "user", content: "Question 1" } },
      { type: "message", message: { role: "assistant", content: "Answer 1" } },
      { type: "message", message: { role: "user", content: "Question 2" } },
    ]);

    await replaySessionHistory(session, "test-session", conn);

    expect(conn.sessionUpdate).toHaveBeenCalledTimes(3);
    const calls = conn.sessionUpdate.mock.calls as any[];
    expect(calls[0][0].update.sessionUpdate).toBe("user_message_chunk");
    expect(calls[0][0].update.content.text).toBe("Question 1");
    expect(calls[1][0].update.sessionUpdate).toBe("agent_message_chunk");
    expect(calls[1][0].update.content.text).toBe("Answer 1");
    expect(calls[2][0].update.sessionUpdate).toBe("user_message_chunk");
    expect(calls[2][0].update.content.text).toBe("Question 2");
  });

  it("handles multi-part content with text parts", async () => {
    const conn = createMockConnection();
    const session = createMockSessionWithEntries([
      {
        type: "message",
        message: {
          role: "user",
          content: [
            { type: "text", text: "Part 1" },
            { type: "image", url: "..." },
            { type: "text", text: "Part 2" },
          ],
        },
      },
    ]);

    await replaySessionHistory(session, "test-session", conn);

    expect(conn.sessionUpdate).toHaveBeenCalledTimes(1);
    expect((conn.sessionUpdate.mock.calls as any[])[0][0].update.content.text).toBe("Part 1Part 2");
  });

  it("skips messages with no text content", async () => {
    const conn = createMockConnection();
    const session = createMockSessionWithEntries([
      { type: "message", message: { role: "user", content: "" } },
      { type: "message", message: { role: "assistant", content: [] } },
    ]);

    await replaySessionHistory(session, "test-session", conn);
    expect(conn.sessionUpdate).not.toHaveBeenCalled();
  });

  it("handles empty entry list", async () => {
    const conn = createMockConnection();
    const session = createMockSessionWithEntries([]);

    await replaySessionHistory(session, "test-session", conn);
    expect(conn.sessionUpdate).not.toHaveBeenCalled();
  });
});

describe("deriveSessionName", () => {
  it("returns the trimmed first line of text", () => {
    expect(deriveSessionName("Hello, how are you?")).toBe("Hello, how are you?");
  });

  it("truncates text longer than 50 characters", () => {
    const longText = "a".repeat(100);
    expect(deriveSessionName(longText)).toBe("a".repeat(50) + "...");
  });

  it("uses only the first line for session name", () => {
    expect(deriveSessionName("First line\nSecond line")).toBe("First line");
  });

  it("returns undefined for slash commands", () => {
    expect(deriveSessionName("/unknown arg")).toBeUndefined();
  });

  it("returns undefined for empty text", () => {
    expect(deriveSessionName("")).toBeUndefined();
  });

  it("returns undefined for whitespace-only text", () => {
    expect(deriveSessionName("   \n  ")).toBeUndefined();
  });

  it("trims leading and trailing whitespace from first line", () => {
    expect(deriveSessionName("  Hello world  ")).toBe("Hello world");
  });

  it("returns undefined when first line after trimming starts with /", () => {
    expect(deriveSessionName("/help me")).toBeUndefined();
  });

  it("returns text exactly at 50 char limit without ellipsis", () => {
    const exact = "a".repeat(50);
    expect(deriveSessionName(exact)).toBe(exact);
  });

  it("returns text at 51 chars with ellipsis", () => {
    expect(deriveSessionName("a".repeat(51))).toBe("a".repeat(50) + "...");
  });

  it("strips markdown link to label only", () => {
    expect(deriveSessionName("[Duck Duck Go](https://duckduckgo.com)")).toBe("Duck Duck Go");
  });

  it("strips markdown link in mixed text", () => {
    expect(deriveSessionName("Check out [Duck Duck Go](https://duckduckgo.com) it's great")).toBe(
      "Check out Duck Duck Go it's great",
    );
  });

  it("strips multiple markdown links", () => {
    expect(deriveSessionName("[A](url1) and [B](url2) here")).toBe("A and B here");
  });

  it("falls back to URL when markdown link has empty label", () => {
    expect(deriveSessionName("[](https://example.com)")).toBe("https://example.com");
  });

  it("truncates label after stripping markdown link", () => {
    const longLabel = "a".repeat(60);
    const input = `[${longLabel}](https://example.com)`;
    expect(deriveSessionName(input)).toBe("a".repeat(50) + "...");
  });

  it("handles plain text with no markdown links unchanged", () => {
    expect(deriveSessionName("Just plain text")).toBe("Just plain text");
  });

  it("strips link even when text starts with non-link content before trimming", () => {
    expect(deriveSessionName("  [Label](url)  ")).toBe("Label");
  });
});
