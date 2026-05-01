/**
 * Tool-mapper.ts — Maps Pi AgentTool events to ACP ToolCall / ToolCallUpdate shapes.
 */
import type * as acp from "@agentclientprotocol/sdk";
import type { AgentEvent } from "@mariozechner/pi-agent-core";

/**
 * Maps a Pi tool_execution_start event to an ACP ToolCall notification.
 */
export function mapToolCallStart(
  event: AgentEvent & { type: "tool_execution_start" },
): acp.ToolCall {
  const argsStr = safeJsonStringify(event.args);
  return {
    content: [
      {
        text: argsStr,
        type: "text",
      },
    ],
    kind: "tool",
    status: "pending",
    title: event.toolName,
    toolCallId: event.toolCallId,
    type: "tool_call",
  };
}

/**
 * Maps a Pi tool_execution_update event to an ACP ToolCallUpdate notification.
 */
export function mapToolCallUpdate(
  event: AgentEvent & { type: "tool_execution_update" },
): acp.ToolCallUpdate {
  const updateStr = safeJsonStringify(event.partialResult);
  return {
    content: [
      {
        text: updateStr,
        type: "text",
      },
    ],
    status: "in_progress",
    toolCallId: event.toolCallId,
    type: "tool_call_update",
  };
}

/**
 * Maps a Pi tool_execution_end event to an ACP ToolCallUpdate notification.
 */
export function mapToolCallEnd(
  event: AgentEvent & { type: "tool_execution_end" },
): acp.ToolCallUpdate {
  const resultStr = safeJsonStringify(event.result);
  return {
    content: [
      {
        text: resultStr,
        type: "text",
      },
    ],
    status: event.isError ? "failed" : "completed",
    toolCallId: event.toolCallId,
    type: "tool_call_update",
  };
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
