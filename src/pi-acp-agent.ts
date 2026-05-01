/**
 * Pi-acp-agent.ts — Core class implementing acp.Agent, managing Pi session lifecycle
 * and bridging Pi events to ACP notifications.
 */
import * as acp from "@agentclientprotocol/sdk";
import { SessionManager, createAgentSession } from "@mariozechner/pi-coding-agent";
import type {
  AgentSession,
  AgentSessionEvent,
  CreateAgentSessionOptions,
} from "@mariozechner/pi-coding-agent";
import { mapFinalContent, mapSessionEvent, mapStopReason } from "./event-bridge";

const AGENT_NAME = "pi";
const AGENT_VERSION = "0.1.0";

export interface PiAcpAgentOptions {
  /** Optional createAgentSession overrides (model, tools, etc.) */
  sessionOptions?: Omit<CreateAgentSessionOptions, "cwd" | "sessionManager">;
}

export class PiAcpAgent implements acp.Agent {
  private sessions = new Map<string, AgentSession>();
  private unsubscribers = new Map<string, () => void>();
  private pendingPrompts = new Map<string, { resolve: (r: acp.PromptResponse) => void }>();
  private abortControllers = new Map<string, AbortController>();

  readonly sessionOptions: PiAcpAgentOptions;
  readonly connection: acp.AgentSideConnection;

  constructor(connection: acp.AgentSideConnection, options?: PiAcpAgentOptions) {
    this.connection = connection;
    this.sessionOptions = options ?? {};
  }

  // ─── initialize ────────────────────────────────────────────────

  async initialize(_params: acp.InitializeRequest): Promise<acp.InitializeResponse> {
    return {
      agentInfo: {
        name: AGENT_NAME,
        version: AGENT_VERSION,
      },
      capabilities: {
        // MVP: no session load/resume, no auth
        loadSession: false,
        promptCapabilities: {
          audio: false,
          image: false,
        },
        sessionCapabilities: {
          close: true,
        },
      },
      protocolVersion: acp.PROTOCOL_VERSION,
    };
  }

  // ─── newSession ────────────────────────────────────────────────

  async newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    const cwd = params.cwd ?? process.cwd();
    const sessionId = crypto.randomUUID();

    const { session } = await createAgentSession({
      cwd,
      sessionManager: SessionManager.inMemory(),
      ...this.sessionOptions,
    });

    this.sessions.set(sessionId, session);

    // Subscribe to Pi events and forward them as ACP notifications
    const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      this.onEvent(sessionId, event);
    });
    this.unsubscribers.set(sessionId, unsubscribe);

    return { sessionId };
  }

  // ─── prompt ────────────────────────────────────────────────────

  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw acp.RequestError.invalidParams(`Unknown session: ${params.sessionId}`);
    }

    // Build prompt text from ACP ContentBlocks
    const text = extractPromptText(params.content);

    // Create an abort controller for this prompt turn
    const controller = new AbortController();
    this.abortControllers.set(params.sessionId, controller);

    // Create a promise that will be resolved when agent_end fires or abort is called
    const promptPromise = new Promise<acp.PromptResponse>((resolve) => {
      this.pendingPrompts.set(params.sessionId, { resolve });
    });

    // Start the Pi prompt (fire-and-forget; resolution comes via agent_end event)
    session.prompt(text).catch((error: Error) => {
      // If prompt() itself throws (e.g. no model), resolve immediately
      const existing = this.pendingPrompts.get(params.sessionId);
      if (existing) {
        existing.resolve({ stopReason: "error" });
      }
    });

    const result = await promptPromise;
    this.abortControllers.delete(params.sessionId);
    return result;
  }

  // ─── cancel ────────────────────────────────────────────────────

  async cancel(params: acp.CancelNotification): Promise<void> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      return;
    }

    const pending = this.pendingPrompts.get(params.sessionId);
    if (pending) {
      // Abort the session — this will trigger agent_end with stopReason: "aborted"
      await session.abort();
      // The event handler should have already resolved the promise, but just in case:
      this.pendingPrompts.delete(params.sessionId);
      pending.resolve({ stopReason: "cancelled" });
    }
  }

  // ─── closeSession ──────────────────────────────────────────────

  async closeSession(params: acp.CloseSessionRequest): Promise<void> {
    await this.cleanupSession(params.sessionId);
  }

  // ─── authenticate (stub) ───────────────────────────────────────

  async authenticate(_params: acp.AuthenticateRequest): Promise<void> {
    // No auth in MVP
  }

  // ─── Internal event handler ────────────────────────────────────

  private onEvent(sessionId: string, event: AgentSessionEvent): void {
    // Forward to ACP client as session update
    const notification = mapSessionEvent(event, sessionId);
    if (notification) {
      this.connection.sessionUpdate(notification).catch(() => {
        // Connection may be closing; ignore
      });
    }

    // Handle agent_end: resolve the pending prompt promise
    if (event.type === "agent_end") {
      const lastMessage = event.messages[event.messages.length - 1];
      const stopReason = mapStopReason(lastMessage);
      const content = mapFinalContent(lastMessage);

      const pending = this.pendingPrompts.get(sessionId);
      if (pending) {
        this.pendingPrompts.delete(sessionId);
        pending.resolve({ content, stopReason });
      }
    }
  }

  // ─── Cleanup ───────────────────────────────────────────────────

  private async cleanupSession(sessionId: string): Promise<void> {
    const unsubscribe = this.unsubscribers.get(sessionId);
    if (unsubscribe) {
      unsubscribe();
      this.unsubscribers.delete(sessionId);
    }

    const session = this.sessions.get(sessionId);
    if (session) {
      try {
        await session.abort();
      } catch {
        // Ignore errors during cleanup
      }
      session.dispose();
      this.sessions.delete(sessionId);
    }

    // Resolve any pending prompt as cancelled
    const pending = this.pendingPrompts.get(sessionId);
    if (pending) {
      this.pendingPrompts.delete(sessionId);
      pending.resolve({ stopReason: "cancelled" });
    }

    this.abortControllers.delete(sessionId);
  }

  // ─── Public cleanup method ─────────────────────────────────────

  async close(): Promise<void> {
    const sessionIds = [...this.sessions.keys()];
    for (const id of sessionIds) {
      await this.cleanupSession(id);
    }
  }
}

/**
 * Extracts a plain text prompt from ACP ContentBlock[].
 * Text blocks are concatenated. Other block types are included as markdown.
 */
function extractPromptText(content: acp.ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of content) {
    switch (block.type) {
      case "text": {
        parts.push(block.text);
        break;
      }
      case "image": {
        parts.push(`[Image: ${block.mimeType}]`);
        break;
      }
      case "audio": {
        parts.push(`[Audio: ${block.mimeType}]`);
        break;
      }
      case "resource_link": {
        parts.push(`[Resource: ${block.uri}]`);
        break;
      }
      case "resource": {
        const res = block.resource;
        if ("text" in res && typeof res.text === "string") {
          parts.push(`\`\`\`\n${res.text}\n\`\`\``);
        } else {
          parts.push(`[Binary resource: ${res.uri}]`);
        }
        break;
      }
    }
  }
  return parts.join("\n");
}
