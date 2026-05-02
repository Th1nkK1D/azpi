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
        content: { text: argsStr, type: "text" },
        type: "content",
      },
    ],
    status: "pending",
    title: event.toolName,
    toolCallId: event.toolCallId,
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
        content: { text: updateStr, type: "text" },
        type: "content",
      },
    ],
    status: "in_progress",
    toolCallId: event.toolCallId,
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
        content: { text: resultStr, type: "text" },
        type: "content",
      },
    ],
    status: event.isError ? "failed" : "completed",
    toolCallId: event.toolCallId,
  };
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, undefined, 2);
  } catch {
    return String(value);
  }
}
