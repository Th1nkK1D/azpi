import { SessionManager } from "@mariozechner/pi-coding-agent";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import type { AgentSideConnection } from "@agentclientprotocol/sdk";

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
 * MVP: Only replays user and assistant text messages. Tool calls, compactions,
 * and other entry types are skipped.
 */
export async function replaySessionHistory(
  session: AgentSession,
  sessionId: string,
  connection: AgentSideConnection,
): Promise<void> {
  const entries = session.sessionManager.getEntries();
  const updates: Promise<void>[] = [];

  for (const entry of entries) {
    if (entry.type !== "message") continue;

    const message = (entry as any).message;
    if (!message) continue;

    const role = message.role;
    if (role !== "user" && role !== "assistant") continue;

    const text = extractTextContent(message);
    if (!text) continue;

    if (role === "user") {
      updates.push(
        connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text },
          },
        }),
      );
    } else {
      updates.push(
        connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text },
          },
        }),
      );
    }
  }

  await Promise.all(updates);
}

function extractTextContent(message: any): string | undefined {
  if (typeof message.content === "string") return message.content;

  if (Array.isArray(message.content)) {
    const parts = message.content
      .filter((part: any) => part.type === "text")
      .map((part: any) => part.text)
      .join("");
    return parts || undefined;
  }

  return undefined;
}
