import { describe, expect, it } from "bun:test";
import { mapToolCallEnd, mapToolCallStart, mapToolCallUpdate } from "./tool-mapper";

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
      expect(result.type).toBe("tool_call");
      expect(result.toolCallId).toBe("tc-1");
      expect(result.title).toBe("bash");
      expect(result.kind).toBe("tool");
      expect(result.status).toBe("pending");
      expect(result.content).toHaveLength(1);
      expect(result.content![0]!.type).toBe("text");
      expect(result.content![0]!.text).toContain("echo hello");
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
      expect(result.content![0]!.text).toBeTruthy();
      expect(typeof result.content![0]!.text).toBe("string");
    });
  });

  describe("mapToolCallUpdate", () => {
    it("maps tool_execution_update to ACP ToolCallUpdate with in_progress", () => {
      const event = {
        args: { command: "echo hello" },
        partialResult: { output: "hello" },
        toolCallId: "tc-1",
        toolName: "bash",
        type: "tool_execution_update" as const,
      };
      const result = mapToolCallUpdate(event);
      expect(result.type).toBe("tool_call_update");
      expect(result.toolCallId).toBe("tc-1");
      expect(result.status).toBe("in_progress");
      expect(result.content![0]!.text).toContain("hello");
    });
  });

  describe("mapToolCallEnd", () => {
    it("maps successful tool_execution_end to ACP ToolCallUpdate with completed", () => {
      const event = {
        isError: false,
        result: { code: 0, output: "done" },
        toolCallId: "tc-1",
        toolName: "bash",
        type: "tool_execution_end" as const,
      };
      const result = mapToolCallEnd(event);
      expect(result.type).toBe("tool_call_update");
      expect(result.toolCallId).toBe("tc-1");
      expect(result.status).toBe("completed");
      expect(result.content![0]!.text).toContain("done");
    });

    it("maps failed tool_execution_end to ACP ToolCallUpdate with failed", () => {
      const event = {
        isError: true,
        result: { error: "command not found" },
        toolCallId: "tc-1",
        toolName: "bash",
        type: "tool_execution_end" as const,
      };
      const result = mapToolCallEnd(event);
      expect(result.status).toBe("failed");
    });
  });
});
