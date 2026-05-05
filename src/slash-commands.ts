import type { AgentSession } from "@mariozechner/pi-coding-agent";

/**
 * Parsed slash command result.
 */
interface SlashCommandMatch {
  /** Command name without leading slash (e.g. "name", "compact") */
  name: string;
  /** Arguments string after the command name (trimmed) */
  args: string;
}

/**
 * Result from executing a slash command.
 */
interface SlashCommandResult {
  /** Text output to show to the user */
  text: string;
}

/**
 * Built-in slash command handler.
 */
interface BuiltinCommand {
  /** Command name without leading slash */
  name: string;
  /** Human-readable description for ACP AvailableCommand */
  description: string;
  /** Whether the command accepts arguments */
  acceptsArgs: boolean;
  /** Execute the command against a session */
  execute(session: AgentSession, args: string): Promise<SlashCommandResult>;
}

/**
 * ACP AvailableCommand representation for a discovered slash command.
 */
interface AvailableCommandInfo {
  /** Command name without leading slash */
  name: string;
  /** Description shown to the user */
  description: string;
  /** Whether the command accepts arguments */
  acceptsArgs: boolean;
  /** Where this command came from */
  source: "builtin" | "skill" | "prompt";
}

/**
 * Discover all available slash commands from:
 * - Built-in commands (our subset)
 * - Skills loaded by the session (via resource loader)
 * - Prompt templates
 */
export function discoverCommands(session: AgentSession): AvailableCommandInfo[] {
  const commands: AvailableCommandInfo[] = [];

  for (const cmd of builtinCommands) {
    commands.push({
      name: cmd.name,
      description: cmd.description,
      acceptsArgs: cmd.acceptsArgs,
      source: "builtin",
    });
  }

  const resourceLoader = session.resourceLoader;

  if (resourceLoader && typeof resourceLoader.getSkills === "function") {
    try {
      const { skills } = resourceLoader.getSkills();
      if (Array.isArray(skills)) {
        for (const skill of skills) {
          commands.push({
            name: `skill:${skill.name}`,
            description: skill.description || `Skill: ${skill.name}`,
            acceptsArgs: true,
            source: "skill",
          });
        }
      }
    } catch {
      // Ignore errors during skill discovery
    }
  }

  if (resourceLoader && typeof resourceLoader.getPrompts === "function") {
    try {
      const { prompts } = resourceLoader.getPrompts();
      if (Array.isArray(prompts)) {
        for (const template of prompts) {
          // Prompt template commands are prefixed with ":" in Pi (e.g. /:template)
          commands.push({
            name: `:${template.name}`,
            description: template.description || `Prompt template: ${template.name}`,
            acceptsArgs: true,
            source: "prompt",
          });
        }
      }
    } catch {
      // Ignore errors during prompt template discovery
    }
  }

  return commands.toSorted((a, z) => a.name.localeCompare(z.name));
}

/**
 * Parse a prompt string for a leading slash command.
 * Returns null if the string doesn't start with `/command`.
 *
 * Handles: `/name`, `/name args`, `/name "quoted args"`
 */
export function parseSlashCommand(text: string): SlashCommandMatch | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const rest = trimmed.slice(1).trimStart();

  const spaceIdx = rest.indexOf(" ");
  const cmdName = spaceIdx === -1 ? rest.trim() : rest.slice(0, spaceIdx).trim();
  const args = spaceIdx === -1 ? "" : rest.slice(spaceIdx + 1).trim();

  if (!cmdName || cmdName.includes(" ")) {
    return null;
  }

  return { name: cmdName, args };
}

/**
 * All supported built-in slash commands.
 */
export const builtinCommands: ReadonlyArray<BuiltinCommand> = [
  {
    name: "name",
    description: "Set the session display name",
    acceptsArgs: true,
    execute: executeName,
  },
  {
    name: "session",
    description: "Show session information (file, ID, messages, tokens, cost)",
    acceptsArgs: false,
    execute: executeSession,
  },
  {
    name: "compact",
    description: "Manually compact the session context",
    acceptsArgs: true,
    execute: executeCompact,
  },
  {
    name: "export",
    description: "Export session to HTML file",
    acceptsArgs: true,
    execute: executeExport,
  },
  {
    name: "reload",
    description: "Reload extensions, skills, prompts, and context files",
    acceptsArgs: false,
    execute: executeReload,
  },
];

/**
 * Look up a built-in command by name.
 */
export function findBuiltinCommand(name: string): BuiltinCommand | undefined {
  return builtinCommands.find((c) => c.name === name);
}

/**
 * Execute the `/name` command.
 * Sets the session display name.
 */
async function executeName(session: AgentSession, args: string): Promise<SlashCommandResult> {
  if (!args) {
    const currentName = session.sessionName;
    return {
      text: currentName
        ? `Session name is: "${currentName}"`
        : "Session has no name. Usage: /name <name>",
    };
  }

  session.setSessionName(args);
  return { text: `Session name set to: "${args}"` };
}

/**
 * Execute the `/session` command.
 * Shows session statistics.
 */
async function executeSession(session: AgentSession): Promise<SlashCommandResult> {
  const stats = session.getSessionStats();

  const lines: string[] = [];
  if (stats.sessionFile) lines.push(`File: ${stats.sessionFile}`);
  lines.push(`Session ID: ${stats.sessionId}`);
  if (session.sessionName) lines.push(`Name: ${session.sessionName}`);
  lines.push(
    `Messages: ${stats.userMessages} user, ${stats.assistantMessages} assistant, ${stats.toolCalls} tool calls`,
  );
  lines.push(
    `Tokens: ${stats.tokens.total} (input: ${stats.tokens.input}, output: ${stats.tokens.output})`,
  );
  lines.push(`Cost: $${stats.cost.toFixed(4)}`);

  if (stats.contextUsage) {
    const cu = stats.contextUsage;
    if (cu.percent !== null) {
      const tokens = cu.tokens?.toLocaleString() ?? "?";
      lines.push(
        `Context: ${cu.percent.toFixed(1)}% (${tokens} / ${cu.contextWindow.toLocaleString()})`,
      );
    }
  }

  return { text: lines.join("\n") };
}

/**
 * Execute the `/compact` command.
 * Triggers context compaction with optional custom instructions.
 */
async function executeCompact(session: AgentSession, args: string): Promise<SlashCommandResult> {
  try {
    await session.abort();
  } catch {
    // Ignore abort errors
  }

  const customInstructions = args || undefined;
  const result = await session.compact(customInstructions);

  const lines: string[] = [];
  lines.push("Compaction completed.");
  if (result) {
    lines.push(`First kept entry: ${result.firstKeptEntryId}`);
    if (result.tokensBefore !== undefined) {
      lines.push(`Tokens before compaction: ${result.tokensBefore}`);
    }
  }

  return { text: lines.join("\n") };
}

/**
 * Execute the `/export` command.
 * Exports the session to HTML. Default to session.html and dark theme.
 */
async function executeExport(session: AgentSession, args: string): Promise<SlashCommandResult> {
  const outputPath = args || "session.html";
  const originalTheme = session.settingsManager.getTheme();
  session.settingsManager.setTheme("dark");
  try {
    const filePath = await session.exportToHtml(outputPath);
    return { text: `Session exported to ${filePath}` };
  } finally {
    if (originalTheme) {
      session.settingsManager.setTheme(originalTheme);
    }
  }
}

/**
 * Execute the `/reload` command.
 * Reloads extensions, skills, prompts, and context files.
 */
async function executeReload(session: AgentSession): Promise<SlashCommandResult> {
  await session.reload();
  return { text: "Extensions, skills, prompts, and context files reloaded." };
}
