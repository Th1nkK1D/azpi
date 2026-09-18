import { describe, expect, it, mock } from "bun:test";
import { createAcpProxyTools } from "../src/client-tool-proxy";
import { mockClient } from "./mock-client";

/** Mock client whose terminal/output responses come from `output`. */
function mockTerminalClient(output: (params: any) => any) {
  return mockClient({
    "terminal/create": async () => ({ terminalId: "term-1" }),
    "terminal/output": output,
  });
}

describe("createAcpProxyTools", () => {
  const defaultCwd = "/home/user/project";
  const sessionId = "test-session-id";

  it("returns empty array when no capabilities are advertised", () => {
    const tools = createAcpProxyTools({
      client: mockClient(),
      sessionId,
      capabilities: {},
      cwd: defaultCwd,
    });
    expect(tools).toHaveLength(0);
  });

  it("creates read proxy when client advertises fs.readTextFile", () => {
    const tools = createAcpProxyTools({
      client: mockClient(),
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
      client: mockClient(),
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
      client: mockClient(),
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
      client: mockClient(),
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
      client: mockClient(),
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
});

describe("read proxy", () => {
  const cwd = "/home/user/project";
  const sessionId = "test-session-id";

  it("reads file content and applies offset/limit", async () => {
    const conn = mockClient({
      "fs/read_text_file": mock().mockResolvedValue({
        content: "line1\nline2\nline3\nline4\nline5",
      }),
    });
    const tools = createAcpProxyTools({
      client: conn,
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
    const conn = mockClient({
      "fs/read_text_file": mock().mockResolvedValue({ content: "hello" }),
    });
    const tools = createAcpProxyTools({
      client: conn,
      sessionId,
      capabilities: { fs: { readTextFile: true } },
      cwd,
    });
    const readTool = tools.find((t) => t.name === "read")!;

    await readTool.execute("tc-1", { path: "sub/file.txt" }, undefined, undefined, {} as any);

    expect(conn.method("fs/read_text_file")).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/home/user/project/sub/file.txt" }),
    );
  });

  it("passes absolute paths as-is", async () => {
    const conn = mockClient({
      "fs/read_text_file": mock().mockResolvedValue({ content: "hello" }),
    });
    const tools = createAcpProxyTools({
      client: conn,
      sessionId,
      capabilities: { fs: { readTextFile: true } },
      cwd,
    });
    const readTool = tools.find((t) => t.name === "read")!;

    await readTool.execute("tc-1", { path: "/tmp/file.txt" }, undefined, undefined, {} as any);

    expect(conn.method("fs/read_text_file")).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/tmp/file.txt" }),
    );
  });

  it("handles files with fewer lines than offset", async () => {
    const conn = mockClient({
      "fs/read_text_file": mock().mockResolvedValue({ content: "line1\nline2" }),
    });
    const tools = createAcpProxyTools({
      client: conn,
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
    const conn = mockClient({
      "fs/write_text_file": mock().mockResolvedValue({}),
    });
    const tools = createAcpProxyTools({
      client: conn,
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

    expect(conn.method("fs/write_text_file")).toHaveBeenCalledWith({
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
    const conn = mockClient({
      "fs/read_text_file": mock().mockResolvedValue({ content: "hello old world" }),
      "fs/write_text_file": mock().mockResolvedValue({}),
    });
    const tools = createAcpProxyTools({
      client: conn,
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

    expect(conn.method("fs/read_text_file")).toHaveBeenCalledWith({
      sessionId,
      path: "/home/user/project/test.txt",
    });

    expect(conn.method("fs/write_text_file")).toHaveBeenCalledWith({
      sessionId,
      path: "/home/user/project/test.txt",
      content: "hello new world",
    });

    expect(result.content[0]).toMatchObject({ type: "text" });
  });

  it("throws if oldText not found", async () => {
    const conn = mockClient({
      "fs/read_text_file": mock().mockResolvedValue({ content: "hello world" }),
      "fs/write_text_file": mock().mockResolvedValue({}),
    });
    const tools = createAcpProxyTools({
      client: conn,
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
    const conn = mockClient({
      "fs/read_text_file": mock().mockResolvedValue({ content: "a b c" }),
      "fs/write_text_file": mock().mockResolvedValue({}),
    });
    const tools = createAcpProxyTools({
      client: conn,
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

    expect(conn.method("fs/write_text_file")).toHaveBeenCalledWith({
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
    const conn = mockTerminalClient(
      mock()
        .mockResolvedValueOnce({ output: "progress...", truncated: false, exitStatus: undefined })
        .mockResolvedValueOnce({
          output: "final output",
          truncated: false,
          exitStatus: { exitCode: 0, signal: null },
        }),
    );
    const tools = createAcpProxyTools({
      client: conn,
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

    expect(conn.method("terminal/create")).toHaveBeenCalledWith({
      sessionId,
      command: "echo hello",
      cwd,
    });
    expect(conn.method("terminal/output")).toHaveBeenCalledWith({
      sessionId,
      terminalId: "term-1",
    });

    expect(result.content[0]).toMatchObject({ type: "text" });
    expect((result.content[0] as any).text).toBe("final output");
    expect(conn.method("terminal/release")).toHaveBeenCalledWith({
      sessionId,
      terminalId: "term-1",
    });
  });

  it("streams partial output via onUpdate callback", async () => {
    const onUpdate = mock();
    const conn = mockTerminalClient(
      mock()
        .mockResolvedValueOnce({ output: "hello", truncated: false, exitStatus: undefined })
        .mockResolvedValueOnce({ output: "hello world", truncated: false, exitStatus: undefined })
        .mockResolvedValueOnce({
          output: "hello world",
          truncated: false,
          exitStatus: { exitCode: 0, signal: null },
        }),
    );
    const tools = createAcpProxyTools({
      client: conn,
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
    const conn = mockTerminalClient(async () => ({
      output: "partial",
      truncated: false,
      exitStatus: undefined,
    }));

    // Create an abort controller that fires
    const controller = new AbortController();
    const signal = controller.signal;

    const tools = createAcpProxyTools({
      client: conn,
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
    expect(conn.method("terminal/kill")).toHaveBeenCalled();
    expect(conn.method("terminal/release")).toHaveBeenCalled();
    expect((result.content[0] as any).text).toContain("Command cancelled");
  });

  it("times out after specified duration", async () => {
    const conn = mockTerminalClient(async () => ({
      output: "running...",
      truncated: false,
      exitStatus: undefined,
    }));

    const tools = createAcpProxyTools({
      client: conn,
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

    expect(conn.method("terminal/kill")).toHaveBeenCalled();
    expect(conn.method("terminal/release")).toHaveBeenCalled();
    expect((result.content[0] as any).text).toContain("timed out");
  });

  it("releases terminal on error", async () => {
    const conn = mockTerminalClient(async () => {
      throw new Error("connection lost");
    });

    const tools = createAcpProxyTools({
      client: conn,
      sessionId,
      capabilities: { terminal: true },
      cwd,
    });
    const bashTool = tools.find((t) => t.name === "bash")!;

    await expect(
      bashTool.execute("tc-1", { command: "echo hello" }, undefined, undefined, {} as any),
    ).rejects.toThrow("connection lost");

    expect(conn.method("terminal/release")).toHaveBeenCalled();
  });
});
