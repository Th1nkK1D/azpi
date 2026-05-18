import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import { extractMessageText } from "./event-bridge";
import { SessionUpdateType } from "./session-update-types";

/**
 * Resolves a Pi session UUID to its JSONL file path.
 * Uses an in-memory cache first, then falls back to SessionManager.list()
 * and SessionManager.listAll() for cross-cwd lookup.
 */
export class SessionResolver {
  private cache = new Map<string, string>();

  registerSession(sessionId: string, path: string): void {
    this.cache.set(sessionId, path);
  }

  unregisterSession(sessionId: string): void {
    this.cache.delete(sessionId);
  }

  async resolveSessionPath(cwd: string, sessionId: string): Promise<string | undefined> {
    const cached = this.cache.get(sessionId);
    if (cached) return cached;

    const sessions = await SessionManager.list(cwd);
    for (const info of sessions) {
      if (info.id === sessionId) {
        this.cache.set(sessionId, info.path);
        return info.path;
      }
    }

    const allSessions = await SessionManager.listAll();
    for (const info of allSessions) {
      if (info.id === sessionId) {
        this.cache.set(sessionId, info.path);
        return info.path;
      }
    }

    return undefined;
  }

  async warmCache(cwd: string): Promise<void> {
    const sessions = await SessionManager.list(cwd);
    for (const info of sessions) {
      this.cache.set(info.id, info.path);
    }
  }
}

/**
 * Replays conversation history from a Pi session as ACP session/update notifications.
 *
 * Replays user messages, assistant text/thinking/tool-calls, and tool results
 * to faithfully reconstruct the original session appearance in the ACP client.
 * Non-message entries (compactions, branch summaries, model changes, etc.) are
 * skipped.
 */
export async function replaySessionHistory(
  session: AgentSession,
  sessionId: string,
  connection: AgentSideConnection,
): Promise<void> {
  // Walk active branch from leaf to root — getEntries() returns ALL
  // entries including abandoned branches, which would replay stale
  // messages from earlier /tree navigations.
  const entries = session.sessionManager.getBranch();
  const updates: Promise<void>[] = [];

  for (const entry of entries) {
    if (entry.type !== "message") continue;

    const message = entry.message;
    const role = message.role;

    if (role === "user") {
      const text = extractMessageText(message);
      if (!text) continue;
      updates.push(
        connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: SessionUpdateType.UserMessageChunk,
            content: { type: "text", text },
          },
        }),
      );
    } else if (role === "assistant") {
      replayAssistantMessage(message as any, sessionId, connection, updates);
    } else if (role === "toolResult") {
      replayToolResult(message as any, sessionId, connection, updates);
    }
  }

  await Promise.all(updates);
}

/** Emit thinking, tool-call, and text blocks from an assistant message. */
function replayAssistantMessage(
  message: any,
  sessionId: string,
  connection: AgentSideConnection,
  updates: Promise<void>[],
): void {
  const content = message.content;
  if (typeof content === "string") {
    if (content.length > 0) {
      updates.push(
        connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: SessionUpdateType.AgentMessageChunk,
            content: { type: "text", text: content },
          },
        }),
      );
    }
    return;
  }

  if (!Array.isArray(content)) return;

  for (const block of content as any[]) {
    if (!block || typeof block !== "object") continue;

    if (block.type === "thinking") {
      const thinking = block.thinking;
      if (typeof thinking === "string" && thinking.length > 0) {
        updates.push(
          connection.sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: SessionUpdateType.AgentThoughtChunk,
              content: { type: "text", text: thinking },
            },
          }),
        );
      }
    } else if (block.type === "toolCall") {
      const toolCallId = block.id;
      const toolName = block.name;
      const argsStr = safeStringify(block.arguments);
      if (typeof toolCallId === "string" && typeof toolName === "string") {
        updates.push(
          connection.sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: SessionUpdateType.ToolCall,
              toolCallId,
              title: toolName,
              status: "pending",
              content: [
                {
                  type: "content" as const,
                  content: { type: "text" as const, text: argsStr },
                },
              ],
            },
          }),
        );
      }
    } else if (block.type === "text") {
      const text = block.text;
      if (typeof text === "string" && text.length > 0) {
        updates.push(
          connection.sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: SessionUpdateType.AgentMessageChunk,
              content: { type: "text", text },
            },
          }),
        );
      }
    }
  }
}

/** Emit a tool_call_update for a completed tool result. */
function replayToolResult(
  message: any,
  sessionId: string,
  connection: AgentSideConnection,
  updates: Promise<void>[],
): void {
  const toolCallId = message.toolCallId;
  const isError = !!message.isError;
  if (typeof toolCallId !== "string") return;

  const resultText = extractTextFromToolResult(message.content);

  updates.push(
    connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: SessionUpdateType.ToolCallUpdate,
        toolCallId,
        status: isError ? "failed" : "completed",
        content: [
          {
            type: "content" as const,
            content: { type: "text" as const, text: resultText },
          },
        ],
      },
    }),
  );
}

/** Extract text from a tool result's content (string or content-block array). */
function extractTextFromToolResult(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return safeStringify(content);

  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object" && (block as Record<string, unknown>).type === "text") {
      const text = (block as Record<string, unknown>).text;
      if (typeof text === "string") parts.push(text);
    }
  }
  return parts.length > 0 ? parts.join("") : safeStringify(content);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, undefined, 2);
  } catch {
    return String(value);
  }
}
