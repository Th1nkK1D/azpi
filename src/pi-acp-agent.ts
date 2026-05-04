import * as acp from "@agentclientprotocol/sdk";
import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  createAgentSession,
} from "@mariozechner/pi-coding-agent";
import type {
  AgentSession,
  AgentSessionEvent,
  CreateAgentSessionOptions,
} from "@mariozechner/pi-coding-agent";
import type { Model } from "@mariozechner/pi-ai";
import { createAcpProxyTools } from "./client-tool-proxy";
import { mapSessionEvent, mapStopReason } from "./event-bridge";
import { buildModelConfigOption, buildModelState, buildThinkingLevelConfigOption } from "./config";
import { buildStartupMessage } from "./startup";
import { name as AGENT_NAME, version as AGENT_VERSION } from "../package.json";

export interface PiAcpAgentOptions {
  /** Optional createAgentSession overrides (model, tools, etc.) */
  sessionOptions?: Omit<CreateAgentSessionOptions, "cwd" | "sessionManager">;
  /** Optional auth storage (defaults to Pi's default path) */
  authStorage?: AuthStorage;
  /** Optional model registry (defaults to Pi's default path) */
  modelRegistry?: ModelRegistry;
  /** Optional session factory for testing */
  sessionFactory?: (cwd: string) => Promise<{ session: AgentSession }>;
}

/**
 * Core class implementing acp.Agent, managing Pi session lifecycle
 * and bridging Pi events to ACP notifications.
 */
export class PiAcpAgent implements acp.Agent {
  private sessions = new Map<string, AgentSession>();
  private unsubscribers = new Map<string, () => void>();
  private pendingPrompts = new Map<string, { resolve: (r: acp.PromptResponse) => void }>();
  private abortControllers = new Map<string, AbortController>();

  readonly options: PiAcpAgentOptions;
  readonly connection: acp.AgentSideConnection;
  readonly authStorage: AuthStorage;
  readonly modelRegistry: ModelRegistry;
  private clientCapabilities?: acp.ClientCapabilities;

  readonly availableModels: Model<any>[];

  constructor(connection: acp.AgentSideConnection, options?: PiAcpAgentOptions) {
    this.connection = connection;
    this.options = options ?? {};
    this.authStorage = options?.authStorage ?? AuthStorage.create();
    this.modelRegistry = options?.modelRegistry ?? ModelRegistry.create(this.authStorage);
    this.availableModels = this.modelRegistry.getAvailable();
  }

  async initialize(params: acp.InitializeRequest): Promise<acp.InitializeResponse> {
    this.clientCapabilities = params.clientCapabilities;

    const response: acp.InitializeResponse = {
      agentCapabilities: {
        // MVP: no session load/resume, no auth
        loadSession: false,
        promptCapabilities: {
          audio: false,
          image: false,
        },
        sessionCapabilities: {
          close: {},
        },
      },
      agentInfo: {
        name: AGENT_NAME,
        version: AGENT_VERSION,
      },
      protocolVersion: acp.PROTOCOL_VERSION,
    };

    return response;
  }

  private buildConfigOptions(session: AgentSession): acp.SessionConfigOption[] {
    return [
      buildModelConfigOption(session, this.availableModels),
      buildThinkingLevelConfigOption(session),
    ];
  }

  private async sendConfigOptionsUpdate(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const notification: acp.SessionNotification = {
      sessionId,
      update: {
        sessionUpdate: "config_option_update",
        configOptions: this.buildConfigOptions(session),
      },
    };

    await this.connection.sessionUpdate(notification);
  }

  async newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    const cwd = params.cwd ?? process.cwd();
    const sessionId = crypto.randomUUID();

    // Build proxy tools for ACP client capabilities the client advertised
    const proxyTools = createAcpProxyTools({
      connection: this.connection,
      sessionId,
      capabilities: this.clientCapabilities,
      cwd,
    });

    const { session } = this.options.sessionFactory
      ? await this.options.sessionFactory(cwd)
      : await createAgentSession({
          cwd,
          sessionManager: SessionManager.inMemory(),
          // Custom tools with the same name override built-ins;
          // the allowlist keeps all 4 tool slots regardless of which we override.
          tools: ["read", "bash", "edit", "write"],
          customTools: proxyTools,
          authStorage: this.authStorage,
          modelRegistry: this.modelRegistry,
          ...this.options.sessionOptions,
        });

    // Ensure a model is selected for ACP UI
    if (!session.model && this.availableModels.length > 0) {
      await session.setModel(this.availableModels[0]!);
    }

    this.sessions.set(sessionId, session);

    // Subscribe to Pi events and forward them as ACP notifications
    const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      this.onEvent(sessionId, event);
    });
    this.unsubscribers.set(sessionId, unsubscribe);

    const response: acp.NewSessionResponse = { sessionId };

    if (session.model) {
      response.models = buildModelState(this.availableModels, session.model);
    }

    response.configOptions = this.buildConfigOptions(session);

    // Send startup message (fire-and-forget; not awaited)
    const message = buildStartupMessage(session);
    this.connection
      .sessionUpdate({
        sessionId,
        update: {
          content: { text: message, type: "text" },
          sessionUpdate: "agent_message_chunk",
        },
      })
      .catch(() => {
        // Connection may be closing; ignore
      });

    return response;
  }

  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw acp.RequestError.invalidParams(`Unknown session: ${params.sessionId}`);
    }

    // Build prompt text from ACP ContentBlocks
    const text = extractPromptText(params.prompt);

    // Create an abort controller for this prompt turn
    const controller = new AbortController();
    this.abortControllers.set(params.sessionId, controller);

    // Create a promise that will be resolved when agent_end fires or abort is called
    const promptPromise = new Promise<acp.PromptResponse>((resolve) => {
      this.pendingPrompts.set(params.sessionId, { resolve });
    });

    // Start the Pi prompt (fire-and-forget; resolution comes via agent_end event)
    session.prompt(text).catch((_error: Error) => {
      // If prompt() itself throws (e.g. no model), resolve immediately
      const existing = this.pendingPrompts.get(params.sessionId);
      if (existing) {
        existing.resolve({ stopReason: "end_turn" });
      }
    });

    const result = await promptPromise;
    this.abortControllers.delete(params.sessionId);
    return result;
  }

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

  async closeSession(params: acp.CloseSessionRequest): Promise<void> {
    await this.cleanupSession(params.sessionId);
  }

  async authenticate(_params: acp.AuthenticateRequest): Promise<void> {
    // No auth in MVP
  }

  async unstable_setSessionModel(
    params: acp.SetSessionModelRequest,
  ): Promise<acp.SetSessionModelResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw acp.RequestError.invalidParams(`Unknown session: ${params.sessionId}`);
    }

    const parts = params.modelId.split("/", 2);
    if (parts.length !== 2) {
      throw acp.RequestError.invalidParams(`Invalid modelId: ${params.modelId}`);
    }

    const provider = parts[0]!;
    const modelId = parts[1]!;
    const model = this.modelRegistry.find(provider, modelId);
    if (!model) {
      throw acp.RequestError.invalidParams(`Unknown model: ${params.modelId}`);
    }

    await session.setModel(model);
    await this.sendConfigOptionsUpdate(params.sessionId);

    return {};
  }

  async setSessionConfigOption(
    params: acp.SetSessionConfigOptionRequest,
  ): Promise<acp.SetSessionConfigOptionResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw acp.RequestError.invalidParams(`Unknown session: ${params.sessionId}`);
    }

    if (params.configId === "model") {
      const modelId = params.value as string;
      const parts = modelId.split("/", 2);
      if (parts.length !== 2) {
        throw acp.RequestError.invalidParams(`Invalid modelId: ${modelId}`);
      }
      const provider = parts[0]!;
      const id = parts[1]!;
      const model = this.modelRegistry.find(provider, id);
      if (!model) {
        throw acp.RequestError.invalidParams(`Unknown model: ${modelId}`);
      }
      await session.setModel(model);
    } else if (params.configId === "thinking-level") {
      session.setThinkingLevel(params.value as AgentSession["thinkingLevel"]);
    } else {
      throw acp.RequestError.invalidParams(`Unknown config option: ${params.configId}`);
    }

    return {
      configOptions: this.buildConfigOptions(session),
    };
  }

  private onEvent(sessionId: string, event: AgentSessionEvent): void {
    if (event.type === "thinking_level_changed") {
      this.sendConfigOptionsUpdate(sessionId).catch(() => {
        // Connection may be closing; ignore
      });
      return;
    }

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

      const pending = this.pendingPrompts.get(sessionId);
      if (pending) {
        this.pendingPrompts.delete(sessionId);
        pending.resolve({ stopReason });
      }
    }
  }

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

  async close(): Promise<void> {
    const sessionIds = [...this.sessions.keys()];
    for (const id of sessionIds) {
      this.cleanupSession(id);
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
