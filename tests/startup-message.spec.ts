import { describe, expect, it } from "bun:test";
import { buildStartupMessage } from "../src/startup-message";
import { name as AGENT_NAME, version as AGENT_VERSION } from "../package.json";
import { version as PI_VERSION } from "../node_modules/@mariozechner/pi-coding-agent/package.json";
import type { AgentSession } from "@mariozechner/pi-coding-agent";

type MockResourceLoader = AgentSession["resourceLoader"];

function createMockSession(loader: Partial<MockResourceLoader>): AgentSession {
  return {
    resourceLoader: {
      getAgentsFiles: () => ({ agentsFiles: [] }),
      getExtensions: () => ({ extensions: [], errors: [] }),
      getSkills: () => ({ skills: [], diagnostics: [] }),
      ...loader,
    } as MockResourceLoader,
  } as AgentSession;
}

describe("buildStartupMessage", () => {
  it("includes agent name and version", () => {
    const session = createMockSession({});
    const result = buildStartupMessage(session);
    expect(result).toContain(AGENT_NAME);
    expect(result).toContain(AGENT_VERSION);
  });

  it("includes pi coding agent version", () => {
    const session = createMockSession({});
    const result = buildStartupMessage(session);
    expect(result).toContain(PI_VERSION);
  });

  it("lists context file paths", () => {
    const session = createMockSession({
      getAgentsFiles: () => ({
        agentsFiles: [
          { path: "/home/user/.pi/agent/AGENTS.md", content: "foo" },
          { path: "/home/user/project/AGENTS.md", content: "bar" },
        ],
      }),
    });
    const result = buildStartupMessage(session);
    expect(result).toContain("/home/user/.pi/agent/AGENTS.md");
    expect(result).toContain("/home/user/project/AGENTS.md");
  });

  it("shows none when no context files", () => {
    const session = createMockSession({
      getAgentsFiles: () => ({ agentsFiles: [] }),
    });
    const result = buildStartupMessage(session);
    expect(result.toLowerCase()).toContain("none");
  });

  it("lists extension sources", () => {
    const session = createMockSession({
      getExtensions: () => ({
        extensions: [
          {
            path: "/ext/condensed-milk",
            resolvedPath: "/ext/condensed-milk",
            sourceInfo: {
              path: "/ext/condensed-milk",
              source: "npm:@tomooshi/condensed-milk-pi",
              scope: "user",
              origin: "package",
            },
            handlers: new Map(),
            tools: new Map(),
            messageRenderers: new Map(),
            commands: new Map(),
            flags: new Map(),
            shortcuts: new Map(),
          },
          {
            path: "/ext/caveman-milk",
            resolvedPath: "/ext/caveman-milk",
            sourceInfo: {
              path: "/ext/caveman-milk",
              source: "npm:@tomooshi/caveman-milk-pi",
              scope: "user",
              origin: "package",
            },
            handlers: new Map(),
            tools: new Map(),
            messageRenderers: new Map(),
            commands: new Map(),
            flags: new Map(),
            shortcuts: new Map(),
          },
        ],
        errors: [],
        runtime: {} as any,
      }),
    });
    const result = buildStartupMessage(session);
    expect(result).toContain("npm:@tomooshi/condensed-milk-pi");
    expect(result).toContain("npm:@tomooshi/caveman-milk-pi");
  });

  it("shows none when no extensions", () => {
    const session = createMockSession({
      getExtensions: () => ({ extensions: [], errors: [], runtime: {} as any }),
    });
    const result = buildStartupMessage(session);
    expect(result.toLowerCase()).toContain("none");
  });

  it("lists skill names", () => {
    const session = createMockSession({
      getSkills: () => ({
        skills: [
          {
            name: "code-review-excellence",
            description: "Code review skill",
            filePath: "/skills/code-review.md",
            baseDir: "/skills",
            sourceInfo: { path: "/skills", source: "user", scope: "user", origin: "top-level" },
            disableModelInvocation: false,
          },
          {
            name: "gh-cli",
            description: "GitHub CLI skill",
            filePath: "/skills/gh-cli.md",
            baseDir: "/skills",
            sourceInfo: { path: "/skills", source: "user", scope: "user", origin: "top-level" },
            disableModelInvocation: false,
          },
        ],
        diagnostics: [],
      }),
    });
    const result = buildStartupMessage(session);
    expect(result).toContain("code-review-excellence");
    expect(result).toContain("gh-cli");
  });

  it("shows none when no skills", () => {
    const session = createMockSession({
      getSkills: () => ({ skills: [], diagnostics: [] }),
    });
    const result = buildStartupMessage(session);
    expect(result.toLowerCase()).toContain("none");
  });

  it("handles mixed empty and populated sections", () => {
    const session = createMockSession({
      getAgentsFiles: () => ({
        agentsFiles: [{ path: "/ctx/AGENTS.md", content: "ctx" }],
      }),
      getExtensions: () => ({ extensions: [], errors: [], runtime: {} as any }),
      getSkills: () => ({
        skills: [
          {
            name: "grill-me",
            description: "Grill me skill",
            filePath: "/skills/grill-me.md",
            baseDir: "/skills",
            sourceInfo: { path: "/skills", source: "user", scope: "user", origin: "top-level" },
            disableModelInvocation: false,
          },
        ],
        diagnostics: [],
      }),
    });
    const result = buildStartupMessage(session);
    expect(result).toContain("/ctx/AGENTS.md");
    expect(result).toContain("grill-me");
    expect(result.toLowerCase().match(/none/g)!.length).toBeGreaterThanOrEqual(1);
  });
});
