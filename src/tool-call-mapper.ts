import type { ToolCall, ToolCallUpdate } from "@agentclientprotocol/sdk";
import type { AgentEvent } from "@mariozechner/pi-agent-core";

/**
 * Maps a Pi tool_execution_start event to an ACP ToolCall notification.
 */
export function mapToolCallStart(event: AgentEvent & { type: "tool_execution_start" }): ToolCall {
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
): ToolCallUpdate {
  const textContent = extractTextFromToolResult(event.partialResult);
  return {
    content: [
      {
        content: { text: textContent, type: "text" },
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
export function mapToolCallEnd(event: AgentEvent & { type: "tool_execution_end" }): ToolCallUpdate {
  const textContent = extractTextFromToolResult(event.result);
  return {
    content: [
      {
        content: { text: textContent, type: "text" },
        type: "content",
      },
    ],
    status: event.isError ? "failed" : "completed",
    toolCallId: event.toolCallId,
  };
}

/**
 * Best-effort extraction of the first text block from a Pi AgentToolResult.
 *
 * Pi tool results and partial results have the shape:
 *   { content: [{ type: "text", text: "..." }], details: {...} }
 *
 * If the value matches this pattern we return the clean text directly;
 * otherwise we fall back to a JSON representation.
 */
function extractTextFromToolResult(value: unknown): string {
  if (!value || typeof value !== "object") {
    return String(value ?? "");
  }

  const obj = value as Record<string, unknown>;

  const content = obj.content;
  if (Array.isArray(content) && content.length > 0) {
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        (block as Record<string, unknown>).type === "text"
      ) {
        const text = (block as Record<string, unknown>).text;
        if (typeof text === "string") {
          return text;
        }
      }
    }
  }

  if (typeof obj.error === "string") {
    return obj.error;
  }

  return safeJsonStringify(value);
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, undefined, 2);
  } catch {
    return String(value);
  }
}
