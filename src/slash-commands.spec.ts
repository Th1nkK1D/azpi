import { describe, expect, it, mock } from "bun:test";
import {
  parseSlashCommand,
  builtinCommands,
  findBuiltinCommand,
  discoverCommands,
} from "./slash-commands";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import type { Model } from "@mariozechner/pi-ai";

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

function defaultResourceData() {
  return {
    extensions: { extensions: [], errors: [] },
    skills: { skills: [], diagnostics: [] },
    prompts: { prompts: [], diagnostics: [] },
    themes: { themes: [], diagnostics: [] },
    agentsFiles: { agentsFiles: [] },
  };
}

function createMockResourceLoader(
  overrides?: Partial<ReturnType<typeof defaultResourceData>>,
): AgentSession["resourceLoader"] {
  const base = defaultResourceData();
  const merged = { ...base, ...overrides };
  return {
    getExtensions: () => merged.extensions,
    getSkills: () => merged.skills,
    getPrompts: () => merged.prompts,
    getThemes: () => merged.themes,
    getAgentsFiles: () => merged.agentsFiles,
    getSystemPrompt: () => undefined,
    getAppendSystemPrompt: () => [],
    extendResources: mock(async () => {}),
    reload: mock(async () => {}),
  } as unknown as AgentSession["resourceLoader"];
}

function createMockSession(overrides?: Partial<AgentSession>): AgentSession {
  const subscribers: Array<(event: any) => void> = [];
  const mockResourceLoader = createMockResourceLoader();
  const mockExtensionRunner = {
    getRegisteredCommands: () => [],
  };

  return {
    model: createMockModel(),
    sessionName: undefined,
    thinkingLevel: "medium",
    getAvailableThinkingLevels: () => ["off", "low", "medium", "high"],
    setModel: mock(async () => {}),
    setThinkingLevel: mock(() => {}),
    setSessionName: mock(() => {}),
    getSessionStats: mock(() => ({
      sessionFile: undefined,
      sessionId: "test-id",
      userMessages: 0,
      assistantMessages: 0,
      toolCalls: 0,
      toolResults: 0,
      totalMessages: 0,
      tokens: { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      cost: 0,
    })),
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
    extensionRunner: mockExtensionRunner,
    _subscribers: subscribers,
    ...overrides,
  } as unknown as AgentSession;
}

describe("parseSlashCommand", () => {
  it("returns null for non-slash text", () => {
    expect(parseSlashCommand("hello world")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseSlashCommand("")).toBeNull();
  });

  it("returns null for just a slash", () => {
    expect(parseSlashCommand("/")).toBeNull();
  });

  it("parses command with no args", () => {
    const result = parseSlashCommand("/session");
    expect(result).toEqual({ name: "session", args: "" });
  });

  it("parses command with args", () => {
    const result = parseSlashCommand("/name my-session");
    expect(result).toEqual({ name: "name", args: "my-session" });
  });

  it("parses command with quoted args", () => {
    const result = parseSlashCommand('/export "my file.html"');
    expect(result).toEqual({ name: "export", args: '"my file.html"' });
  });

  it("trims leading whitespace after slash", () => {
    const result = parseSlashCommand("/  compact   some args");
    expect(result).toEqual({ name: "compact", args: "some args" });
  });

  it("trims the input", () => {
    const result = parseSlashCommand("  /name test  ");
    expect(result).toEqual({ name: "name", args: "test" });
  });

  it("handles command with multiple spaced args", () => {
    const result = parseSlashCommand("/compact please summarize");
    expect(result).toEqual({ name: "compact", args: "please summarize" });
  });
});

describe("builtinCommands", () => {
  it("contains exactly 5 commands", () => {
    expect(builtinCommands).toHaveLength(5);
  });

  it("has name, session, compact, export, reload", () => {
    const names = builtinCommands.map((c) => c.name);
    expect(names).toContain("name");
    expect(names).toContain("session");
    expect(names).toContain("compact");
    expect(names).toContain("export");
    expect(names).toContain("reload");
  });

  it("each command has a description", () => {
    for (const cmd of builtinCommands) {
      expect(cmd.description.length).toBeGreaterThan(0);
    }
  });
});

describe("findBuiltinCommand", () => {
  it("finds existing command", () => {
    const cmd = findBuiltinCommand("name");
    expect(cmd).toBeDefined();
    expect(cmd!.name).toBe("name");
  });

  it("returns undefined for unknown command", () => {
    expect(findBuiltinCommand("nonexistent")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(findBuiltinCommand("")).toBeUndefined();
  });
});

describe("executeName", () => {
  it("returns current name when no args provided", async () => {
    const session = createMockSession({ sessionName: "my-project" });
    const cmd = findBuiltinCommand("name")!;
    const result = await cmd.execute(session, "");
    expect(result.text).toBe('Session name is: "my-project"');
  });

  it("shows usage hint when no name and no current name", async () => {
    const session = createMockSession({ sessionName: undefined });
    const cmd = findBuiltinCommand("name")!;
    const result = await cmd.execute(session, "");
    expect(result.text).toContain("Session has no name");
  });

  it("sets new name when args provided", async () => {
    const session = createMockSession();
    const cmd = findBuiltinCommand("name")!;
    const result = await cmd.execute(session, "new-name");
    expect(result.text).toBe('Session name set to: "new-name"');
    expect(session.setSessionName).toHaveBeenCalledWith("new-name");
  });
});

describe("executeSession", () => {
  it("returns session stats", async () => {
    const session = createMockSession({
      sessionName: "test-session",
      getSessionStats: () => ({
        sessionFile: "/tmp/test.jsonl",
        sessionId: "abc-123",
        userMessages: 5,
        assistantMessages: 4,
        toolCalls: 12,
        toolResults: 12,
        totalMessages: 9,
        tokens: { total: 10000, input: 6000, output: 4000, cacheRead: 0, cacheWrite: 0 },
        cost: 0.0125,
        contextUsage: { tokens: 8000, contextWindow: 128000, percent: 6.25 },
      }),
    });
    const cmd = findBuiltinCommand("session")!;
    const result = await cmd.execute(session, "");
    expect(result.text).toContain("abc-123");
    expect(result.text).toContain("test-session");
    expect(result.text).toContain("5 user");
    expect(result.text).toContain("12 tool calls");
    expect(result.text).toContain("$0.0125");
  });

  it("handles missing contextUsage", async () => {
    const session = createMockSession({
      getSessionStats: () => ({
        sessionFile: "/tmp/test.jsonl",
        sessionId: "abc-123",
        userMessages: 1,
        assistantMessages: 0,
        toolCalls: 0,
        toolResults: 0,
        totalMessages: 1,
        tokens: { total: 100, input: 50, output: 50, cacheRead: 0, cacheWrite: 0 },
        cost: 0.0,
        contextUsage: undefined,
      }),
    });
    const cmd = findBuiltinCommand("session")!;
    const result = await cmd.execute(session, "");
    expect(result.text).toContain("abc-123");
    expect(result.text).not.toContain("Context:");
  });
});

describe("executeCompact", () => {
  it("aborts and compacts with custom instructions", async () => {
    const session = createMockSession({
      compact: mock(async () => ({
        summary: "Compacted.",
        firstKeptEntryId: "entry-1",
        tokensBefore: 50000,
      })),
    });
    const cmd = findBuiltinCommand("compact")!;
    const result = await cmd.execute(session, "please summarize");
    expect(result.text).toContain("Compaction completed.");
    expect(session.abort).toHaveBeenCalled();
    expect(session.compact).toHaveBeenCalledWith("please summarize");
  });

  it("compacts without custom instructions", async () => {
    const session = createMockSession({
      compact: mock(async () => ({
        summary: "Compacted.",
        firstKeptEntryId: "entry-1",
        tokensBefore: 50000,
      })),
    });
    const cmd = findBuiltinCommand("compact")!;
    await cmd.execute(session, "");
    expect(session.compact).toHaveBeenCalledWith(undefined);
  });

  it("ignores abort errors", async () => {
    const session = createMockSession({
      abort: mock(async () => {
        throw new Error("already aborted");
      }),
      compact: mock(async () => ({
        summary: "Compacted.",
        firstKeptEntryId: "entry-1",
        tokensBefore: 50000,
      })),
    });
    const cmd = findBuiltinCommand("compact")!;
    await expect(cmd.execute(session, "")).resolves.toBeDefined();
  });
});

describe("executeExport", () => {
  it("exports to default path", async () => {
    const session = createMockSession({
      exportToHtml: mock(async () => "/tmp/session.html"),
    });
    const cmd = findBuiltinCommand("export")!;
    const result = await cmd.execute(session, "");
    expect(result.text).toBe("Session exported to: /tmp/session.html");
    expect(session.exportToHtml).toHaveBeenCalledWith(undefined);
  });

  it("exports to specified path", async () => {
    const session = createMockSession({
      exportToHtml: mock(async () => "/custom/path.html"),
    });
    const cmd = findBuiltinCommand("export")!;
    const result = await cmd.execute(session, "/custom/path.html");
    expect(result.text).toBe("Session exported to: /custom/path.html");
    expect(session.exportToHtml).toHaveBeenCalledWith("/custom/path.html");
  });
});

describe("executeReload", () => {
  it("calls session.reload", async () => {
    const session = createMockSession({
      reload: mock(async () => {}),
    });
    const cmd = findBuiltinCommand("reload")!;
    const result = await cmd.execute(session, "");
    expect(result.text).toContain("reloaded");
    expect(session.reload).toHaveBeenCalled();
  });
});

describe("discoverCommands", () => {
  it("returns built-in commands", () => {
    const session = createMockSession();
    const commands = discoverCommands(session);
    const builtinNames = commands.filter((c) => c.source === "builtin").map((c) => c.name);
    expect(builtinNames).toContain("name");
    expect(builtinNames).toContain("session");
    expect(builtinNames).toContain("compact");
    expect(builtinNames).toContain("export");
    expect(builtinNames).toContain("reload");
  });

  it("discovers skills from resource loader", () => {
    const rl = createMockResourceLoader();
    (rl.getSkills as any) = () => ({
      skills: [
        { name: "another-skill", description: "", filePath: "/skills/another.md" },
        { name: "test-skill", description: "A test skill", filePath: "/skills/test.md" },
      ],
      diagnostics: [],
    });
    const session = createMockSession({ resourceLoader: rl });
    const commands = discoverCommands(session);
    const skillCmds = commands.filter((c) => c.source === "skill");
    expect(skillCmds.length).toBe(2);
    expect(skillCmds[1]!.name).toBe("skill:test-skill");
    expect(skillCmds[0]!.description).toBe("Skill: another-skill");
  });

  it("discovers prompt templates with colon prefix", () => {
    const rl = createMockResourceLoader();
    (rl.getPrompts as any) = () => ({
      prompts: [
        { name: "review", description: "Code review template" },
        { name: "explain", description: "" },
      ],
      diagnostics: [],
    });
    const session = createMockSession({ resourceLoader: rl });
    const commands = discoverCommands(session);
    const promptCmds = commands.filter((c) => c.source === "prompt");
    expect(promptCmds.length).toBe(2);
    expect(promptCmds[0]!.name).toBe(":explain");
    expect(promptCmds[1]!.name).toBe(":review");
  });

  it("handles resource loader errors gracefully", () => {
    const errorLoader = {
      getAgentsFiles: () => {
        throw new Error("boom");
      },
      getSkills: () => {
        throw new Error("boom");
      },
      getPrompts: () => {
        throw new Error("boom");
      },
      getThemes: () => {
        throw new Error("boom");
      },
      getExtensions: () => {
        throw new Error("boom");
      },
      getSystemPrompt: () => {
        throw new Error("boom");
      },
      getAppendSystemPrompt: () => {
        throw new Error("boom");
      },
      extendResources: mock(async () => {
        throw new Error("boom");
      }),
      reload: mock(async () => {
        throw new Error("boom");
      }),
    };
    const session = createMockSession({ resourceLoader: errorLoader });
    expect(() => discoverCommands(session)).not.toThrow();
  });
});
