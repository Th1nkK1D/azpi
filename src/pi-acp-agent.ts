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
import { convertPromptContent } from "./prompt-content";
import { buildModelConfigOption, buildModelState, buildThinkingLevelConfigOption } from "./config";
import { buildStartupMessage } from "./startup-message";
import { name as AGENT_NAME, version as AGENT_VERSION } from "../package.json";
import { findBuiltinCommand, parseSlashCommand, discoverCommands } from "./slash-commands";
import { SessionResolver, replaySessionHistory } from "./session";

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
  private sessionResolver = new SessionResolver();

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

    const anyModelSupportsImage = this.availableModels.some((m) => m.input.includes("image"));

    const response: acp.InitializeResponse = {
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: {
          audio: false,
          image: anyModelSupportsImage,
          embeddedContext: true,
        },
        sessionCapabilities: {
          close: {},
          list: {},
          resume: {},
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

    let session: AgentSession;
    let sessionId: string;

    if (this.options.sessionFactory) {
      const result = await this.options.sessionFactory(cwd);
      session = result.session;
      sessionId = session.sessionId;
    } else {
      const sessionManager = SessionManager.create(cwd);
      sessionId = sessionManager.getSessionId();

      const proxyTools = createAcpProxyTools({
        connection: this.connection,
        sessionId,
        capabilities: this.clientCapabilities,
        cwd,
      });

      const result = await createAgentSession({
        cwd,
        sessionManager,
        // Custom tools with the same name override built-ins;
        // the allowlist keeps all 4 tool slots regardless of which we override.
        tools: ["read", "bash", "edit", "write"],
        customTools: proxyTools,
        authStorage: this.authStorage,
        modelRegistry: this.modelRegistry,
        ...this.options.sessionOptions,
      });
      session = result.session;
    }

    if (!session.model && this.availableModels.length > 0) {
      await session.setModel(this.availableModels[0]!);
    }

    this.sessions.set(sessionId, session);

    if (session.sessionFile) {
      this.sessionResolver.registerSession(sessionId, session.sessionFile);
    }

    const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      this.onEvent(sessionId, event);
    });
    this.unsubscribers.set(sessionId, unsubscribe);

    const response: acp.NewSessionResponse = { sessionId };

    if (session.model) {
      response.models = buildModelState(this.availableModels, session.model);
    }

    response.configOptions = this.buildConfigOptions(session);

    this.discoverAndEmitCommands(sessionId).catch(() => {
      // Connection may be closing; ignore
    });

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

    const { text, images } = convertPromptContent(params.prompt, session.model);

    const matchCommand = parseSlashCommand(text);
    if (matchCommand) {
      const builtin = findBuiltinCommand(matchCommand.name);
      if (builtin) {
        const result = await builtin.execute(session, matchCommand.args);

        if (matchCommand.name === "reload") {
          this.discoverAndEmitCommands(params.sessionId).catch(() => {
            // Connection may be closing; ignore
          });
        }

        await this.connection.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            content: { text: result.text, type: "text" },
            sessionUpdate: "agent_message_chunk",
          },
        });

        return { stopReason: "end_turn" };
      }
    }

    const controller = new AbortController();
    this.abortControllers.set(params.sessionId, controller);

    const promptPromise = new Promise<acp.PromptResponse>((resolve) => {
      this.pendingPrompts.set(params.sessionId, { resolve });
    });

    session.prompt(text, images.length > 0 ? { images } : undefined).catch((_error: Error) => {
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
      await session.abort();
      this.pendingPrompts.delete(params.sessionId);
      pending.resolve({ stopReason: "cancelled" });
    }
  }

  async closeSession(params: acp.CloseSessionRequest): Promise<void> {
    await this.cleanupSession(params.sessionId);
  }

  async loadSession(params: acp.LoadSessionRequest): Promise<acp.LoadSessionResponse> {
    const cwd = params.cwd ?? process.cwd();
    const { sessionId } = params;

    const sessionPath = await this.sessionResolver.resolveSessionPath(cwd, sessionId);
    const isNewSession = !sessionPath;

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
          sessionManager: isNewSession
            ? SessionManager.create(cwd)
            : SessionManager.open(sessionPath!),
          tools: ["read", "bash", "edit", "write"],
          customTools: proxyTools,
          authStorage: this.authStorage,
          modelRegistry: this.modelRegistry,
          ...this.options.sessionOptions,
        });

    if (session.sessionFile) {
      this.sessionResolver.registerSession(sessionId, session.sessionFile);
    }

    this.sessions.set(sessionId, session);

    const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      this.onEvent(sessionId, event);
    });
    this.unsubscribers.set(sessionId, unsubscribe);

    if (!isNewSession) {
      await replaySessionHistory(session, sessionId, this.connection);
    }

    const response: acp.LoadSessionResponse = {};
    if (session.model) {
      response.models = buildModelState(this.availableModels, session.model);
    }
    response.configOptions = this.buildConfigOptions(session);

    this.discoverAndEmitCommands(sessionId).catch(() => {
      // Connection may be closing; ignore
    });

    return response;
  }

  async unstable_resumeSession(
    params: acp.ResumeSessionRequest,
  ): Promise<acp.ResumeSessionResponse> {
    const cwd = process.cwd();
    const { sessionId } = params;

    const sessionPath = await this.sessionResolver.resolveSessionPath(cwd, sessionId);
    const isNewSession = !sessionPath;

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
          sessionManager: isNewSession
            ? SessionManager.create(cwd)
            : SessionManager.open(sessionPath!),
          tools: ["read", "bash", "edit", "write"],
          customTools: proxyTools,
          authStorage: this.authStorage,
          modelRegistry: this.modelRegistry,
          ...this.options.sessionOptions,
        });

    if (session.sessionFile) {
      this.sessionResolver.registerSession(sessionId, session.sessionFile);
    }

    this.sessions.set(sessionId, session);

    const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      this.onEvent(sessionId, event);
    });
    this.unsubscribers.set(sessionId, unsubscribe);

    // Return without replaying history
    return {};
  }

  async unstable_listSessions(params: acp.ListSessionsRequest): Promise<acp.ListSessionsResponse> {
    const cwd = params.cwd ?? process.cwd();

    await this.sessionResolver.warmCache(cwd);

    const piSessions = await SessionManager.list(cwd);

    const sessions: acp.SessionInfo[] = piSessions.map((info) => ({
      sessionId: info.id,
      cwd: info.cwd,
      title: info.name || undefined,
      updatedAt: info.modified.toISOString(),
      _meta: {
        messageCount: info.messageCount,
      },
    }));

    return { sessions };
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
    const session = this.sessions.get(sessionId);
    const configOptions = session ? this.buildConfigOptions(session) : undefined;
    const notification = mapSessionEvent(event, sessionId, configOptions);
    if (notification) {
      this.connection.sessionUpdate(notification).catch(() => {
        // Connection may be closing; ignore
      });
    }

    if (event.type === "agent_end") {
      const lastMessage = event.messages[event.messages.length - 1];
      const stopReason = mapStopReason(lastMessage);

      const pending = this.pendingPrompts.get(sessionId);
      if (pending) {
        this.pendingPrompts.delete(sessionId);
        pending.resolve({ stopReason });
      }

      this.connection
        .sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "session_info_update",
            updatedAt: new Date().toISOString(),
          },
        })
        .catch(() => {});
    }
  }

  private async discoverAndEmitCommands(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const availableCommands: acp.AvailableCommand[] = discoverCommands(session).map((cmd) => {
      const acpCmd: acp.AvailableCommand = {
        name: cmd.name,
        description: cmd.description,
      };

      if (cmd.acceptsArgs) {
        acpCmd.input = { hint: "Arguments for the command" };
      }
      return acpCmd;
    });

    const notification: acp.SessionNotification = {
      sessionId,
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands,
      },
    };

    await this.connection.sessionUpdate(notification);
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

    this.sessionResolver.unregisterSession(sessionId);

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
