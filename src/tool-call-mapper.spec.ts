import { describe, expect, it } from "bun:test";
import { mapToolCallEnd, mapToolCallStart, mapToolCallUpdate } from "./tool-call-mapper";

describe("tool-mapper", () => {
  describe("mapToolCallStart", () => {
    it("maps tool_execution_start to ACP ToolCall", () => {
      const event = {
        args: { command: "echo hello" },
        toolCallId: "tc-1",
        toolName: "bash",
        type: "tool_execution_start" as const,
      };
      const result = mapToolCallStart(event);
      expect(result.toolCallId).toBe("tc-1");
      expect(result.title).toBe("bash");
      expect(result.status).toBe("pending");
      expect(result.content).toHaveLength(1);
      expect(result.content![0]!.type).toBe("content");
      expect((result.content![0] as any).content.text).toContain("echo hello");
    });

    it("handles non-serializable args gracefully", () => {
      const circular: any = {};
      circular.self = circular;
      const event = {
        args: circular,
        toolCallId: "tc-2",
        toolName: "read",
        type: "tool_execution_start" as const,
      };
      const result = mapToolCallStart(event);
      expect((result.content![0] as any).content.text).toBeTruthy();
      expect(typeof (result.content![0] as any).content.text).toBe("string");
    });
  });

  describe("mapToolCallUpdate", () => {
    it("extracts text from content array when present", () => {
      const event = {
        args: { command: "echo hello" },
        partialResult: {
          content: [{ type: "text", text: "hello world" }],
          details: {},
        },
        toolCallId: "tc-1",
        toolName: "bash",
        type: "tool_execution_update" as const,
      };
      const result = mapToolCallUpdate(event);
      expect(result.status).toBe("in_progress");
      expect((result.content![0] as any).content.text).toBe("hello world");
    });

    it("falls back to JSON when content array is missing", () => {
      const event = {
        args: { command: "echo hello" },
        partialResult: { output: "hello" },
        toolCallId: "tc-1",
        toolName: "bash",
        type: "tool_execution_update" as const,
      };
      const result = mapToolCallUpdate(event);
      expect(result.status).toBe("in_progress");
      expect((result.content![0] as any).content.text).toContain("hello");
    });

    it("extracts first text block when there are multiple content blocks", () => {
      const event = {
        args: {},
        partialResult: {
          content: [
            { type: "text", text: "first block" },
            { type: "text", text: "second block" },
          ],
          details: {},
        },
        toolCallId: "tc-1",
        toolName: "bash",
        type: "tool_execution_update" as const,
      };
      const result = mapToolCallUpdate(event);
      expect((result.content![0] as any).content.text).toBe("first block");
    });

    it("handles empty content array gracefully", () => {
      const event = {
        args: {},
        partialResult: { content: [], details: {} },
        toolCallId: "tc-1",
        toolName: "bash",
        type: "tool_execution_update" as const,
      };
      const result = mapToolCallUpdate(event);
      expect(typeof (result.content![0] as any).content.text).toBe("string");
    });
  });

  describe("mapToolCallEnd", () => {
    it("extracts text from content array for completed tools", () => {
      const event = {
        isError: false,
        result: {
          content: [{ type: "text", text: "final result text" }],
          details: {},
        },
        toolCallId: "tc-1",
        toolName: "bash",
        type: "tool_execution_end" as const,
      };
      const result = mapToolCallEnd(event);
      expect(result.status).toBe("completed");
      expect((result.content![0] as any).content.text).toBe("final result text");
    });

    it("maps failed tool_execution_end with failed status", () => {
      const event = {
        isError: true,
        result: {
          content: [{ type: "text", text: "Something went wrong" }],
          details: {},
        },
        toolCallId: "tc-1",
        toolName: "bash",
        type: "tool_execution_end" as const,
      };
      const result = mapToolCallEnd(event);
      expect(result.status).toBe("failed");
      expect((result.content![0] as any).content.text).toBe("Something went wrong");
    });

    it("falls back to JSON when result is a plain object", () => {
      const event = {
        isError: false,
        result: { code: 0, output: "done" },
        toolCallId: "tc-1",
        toolName: "bash",
        type: "tool_execution_end" as const,
      };
      const result = mapToolCallEnd(event);
      expect(result.status).toBe("completed");
      expect((result.content![0] as any).content.text).toContain("done");
    });

    it("uses error field when result has error message", () => {
      const event = {
        isError: true,
        result: { error: "command not found" },
        toolCallId: "tc-1",
        toolName: "bash",
        type: "tool_execution_end" as const,
      };
      const result = mapToolCallEnd(event);
      expect(result.status).toBe("failed");
      expect((result.content![0] as any).content.text).toBe("command not found");
    });

    it("handles null/undefined result gracefully", () => {
      const event = {
        isError: false,
        result: null,
        toolCallId: "tc-1",
        toolName: "bash",
        type: "tool_execution_end" as const,
      };
      const result = mapToolCallEnd(event);
      expect(result.status).toBe("completed");
      expect(typeof (result.content![0] as any).content.text).toBe("string");
    });
  });
});
