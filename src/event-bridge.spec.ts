import { describe, expect, it } from "bun:test";
import { mapFinalContent, mapSessionEvent, mapStopReason } from "./event-bridge";

const SID = "test-session";

describe("event-bridge", () => {
  describe("mapSessionEvent", () => {
    it("maps message_update to agent_message_chunk", () => {
      const event = {
        assistantMessageEvent: { text: "Hello world", type: "text_delta" },
        message: { content: "Hello world", role: "assistant" },
        type: "message_update" as const,
      };
      const result = mapSessionEvent(event, SID);
      expect(result).not.toBeNull();
      expect(result!.type).toBe("agent_message_chunk");
      expect(result!.sessionId).toBe(SID);
      expect((result!.update as any).content.text).toBe("Hello world");
    });

    it("returns null for message_update with no text content", () => {
      const event = {
        assistantMessageEvent: { text: "", type: "text_delta" },
        message: { content: [], role: "assistant" },
        type: "message_update" as const,
      };
      const result = mapSessionEvent(event, SID);
      expect(result).toBeNull();
    });

    it("maps tool_execution_start to tool_call", () => {
      const event = {
        args: { command: "ls" },
        toolCallId: "tc-1",
        toolName: "bash",
        type: "tool_execution_start" as const,
      };
      const result = mapSessionEvent(event, SID);
      expect(result).not.toBeNull();
      expect(result!.type).toBe("tool_call");
      expect(result!.sessionId).toBe(SID);
      expect((result!.update as any).toolCallId).toBe("tc-1");
      expect((result!.update as any).status).toBe("pending");
    });

    it("maps tool_execution_update to tool_call_update", () => {
      const event = {
        args: { command: "ls" },
        partialResult: { output: "file.txt" },
        toolCallId: "tc-1",
        toolName: "bash",
        type: "tool_execution_update" as const,
      };
      const result = mapSessionEvent(event, SID);
      expect(result).not.toBeNull();
      expect(result!.type).toBe("tool_call_update");
      expect((result!.update as any).status).toBe("in_progress");
    });

    it("maps successful tool_execution_end to tool_call_update with completed", () => {
      const event = {
        isError: false,
        result: { code: 0, output: "done" },
        toolCallId: "tc-1",
        toolName: "bash",
        type: "tool_execution_end" as const,
      };
      const result = mapSessionEvent(event, SID);
      expect(result).not.toBeNull();
      expect(result!.type).toBe("tool_call_update");
      expect((result!.update as any).status).toBe("completed");
    });

    it("maps failed tool_execution_end to tool_call_update with failed", () => {
      const event = {
        isError: true,
        result: { error: "fail" },
        toolCallId: "tc-1",
        toolName: "bash",
        type: "tool_execution_end" as const,
      };
      const result = mapSessionEvent(event, SID);
      expect(result).not.toBeNull();
      expect((result!.update as any).status).toBe("failed");
    });

    it("returns null for agent_start", () => {
      const event = { type: "agent_start" as const };
      expect(mapSessionEvent(event, SID)).toBeNull();
    });

    it("returns null for agent_end", () => {
      const event = { messages: [], type: "agent_end" as const };
      expect(mapSessionEvent(event, SID)).toBeNull();
    });
  });

  describe("mapStopReason", () => {
    it.each([
      ["aborted", "cancelled"],
      ["error", "error"],
      ["end_turn", "end_turn"],
      ["max_tokens", "max_tokens"],
      ["stop", "end_turn"],
      [undefined, "end_turn"],
      ["unknown", "end_turn"],
    ])("maps %s → %s", (input, expected) => {
      const msg = { stopReason: input };
      expect(mapStopReason(msg)).toBe(expected);
    });
  });

  describe("mapFinalContent", () => {
    it("extracts text from string content", () => {
      const msg = { content: "Final answer" };
      const result = mapFinalContent(msg);
      expect(result).toEqual([{ text: "Final answer", type: "text" }]);
    });

    it("extracts text from array content", () => {
      const msg = { content: [{ text: "Array answer", type: "text" }] };
      const result = mapFinalContent(msg);
      expect(result).toEqual([{ text: "Array answer", type: "text" }]);
    });

    it("returns empty array for no text", () => {
      const msg = { content: [] };
      expect(mapFinalContent(msg)).toEqual([]);
    });

    it("returns empty array for null message", () => {
      expect(mapFinalContent(null)).toEqual([]);
    });
  });
});
