import { describe, expect, it } from "bun:test";
import { buildStartupMessage } from "../src/startup-message";
import { version as AGENT_VERSION } from "../package.json";
import { version as PI_VERSION } from "../node_modules/@earendil-works/pi-coding-agent/package.json";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

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
    expect(result).toContain("AZPi");
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

  it("deduplicates extensions from the same package source", () => {
    const session = createMockSession({
      getExtensions: () => ({
        extensions: [
          {
            path: "/ext/guardrails/path-access/index.ts",
            resolvedPath: "/ext/guardrails/path-access/index.ts",
            sourceInfo: {
              path: "/ext/guardrails/path-access/index.ts",
              source: "npm:@aliou/pi-guardrails",
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
            path: "/ext/guardrails/guardrails/index.ts",
            resolvedPath: "/ext/guardrails/guardrails/index.ts",
            sourceInfo: {
              path: "/ext/guardrails/guardrails/index.ts",
              source: "npm:@aliou/pi-guardrails",
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
            path: "/ext/guardrails/permission-gate/index.ts",
            resolvedPath: "/ext/guardrails/permission-gate/index.ts",
            sourceInfo: {
              path: "/ext/guardrails/permission-gate/index.ts",
              source: "npm:@aliou/pi-guardrails",
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
    // Should only appear once, not three times
    const matches = result.match(/npm:@aliou\/pi-guardrails/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
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

  it("shows folder name for auto-discovered extensions in subdirectories", () => {
    const session = createMockSession({
      getExtensions: () => ({
        extensions: [
          {
            path: "/home/user/.pi/agent/extensions/my-extension/index.ts",
            resolvedPath: "/home/user/.pi/agent/extensions/my-extension/index.ts",
            sourceInfo: {
              path: "/home/user/.pi/agent/extensions/my-extension/index.ts",
              source: "auto",
              scope: "user",
              origin: "top-level",
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
    expect(result).toContain("my-extension");
    expect(result).not.toContain("auto");
  });

  it("shows filename for auto-discovered single-file extensions", () => {
    const session = createMockSession({
      getExtensions: () => ({
        extensions: [
          {
            path: "/home/user/.pi/agent/extensions/condensed-milk.ts",
            resolvedPath: "/home/user/.pi/agent/extensions/condensed-milk.ts",
            sourceInfo: {
              path: "/home/user/.pi/agent/extensions/condensed-milk.ts",
              source: "auto",
              scope: "user",
              origin: "top-level",
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
    expect(result).toContain("condensed-milk");
    expect(result).not.toContain("auto");
  });

  it("shows folder name for project-local auto-discovered extensions", () => {
    const session = createMockSession({
      getExtensions: () => ({
        extensions: [
          {
            path: "/project/.pi/extensions/custom-tool/index.ts",
            resolvedPath: "/project/.pi/extensions/custom-tool/index.ts",
            sourceInfo: {
              path: "/project/.pi/extensions/custom-tool/index.ts",
              source: "auto",
              scope: "project",
              origin: "top-level",
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
    expect(result).toContain("custom-tool");
    expect(result).not.toContain("auto");
  });

  it("deduplicates auto-discovered extensions with same folder name", () => {
    const session = createMockSession({
      getExtensions: () => ({
        extensions: [
          {
            path: "/home/user/.pi/agent/extensions/my-ext/tool.ts",
            resolvedPath: "/home/user/.pi/agent/extensions/my-ext/tool.ts",
            sourceInfo: {
              path: "/home/user/.pi/agent/extensions/my-ext/tool.ts",
              source: "auto",
              scope: "user",
              origin: "top-level",
            },
            handlers: new Map(),
            tools: new Map(),
            messageRenderers: new Map(),
            commands: new Map(),
            flags: new Map(),
            shortcuts: new Map(),
          },
          {
            path: "/home/user/.pi/agent/extensions/my-ext/helper.ts",
            resolvedPath: "/home/user/.pi/agent/extensions/my-ext/helper.ts",
            sourceInfo: {
              path: "/home/user/.pi/agent/extensions/my-ext/helper.ts",
              source: "auto",
              scope: "user",
              origin: "top-level",
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
    // Should only appear once
    const matches = result.match(/my-ext/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });
});
