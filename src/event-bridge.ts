import type * as acp from "@agentclientprotocol/sdk";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import { mapToolCallEnd, mapToolCallStart, mapToolCallUpdate } from "./tool-call-mapper";

/**
 * Maps a Pi AgentSessionEvent to an ACP SessionNotification, or null if the event
 * should not produce a notification.
 */
export function mapSessionEvent(
  event: AgentSessionEvent,
  sessionId: string,
  configOptions?: acp.SessionConfigOption[],
): acp.SessionNotification | null {
  switch (event.type) {
    case "message_update": {
      const assistantEvent = event.assistantMessageEvent;
      if (assistantEvent?.type === "text_delta") {
        const delta = assistantEvent.delta;
        if (typeof delta !== "string" || delta.length === 0) {
          return null;
        }
        return {
          sessionId,
          update: {
            content: { text: delta, type: "text" },
            sessionUpdate: "agent_message_chunk",
          },
        };
      } else if (assistantEvent?.type === "thinking_delta") {
        const delta = assistantEvent.delta;
        if (typeof delta !== "string" || delta.length === 0) {
          return null;
        }
        return {
          sessionId,
          update: {
            content: { text: delta, type: "text" },
            sessionUpdate: "agent_thought_chunk",
          },
        };
      }
      return null;
    }

    case "message_start": {
      // Optional: could emit a plan marker or no-op
      return null;
    }

    case "message_end": {
      // No notification needed — handled by agent_end
      return null;
    }

    case "tool_execution_start": {
      return {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          ...mapToolCallStart(event),
        },
      };
    }

    case "tool_execution_update": {
      return {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          ...mapToolCallUpdate(event),
        },
      };
    }

    case "tool_execution_end": {
      return {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          ...mapToolCallEnd(event),
        },
      };
    }

    case "session_info_changed": {
      return {
        sessionId,
        update: {
          sessionUpdate: "session_info_update",
          title: event.name ?? null,
        },
      };
    }

    case "thinking_level_changed": {
      if (!configOptions) return null;
      return {
        sessionId,
        update: {
          sessionUpdate: "config_option_update",
          configOptions,
        },
      };
    }

    case "agent_start":
    case "agent_end":
    case "turn_start":
    case "turn_end":
    case "queue_update":
    case "compaction_start":
    case "compaction_end":
    case "auto_retry_start":
    case "auto_retry_end": {
      // These events don't map to ACP notifications in the MVP
      return null;
    }

    default: {
      return null;
    }
  }
}

/**
 * Extracts the first text content from a Pi AgentMessage.
 */
function extractTextContent(message: any): string | null {
  if (typeof message?.content === "string") {
    return message.content;
  }
  if (Array.isArray(message?.content)) {
    for (const block of message.content) {
      if (block.type === "text" && typeof block.text === "string") {
        return block.text;
      }
    }
  }
  return null;
}

/**
 * Maps a Pi agent_end event to an ACP StopReason.
 */
export function mapStopReason(message: any): acp.StopReason {
  const stopReason = message?.stopReason as string | undefined;
  switch (stopReason) {
    case "max_tokens":
      return "max_tokens";
    case "aborted":
      return "cancelled";
    case "error":
    case "end_turn":
    case "stop":
    default:
      return "end_turn";
  }
}

/**
 * Maps the final message content from an agent_end event to ACP content blocks.
 */
export function mapFinalContent(message: any): acp.ContentBlock[] {
  const text = extractTextContent(message);
  if (!text) {
    return [];
  }
  return [{ text, type: "text" }];
}
