import { describe, expect, it, mock } from "bun:test";
import type { AgentSideConnection, TerminalHandle } from "@agentclientprotocol/sdk";
import { createAcpProxyTools } from "../src/client-tool-proxy";

function mockConnection(overrides?: Partial<AgentSideConnection>): AgentSideConnection {
  return {
    readTextFile: mock().mockResolvedValue({ content: "" }),
    writeTextFile: mock().mockResolvedValue({}),
    createTerminal: mock(),
    sessionUpdate: mock().mockResolvedValue(undefined),
    requestPermission: mock(),
    extMethod: mock(),
    extNotification: mock(),
    get signal(): AbortSignal {
      return new AbortController().signal;
    },
    get closed(): Promise<void> {
      return Promise.resolve();
    },
    ...overrides,
  } as unknown as AgentSideConnection;
}

function mockTerminalHandle(overrides?: Partial<TerminalHandle>): TerminalHandle {
  return {
    id: "term-1",
    currentOutput: mock().mockResolvedValue({
      output: "",
      truncated: false,
      exitStatus: undefined,
    }),
    waitForExit: mock().mockResolvedValue({ exitCode: 0, signal: null }),
    kill: mock().mockResolvedValue({}),
    release: mock().mockResolvedValue({}),
    [Symbol.asyncDispose]: mock().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as TerminalHandle;
}

describe("createAcpProxyTools", () => {
  const defaultCwd = "/home/user/project";
  const sessionId = "test-session-id";

  it("returns empty array when capabilities is undefined", () => {
    const tools = createAcpProxyTools({
      connection: mockConnection(),
      sessionId,
      capabilities: undefined,
      cwd: defaultCwd,
    });
    expect(tools).toHaveLength(0);
  });

  it("returns empty array when no capabilities are advertised", () => {
    const tools = createAcpProxyTools({
      connection: mockConnection(),
      sessionId,
      capabilities: {},
      cwd: defaultCwd,
    });
    expect(tools).toHaveLength(0);
  });

  it("creates read proxy when client advertises fs.readTextFile", () => {
    const tools = createAcpProxyTools({
      connection: mockConnection(),
      sessionId,
      capabilities: { fs: { readTextFile: true } },
      cwd: defaultCwd,
    });
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("read");
    expect(toolNames).not.toContain("write");
    expect(toolNames).not.toContain("edit");
    expect(toolNames).not.toContain("bash");
  });

  it("creates write proxy when client advertises fs.writeTextFile", () => {
    const tools = createAcpProxyTools({
      connection: mockConnection(),
      sessionId,
      capabilities: { fs: { writeTextFile: true } },
      cwd: defaultCwd,
    });
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("write");
    expect(toolNames).not.toContain("read");
    expect(toolNames).not.toContain("edit");
    expect(toolNames).not.toContain("bash");
  });

  it("creates edit proxy only when both read + write are advertised", () => {
    const tools = createAcpProxyTools({
      connection: mockConnection(),
      sessionId,
      capabilities: { fs: { readTextFile: true, writeTextFile: true } },
      cwd: defaultCwd,
    });
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("read");
    expect(toolNames).toContain("write");
    expect(toolNames).toContain("edit");
    expect(toolNames).not.toContain("bash");
  });

  it("creates bash proxy when client advertises terminal", () => {
    const tools = createAcpProxyTools({
      connection: mockConnection(),
      sessionId,
      capabilities: { terminal: true },
      cwd: defaultCwd,
    });
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("bash");
    expect(toolNames).not.toContain("read");
    expect(toolNames).not.toContain("write");
    expect(toolNames).not.toContain("edit");
  });

  it("creates all proxies when full capabilities advertised", () => {
    const tools = createAcpProxyTools({
      connection: mockConnection(),
      sessionId,
      capabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
      cwd: defaultCwd,
    });
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("read");
    expect(toolNames).toContain("write");
    expect(toolNames).toContain("edit");
    expect(toolNames).toContain("bash");
    expect(tools.length).toBe(4);
  });

  it("does not create edit when only readTextFile is advertised", () => {
    const tools = createAcpProxyTools({
      connection: mockConnection(),
      sessionId,
      capabilities: { fs: { readTextFile: true } },
      cwd: defaultCwd,
    });
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("read");
    expect(toolNames).not.toContain("edit");
  });

  it("does not create edit when only writeTextFile is advertised", () => {
    const tools = createAcpProxyTools({
      connection: mockConnection(),
      sessionId,
      capabilities: { fs: { writeTextFile: true } },
      cwd: defaultCwd,
    });
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("write");
    expect(toolNames).not.toContain("edit");
  });
});

describe("read proxy", () => {
  const cwd = "/home/user/project";
  const sessionId = "test-session-id";

  it("reads file content and applies offset/limit", async () => {
    const conn = mockConnection({
      readTextFile: mock().mockResolvedValue({
        content: "line1\nline2\nline3\nline4\nline5",
      }),
    });
    const tools = createAcpProxyTools({
      connection: conn,
      sessionId,
      capabilities: { fs: { readTextFile: true } },
      cwd,
    });
    const readTool = tools.find((t) => t.name === "read")!;

    // Execute with offset (1-based) and limit
    const result = await readTool.execute(
      "tc-1",
      { path: "test.txt", offset: 2, limit: 3 },
      undefined,
      undefined,
      {} as any,
    );

    expect(result.content[0]).toMatchObject({
      type: "text",
      text: "line2\nline3\nline4",
    });
  });

  it("resolves relative paths against cwd", async () => {
    const conn = mockConnection({
      readTextFile: mock().mockResolvedValue({ content: "hello" }),
    });
    const tools = createAcpProxyTools({
      connection: conn,
      sessionId,
      capabilities: { fs: { readTextFile: true } },
      cwd,
    });
    const readTool = tools.find((t) => t.name === "read")!;

    await readTool.execute("tc-1", { path: "sub/file.txt" }, undefined, undefined, {} as any);

    expect(conn.readTextFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/home/user/project/sub/file.txt" }),
    );
  });

  it("passes absolute paths as-is", async () => {
    const conn = mockConnection({
      readTextFile: mock().mockResolvedValue({ content: "hello" }),
    });
    const tools = createAcpProxyTools({
      connection: conn,
      sessionId,
      capabilities: { fs: { readTextFile: true } },
      cwd,
    });
    const readTool = tools.find((t) => t.name === "read")!;

    await readTool.execute("tc-1", { path: "/tmp/file.txt" }, undefined, undefined, {} as any);

    expect(conn.readTextFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/tmp/file.txt" }),
    );
  });

  it("handles files with fewer lines than offset", async () => {
    const conn = mockConnection({
      readTextFile: mock().mockResolvedValue({ content: "line1\nline2" }),
    });
    const tools = createAcpProxyTools({
      connection: conn,
      sessionId,
      capabilities: { fs: { readTextFile: true } },
      cwd,
    });
    const readTool = tools.find((t) => t.name === "read")!;

    const result = await readTool.execute(
      "tc-1",
      { path: "test.txt", offset: 10 },
      undefined,
      undefined,
      {} as any,
    );

    expect(result.content[0]).toMatchObject({ type: "text", text: "" });
  });
});

describe("write proxy", () => {
  const cwd = "/home/user/project";
  const sessionId = "test-session-id";

  it("writes content to file and returns success message", async () => {
    const conn = mockConnection({
      writeTextFile: mock().mockResolvedValue({}),
    });
    const tools = createAcpProxyTools({
      connection: conn,
      sessionId,
      capabilities: { fs: { writeTextFile: true } },
      cwd,
    });
    const writeTool = tools.find((t) => t.name === "write")!;

    const result = await writeTool.execute(
      "tc-1",
      { path: "out.txt", content: "hello world" },
      undefined,
      undefined,
      {} as any,
    );

    expect(conn.writeTextFile).toHaveBeenCalledWith({
      sessionId,
      path: "/home/user/project/out.txt",
      content: "hello world",
    });

    expect(result.content[0]).toMatchObject({
      type: "text",
    });
    expect((result.content[0] as any).text).toContain("Successfully wrote");
  });
});

describe("edit proxy", () => {
  const cwd = "/home/user/project";
  const sessionId = "test-session-id";

  it("reads, edits, and writes the file", async () => {
    const conn = mockConnection({
      readTextFile: mock().mockResolvedValue({ content: "hello old world" }),
      writeTextFile: mock().mockResolvedValue({}),
    });
    const tools = createAcpProxyTools({
      connection: conn,
      sessionId,
      capabilities: { fs: { readTextFile: true, writeTextFile: true } },
      cwd,
    });
    const editTool = tools.find((t) => t.name === "edit")!;

    const result = await editTool.execute(
      "tc-1",
      { path: "test.txt", edits: [{ oldText: "old", newText: "new" }] },
      undefined,
      undefined,
      {} as any,
    );

    expect(conn.readTextFile).toHaveBeenCalledWith({
      sessionId,
      path: "/home/user/project/test.txt",
    });

    expect(conn.writeTextFile).toHaveBeenCalledWith({
      sessionId,
      path: "/home/user/project/test.txt",
      content: "hello new world",
    });

    expect(result.content[0]).toMatchObject({ type: "text" });
  });

  it("throws if oldText not found", async () => {
    const conn = mockConnection({
      readTextFile: mock().mockResolvedValue({ content: "hello world" }),
      writeTextFile: mock().mockResolvedValue({}),
    });
    const tools = createAcpProxyTools({
      connection: conn,
      sessionId,
      capabilities: { fs: { readTextFile: true, writeTextFile: true } },
      cwd,
    });
    const editTool = tools.find((t) => t.name === "edit")!;

    await expect(
      editTool.execute(
        "tc-1",
        { path: "test.txt", edits: [{ oldText: "nonexistent", newText: "replacement" }] },
        undefined,
        undefined,
        {} as any,
      ),
    ).rejects.toThrow("could not find exact text to replace");
  });

  it("applies multiple edits sequentially", async () => {
    const conn = mockConnection({
      readTextFile: mock().mockResolvedValue({ content: "a b c" }),
      writeTextFile: mock().mockResolvedValue({}),
    });
    const tools = createAcpProxyTools({
      connection: conn,
      sessionId,
      capabilities: { fs: { readTextFile: true, writeTextFile: true } },
      cwd,
    });
    const editTool = tools.find((t) => t.name === "edit")!;

    await editTool.execute(
      "tc-1",
      {
        path: "test.txt",
        edits: [
          { oldText: "a", newText: "1" },
          { oldText: "b", newText: "2" },
          { oldText: "c", newText: "3" },
        ],
      },
      undefined,
      undefined,
      {} as any,
    );

    expect(conn.writeTextFile).toHaveBeenCalledWith({
      sessionId,
      path: "/home/user/project/test.txt",
      content: "1 2 3",
    });
  });
});

describe("bash proxy", () => {
  const cwd = "/home/user/project";
  const sessionId = "test-session-id";

  it("creates a terminal, polls until exit, returns output", async () => {
    const terminal = mockTerminalHandle({
      currentOutput: mock()
        .mockResolvedValueOnce({ output: "progress...", truncated: false, exitStatus: undefined })
        .mockResolvedValueOnce({
          output: "final output",
          truncated: false,
          exitStatus: { exitCode: 0, signal: null },
        }),
    });
    const conn = mockConnection({
      createTerminal: mock().mockResolvedValue(terminal),
    });
    const tools = createAcpProxyTools({
      connection: conn,
      sessionId,
      capabilities: { terminal: true },
      cwd,
    });
    const bashTool = tools.find((t) => t.name === "bash")!;

    const result = await bashTool.execute(
      "tc-1",
      { command: "echo hello" },
      undefined,
      undefined,
      {} as any,
    );

    expect(conn.createTerminal).toHaveBeenCalledWith({
      sessionId,
      command: "echo hello",
      cwd,
    });

    expect(result.content[0]).toMatchObject({ type: "text" });
    expect((result.content[0] as any).text).toBe("final output");
    expect(terminal.release).toHaveBeenCalled();
  });

  it("streams partial output via onUpdate callback", async () => {
    const onUpdate = mock();
    const terminal = mockTerminalHandle({
      currentOutput: mock()
        .mockResolvedValueOnce({ output: "hello", truncated: false, exitStatus: undefined })
        .mockResolvedValueOnce({ output: "hello world", truncated: false, exitStatus: undefined })
        .mockResolvedValueOnce({
          output: "hello world",
          truncated: false,
          exitStatus: { exitCode: 0, signal: null },
        }),
    });
    const conn = mockConnection({
      createTerminal: mock().mockResolvedValue(terminal),
    });
    const tools = createAcpProxyTools({
      connection: conn,
      sessionId,
      capabilities: { terminal: true },
      cwd,
    });
    const bashTool = tools.find((t) => t.name === "bash")!;

    await bashTool.execute("tc-1", { command: "echo hello" }, undefined, onUpdate, {} as any);

    expect(onUpdate).toHaveBeenCalled();
    const firstCall = onUpdate.mock.calls[0]![0];
    expect(firstCall.content[0].text).toBe("hello");
  });

  it("kills and releases terminal on cancellation", async () => {
    const terminal = mockTerminalHandle({
      currentOutput: mock().mockResolvedValue({
        output: "partial",
        truncated: false,
        exitStatus: undefined,
      }),
    });
    const conn = mockConnection({
      createTerminal: mock().mockResolvedValue(terminal),
    });

    // Create an abort controller that fires
    const controller = new AbortController();
    const signal = controller.signal;

    const tools = createAcpProxyTools({
      connection: conn,
      sessionId,
      capabilities: { terminal: true },
      cwd,
    });
    const bashTool = tools.find((t) => t.name === "bash")!;

    const promise = bashTool.execute(
      "tc-1",
      { command: "sleep 100" },
      signal,
      undefined,
      {} as any,
    );
    controller.abort();

    const result = await promise;
    expect(terminal.kill).toHaveBeenCalled();
    expect(terminal.release).toHaveBeenCalled();
    expect((result.content[0] as any).text).toContain("Command cancelled");
  });

  it("times out after specified duration", async () => {
    const terminal = mockTerminalHandle({
      currentOutput: mock().mockResolvedValue({
        output: "running...",
        truncated: false,
        exitStatus: undefined,
      }),
    });
    const conn = mockConnection({
      createTerminal: mock().mockResolvedValue(terminal),
    });

    const tools = createAcpProxyTools({
      connection: conn,
      sessionId,
      capabilities: { terminal: true },
      cwd,
    });
    const bashTool = tools.find((t) => t.name === "bash")!;

    // Use a very short timeout (1ms) to trigger timeout immediately
    const result = await bashTool.execute(
      "tc-1",
      { command: "sleep 100", timeout: 1 },
      undefined,
      undefined,
      {} as any,
    );

    expect(terminal.kill).toHaveBeenCalled();
    expect(terminal.release).toHaveBeenCalled();
    expect((result.content[0] as any).text).toContain("timed out");
  });

  it("releases terminal on error", async () => {
    const terminal = mockTerminalHandle({
      currentOutput: mock().mockRejectedValue(new Error("connection lost")),
      release: mock().mockResolvedValue({}),
    });
    const conn = mockConnection({
      createTerminal: mock().mockResolvedValue(terminal),
    });

    const tools = createAcpProxyTools({
      connection: conn,
      sessionId,
      capabilities: { terminal: true },
      cwd,
    });
    const bashTool = tools.find((t) => t.name === "bash")!;

    await expect(
      bashTool.execute("tc-1", { command: "echo hello" }, undefined, undefined, {} as any),
    ).rejects.toThrow("connection lost");

    expect(terminal.release).toHaveBeenCalled();
  });
});
