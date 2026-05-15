import { describe, expect, it } from "bun:test";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { StopReason } from "@agentclientprotocol/sdk";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { mapFinalContent, mapSessionEvent, mapStopReason } from "../src/event-bridge";

const SID = "test-session";

describe("event-bridge", () => {
  describe("mapSessionEvent", () => {
    it("maps message_update text_delta to agent_message_chunk", () => {
      const event = {
        assistantMessageEvent: { delta: "Hello world", type: "text_delta" },
        message: { content: "Hello world", role: "assistant" },
        type: "message_update" as const,
      } as unknown as AgentSessionEvent;
      const result = mapSessionEvent(event, SID);
      expect(result).not.toBeNull();
      expect(result!.update.sessionUpdate).toBe("agent_message_chunk");
      expect(result!.sessionId).toBe(SID);
      expect((result!.update as any).content.text).toBe("Hello world");
    });

    it("returns null for message_update with empty delta", () => {
      const event = {
        assistantMessageEvent: { delta: "", type: "text_delta" },
        message: { content: [], role: "assistant" },
        type: "message_update" as const,
      } as unknown as AgentSessionEvent;
      const result = mapSessionEvent(event, SID);
      expect(result).toBeNull();
    });

    it("returns null for message_update non-text_delta assistantMessageEvent", () => {
      const event = {
        assistantMessageEvent: { type: "text_start" },
        message: { content: "Hello world", role: "assistant" },
        type: "message_update" as const,
      } as unknown as AgentSessionEvent;
      const result = mapSessionEvent(event, SID);
      expect(result).toBeNull();
    });

    it("maps tool_execution_start to tool_call", () => {
      const event = {
        args: { command: "ls" },
        toolCallId: "tc-1",
        toolName: "bash",
        type: "tool_execution_start" as const,
      } as unknown as AgentSessionEvent;
      const result = mapSessionEvent(event, SID);
      expect(result).not.toBeNull();
      expect(result!.update.sessionUpdate).toBe("tool_call");
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
      } as unknown as AgentSessionEvent;
      const result = mapSessionEvent(event, SID);
      expect(result).not.toBeNull();
      expect(result!.update.sessionUpdate).toBe("tool_call_update");
      expect((result!.update as any).status).toBe("in_progress");
    });

    it("maps successful tool_execution_end to tool_call_update with completed", () => {
      const event = {
        isError: false,
        result: { code: 0, output: "done" },
        toolCallId: "tc-1",
        toolName: "bash",
        type: "tool_execution_end" as const,
      } as unknown as AgentSessionEvent;
      const result = mapSessionEvent(event, SID);
      expect(result).not.toBeNull();
      expect(result!.update.sessionUpdate).toBe("tool_call_update");
      expect((result!.update as any).status).toBe("completed");
    });

    it("maps failed tool_execution_end to tool_call_update with failed", () => {
      const event = {
        isError: true,
        result: { error: "fail" },
        toolCallId: "tc-1",
        toolName: "bash",
        type: "tool_execution_end" as const,
      } as unknown as AgentSessionEvent;
      const result = mapSessionEvent(event, SID);
      expect(result).not.toBeNull();
      expect(result!.update.sessionUpdate).toBe("tool_call_update");
      expect((result!.update as any).status).toBe("failed");
    });

    it("returns null for agent_start", () => {
      const event = { type: "agent_start" as const } as unknown as AgentSessionEvent;
      expect(mapSessionEvent(event, SID)).toBeNull();
    });

    it("returns null for agent_end", () => {
      const event = {
        messages: [],
        type: "agent_end" as const,
      } as unknown as AgentSessionEvent;
      expect(mapSessionEvent(event, SID)).toBeNull();
    });

    it("maps message_update thinking_delta to agent_thought_chunk", () => {
      const event = {
        assistantMessageEvent: { delta: "Let me think...", type: "thinking_delta" },
        message: { content: "Let me think...", role: "assistant" },
        type: "message_update" as const,
      } as unknown as AgentSessionEvent;
      const result = mapSessionEvent(event, SID);
      expect(result).not.toBeNull();
      expect(result!.update.sessionUpdate).toBe("agent_thought_chunk");
      expect(result!.sessionId).toBe(SID);
      expect((result!.update as any).content.text).toBe("Let me think...");
    });

    it("returns null for message_update thinking_delta with empty delta", () => {
      const event = {
        assistantMessageEvent: { delta: "", type: "thinking_delta" },
        message: { content: [], role: "assistant" },
        type: "message_update" as const,
      } as unknown as AgentSessionEvent;
      const result = mapSessionEvent(event, SID);
      expect(result).toBeNull();
    });

    it("maps session_info_changed to session_info_update", () => {
      const event = {
        name: "My Session",
        type: "session_info_changed" as const,
      } as unknown as AgentSessionEvent;
      const result = mapSessionEvent(event, SID);
      expect(result).not.toBeNull();
      expect(result!.update.sessionUpdate).toBe("session_info_update");
      expect(result!.sessionId).toBe(SID);
      expect((result!.update as any).title).toBe("My Session");
    });

    it("maps session_info_changed with undefined name to null title", () => {
      const event = {
        name: undefined,
        type: "session_info_changed" as const,
      } as unknown as AgentSessionEvent;
      const result = mapSessionEvent(event, SID);
      expect(result).not.toBeNull();
      expect(result!.update.sessionUpdate).toBe("session_info_update");
      expect((result!.update as any).title).toBeNull();
    });

    it("maps thinking_level_changed to config_option_update when configOptions provided", () => {
      const event = {
        level: "high",
        type: "thinking_level_changed" as const,
      } as unknown as AgentSessionEvent;
      const configOptions: SessionConfigOption[] = [
        {
          id: "thinking-level",
          category: "thought_level",
          name: "Thinking",
          options: [],
          currentValue: "high",
          type: "select",
        },
      ];
      const result = mapSessionEvent(event, SID, configOptions);
      expect(result).not.toBeNull();
      expect(result!.update.sessionUpdate).toBe("config_option_update");
      expect(result!.sessionId).toBe(SID);
      expect((result!.update as any).configOptions).toBe(configOptions);
    });

    it("returns null for thinking_level_changed when configOptions not provided", () => {
      const event = {
        level: "high",
        type: "thinking_level_changed" as const,
      } as unknown as AgentSessionEvent;
      const result = mapSessionEvent(event, SID);
      expect(result).toBeNull();
    });
  });

  describe("mapStopReason", () => {
    it.each([
      ["aborted", "cancelled"],
      ["length", "max_tokens"],
      ["error", "end_turn"],
      ["stop", "end_turn"],
      ["toolUse", "end_turn"],
      [undefined, "end_turn"],
    ])("maps %s → %s", (input, expected) => {
      const msg = { role: "assistant" as const, stopReason: input };
      expect(mapStopReason(msg as unknown as AgentMessage)).toBe(expected as StopReason);
    });

    it("returns end_turn for non-assistant messages", () => {
      expect(mapStopReason({ role: "user" } as unknown as AgentMessage)).toBe("end_turn");
    });

    it("returns end_turn for undefined", () => {
      expect(mapStopReason(undefined)).toBe("end_turn");
    });
  });

  describe("mapFinalContent", () => {
    it("extracts text from string content", () => {
      const msg = { role: "user" as const, content: "Final answer", timestamp: 0 };
      const result = mapFinalContent(msg as unknown as AgentMessage);
      expect(result).toEqual([{ text: "Final answer", type: "text" }]);
    });

    it("extracts text from array content", () => {
      const msg = {
        role: "user" as const,
        content: [{ text: "Array answer", type: "text" }],
        timestamp: 0,
      };
      const result = mapFinalContent(msg as unknown as Parameters<typeof mapFinalContent>[0]);
      expect(result).toEqual([{ text: "Array answer", type: "text" }]);
    });

    it("returns empty array for no text", () => {
      const msg = { role: "user" as const, content: [], timestamp: 0 };
      expect(mapFinalContent(msg as unknown as Parameters<typeof mapFinalContent>[0])).toEqual([]);
    });

    it("returns empty array for undefined message", () => {
      expect(mapFinalContent(undefined)).toEqual([]);
    });
  });
});
