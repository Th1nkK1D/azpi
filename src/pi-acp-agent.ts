import { PROTOCOL_VERSION, RequestError } from "@agentclientprotocol/sdk";
import type {
  Agent,
  AgentSideConnection,
  AuthenticateRequest,
  CancelNotification,
  ClientCapabilities,
  CloseSessionRequest,
  InitializeRequest,
  InitializeResponse,
  ListSessionsRequest,
  ListSessionsResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  ResumeSessionRequest,
  ResumeSessionResponse,
  SessionConfigOption,
  SessionInfo,
  SessionNotification,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
  SetSessionModelRequest,
  SetSessionModelResponse,
} from "@agentclientprotocol/sdk";
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
import { convertPromptContent, deriveSessionName } from "./prompt-content";
import {
  buildModelConfigOption,
  buildModelState,
  buildThinkingLevelConfigOption,
  resolveModelById,
} from "./model";
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
export class PiAcpAgent implements Agent {
  private sessions = new Map<string, AgentSession>();
  private unsubscribers = new Map<string, () => void>();
  private pendingPrompts = new Map<string, { resolve: (r: PromptResponse) => void }>();
  private abortControllers = new Map<string, AbortController>();
  private sessionResolver = new SessionResolver();

  readonly options: PiAcpAgentOptions;
  readonly connection: AgentSideConnection;
  readonly authStorage: AuthStorage;
  readonly modelRegistry: ModelRegistry;
  private clientCapabilities?: ClientCapabilities;

  readonly availableModels: Model<any>[];

  constructor(connection: AgentSideConnection, options?: PiAcpAgentOptions) {
    this.connection = connection;
    this.options = options ?? {};
    this.authStorage = options?.authStorage ?? AuthStorage.create();
    this.modelRegistry = options?.modelRegistry ?? ModelRegistry.create(this.authStorage);
    this.availableModels = this.modelRegistry.getAvailable();
  }

  async initialize({ clientCapabilities }: InitializeRequest): Promise<InitializeResponse> {
    this.clientCapabilities = clientCapabilities;

    const anyModelSupportsImage = this.availableModels.some((m) => m.input.includes("image"));

    const response: InitializeResponse = {
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
      protocolVersion: PROTOCOL_VERSION,
    };

    return response;
  }

  async authenticate(_params: AuthenticateRequest): Promise<void> {
    // Not support interactive auth, use API Keys instead
  }

  async newSession({ cwd }: NewSessionRequest): Promise<NewSessionResponse> {
    const { session, sessionId } = await this.createAndRegisterSession({
      cwd: cwd ?? process.cwd(),
    });

    if (!session.model && this.availableModels.length > 0) {
      await session.setModel(this.availableModels[0]!);
    }

    this.safeNotify(() => this.discoverAndEmitCommands(sessionId));

    this.safeNotify(() =>
      this.connection.sessionUpdate({
        sessionId,
        update: {
          content: { text: buildStartupMessage(session), type: "text" },
          sessionUpdate: "agent_message_chunk",
        },
      }),
    );

    return {
      sessionId,
      models: session.model ? buildModelState(this.availableModels, session.model) : undefined,
      configOptions: this.buildConfigOptions(session),
    };
  }

  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    const cwd = params.cwd ?? process.cwd();
    const { sessionId } = params;

    const sessionPath = await this.sessionResolver.resolveSessionPath(cwd, sessionId);

    const { session } = await this.createAndRegisterSession({ cwd, sessionId, sessionPath });

    if (sessionPath) {
      await replaySessionHistory(session, sessionId, this.connection);
    }

    this.safeNotify(() => this.discoverAndEmitCommands(sessionId));

    return {
      models: session.model ? buildModelState(this.availableModels, session.model) : undefined,
      configOptions: this.buildConfigOptions(session),
    };
  }

  async unstable_resumeSession({
    sessionId,
  }: ResumeSessionRequest): Promise<ResumeSessionResponse> {
    const cwd = process.cwd();
    const sessionPath = await this.sessionResolver.resolveSessionPath(cwd, sessionId);

    await this.createAndRegisterSession({ cwd, sessionId, sessionPath });

    // Return without replaying history
    return {};
  }

  async unstable_listSessions(params: ListSessionsRequest): Promise<ListSessionsResponse> {
    const cwd = params.cwd ?? process.cwd();

    await this.sessionResolver.warmCache(cwd);

    const sessions: SessionInfo[] = (await SessionManager.list(cwd)).map((info) => ({
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

  async unstable_setSessionModel({
    sessionId,
    modelId,
  }: SetSessionModelRequest): Promise<SetSessionModelResponse> {
    const session = this.getSessionOrThrow(sessionId);
    const model = resolveModelById(this.modelRegistry, modelId);
    await session.setModel(model);
    await this.sendConfigOptionsUpdate(sessionId);

    return {};
  }

  async setSessionConfigOption({
    sessionId,
    configId,
    value,
  }: SetSessionConfigOptionRequest): Promise<SetSessionConfigOptionResponse> {
    const session = this.getSessionOrThrow(sessionId);

    if (configId === "model") {
      const model = resolveModelById(this.modelRegistry, value as string);
      await session.setModel(model);
    } else if (configId === "thinking-level") {
      session.setThinkingLevel(value as AgentSession["thinkingLevel"]);
    } else {
      throw RequestError.invalidParams(`Unknown config option: ${configId}`);
    }

    return {
      configOptions: this.buildConfigOptions(session),
    };
  }

  async prompt({ sessionId, prompt }: PromptRequest): Promise<PromptResponse> {
    const session = this.getSessionOrThrow(sessionId);

    const { text, images } = convertPromptContent(prompt, session.model);

    const matchCommand = parseSlashCommand(text);
    if (matchCommand) {
      const builtin = findBuiltinCommand(matchCommand.name);
      if (builtin) {
        const result = await builtin.execute(session, matchCommand.args);

        if (matchCommand.name === "reload") {
          this.safeNotify(() => this.discoverAndEmitCommands(sessionId));
        }

        await this.connection.sessionUpdate({
          sessionId,
          update: {
            content: { text: result.text, type: "text" },
            sessionUpdate: "agent_message_chunk",
          },
        });

        return { stopReason: "end_turn" };
      }
    }

    if (!session.sessionName && !matchCommand) {
      const name = deriveSessionName(prompt);
      if (name) {
        session.setSessionName(name);
      }
    }

    const controller = new AbortController();
    this.abortControllers.set(sessionId, controller);

    const promptPromise = new Promise<PromptResponse>((resolve) => {
      this.pendingPrompts.set(sessionId, { resolve });
    });

    session.prompt(text, images.length > 0 ? { images } : undefined).catch((_error: Error) => {
      const existing = this.pendingPrompts.get(sessionId);
      if (existing) {
        existing.resolve({ stopReason: "end_turn" });
      }
    });

    const result = await promptPromise;
    this.abortControllers.delete(sessionId);
    return result;
  }

  async cancel({ sessionId }: CancelNotification): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    const pending = this.pendingPrompts.get(sessionId);
    if (pending) {
      await session.abort();
      this.pendingPrompts.delete(sessionId);
      pending.resolve({ stopReason: "cancelled" });
    }
  }

  async closeSession({ sessionId }: CloseSessionRequest): Promise<void> {
    await this.cleanupSession(sessionId);
  }

  async close(): Promise<void> {
    const sessionIds = [...this.sessions.keys()];
    for (const id of sessionIds) {
      this.cleanupSession(id);
    }
  }

  private buildConfigOptions(session: AgentSession): SessionConfigOption[] {
    return [
      buildModelConfigOption(session, this.availableModels),
      buildThinkingLevelConfigOption(session),
    ];
  }

  private async sendConfigOptionsUpdate(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const notification: SessionNotification = {
      sessionId,
      update: {
        sessionUpdate: "config_option_update",
        configOptions: this.buildConfigOptions(session),
      },
    };

    await this.connection.sessionUpdate(notification);
  }

  private async createAndRegisterSession({
    cwd,
    sessionId,
    sessionPath,
  }: {
    cwd: string;
    sessionId?: string;
    sessionPath?: string;
  }): Promise<{ session: AgentSession; sessionId: string }> {
    if (this.options.sessionFactory) {
      const result = await this.options.sessionFactory(cwd);
      const session = result.session;
      const resolvedSessionId = session.sessionId;
      this.registerSession(resolvedSessionId, session);
      return { session, sessionId: resolvedSessionId };
    }

    const sessionManager = sessionPath
      ? SessionManager.open(sessionPath)
      : SessionManager.create(cwd);

    const resolvedSessionId = sessionId ?? sessionManager.getSessionId();

    const { session } = await createAgentSession({
      cwd,
      sessionManager,
      tools: ["read", "bash", "edit", "write"],
      customTools: createAcpProxyTools({
        connection: this.connection,
        sessionId: resolvedSessionId,
        capabilities: this.clientCapabilities,
        cwd,
      }),
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      ...this.options.sessionOptions,
    });

    this.registerSession(resolvedSessionId, session);

    return { session, sessionId: resolvedSessionId };
  }

  private registerSession(sessionId: string, session: AgentSession): void {
    this.sessions.set(sessionId, session);
    if (session.sessionFile) {
      this.sessionResolver.registerSession(sessionId, session.sessionFile);
    }
    const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      this.onEvent(sessionId, event);
    });
    this.unsubscribers.set(sessionId, unsubscribe);
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

  private getSessionOrThrow(sessionId: string): AgentSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw RequestError.invalidParams(`Unknown session: ${sessionId}`);
    }
    return session;
  }

  private onEvent(sessionId: string, event: AgentSessionEvent): void {
    const session = this.sessions.get(sessionId);
    const configOptions = session ? this.buildConfigOptions(session) : undefined;
    const notification = mapSessionEvent(event, sessionId, configOptions);
    if (notification) {
      this.safeNotify(() => this.connection.sessionUpdate(notification));
    }

    if (event.type === "agent_end") {
      const lastMessage = event.messages[event.messages.length - 1];
      const stopReason = mapStopReason(lastMessage);

      const pending = this.pendingPrompts.get(sessionId);
      if (pending) {
        this.pendingPrompts.delete(sessionId);
        pending.resolve({ stopReason });
      }

      this.safeNotify(() =>
        this.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "session_info_update",
            updatedAt: new Date().toISOString(),
          },
        }),
      );
    }
  }

  private async discoverAndEmitCommands(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const notification: SessionNotification = {
      sessionId,
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: discoverCommands(session),
      },
    };

    await this.connection.sessionUpdate(notification);
  }

  private safeNotify(fn: () => Promise<void>): void {
    fn().catch(() => {
      // Connection may be closing; ignore
    });
  }
}
