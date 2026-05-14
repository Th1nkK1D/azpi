import type { AgentSession, ResolvedCommand } from "@earendil-works/pi-coding-agent";
import type { AvailableCommand } from "@agentclientprotocol/sdk";

const HINT_PLACEHOLDER = "Arguments for the command";
const ALLOW_ALL = "*";

interface SlashCommandMatch {
  name: string;
  args: string;
}

interface BuiltinCommand {
  name: string;
  description: string;
  argsHint?: string;
  execute(session: AgentSession, args: string): Promise<string>;
}

/**
 * Parse the AZPI_ALLOW_EXTENSION_COMMANDS environment variable.
 * Returns a Set of allowed extension command names, or null if all commands are allowed.
 *
 * Format: comma-separated command names, e.g. "deploy,pirate,compress-stats"
 * Wildcard "*" means allow all commands.
 * Empty or unset means allow none.
 */
export function parseExtensionWhitelist(): Set<string> | null {
  const raw = (process.env.AZPI_ALLOW_EXTENSION_COMMANDS ?? "").trim();

  if (!raw) {
    return new Set();
  }

  if (raw === ALLOW_ALL) {
    return null;
  }

  const names = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return new Set(names);
}

/**
 * Check whether an extension command is allowed by the whitelist.
 * @param commandName - The command name (without leading slash).
 * @param whitelist - Parsed whitelist from parseExtensionWhitelist().
 *                    null = allow all, empty Set = allow none.
 */
export function isExtensionCommandAllowed(
  commandName: string,
  whitelist: Set<string> | null,
): boolean {
  if (whitelist === null) {
    return true;
  }
  return whitelist.has(commandName);
}

/**
 * Discover all available slash commands as ACP AvailableCommand[] from:
 * - Built-in commands (our subset)
 * - Extension commands (via extension runner, filtered by whitelist)
 * - Skills loaded by the session (via resource loader)
 * - Prompt templates
 */
export function discoverCommands(session: AgentSession): AvailableCommand[] {
  const commands: AvailableCommand[] = [];

  for (const cmd of builtinCommands) {
    commands.push({
      name: cmd.name,
      description: cmd.description,
      ...(cmd.argsHint ? { input: { hint: cmd.argsHint } } : {}),
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
            input: { hint: HINT_PLACEHOLDER },
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
            input: { hint: HINT_PLACEHOLDER },
          });
        }
      }
    } catch {
      // Ignore errors during prompt template discovery
    }
  }

  const extensionRunner = session.extensionRunner;
  if (extensionRunner && typeof extensionRunner.getRegisteredCommands === "function") {
    try {
      const registeredCommands = extensionRunner.getRegisteredCommands();
      if (Array.isArray(registeredCommands)) {
        const whitelist = parseExtensionWhitelist();
        for (const cmd of registeredCommands) {
          if (!isExtensionCommandAllowed(cmd.name, whitelist)) {
            continue;
          }
          commands.push({
            name: cmd.invocationName,
            description: cmd.description || `Extension command: ${cmd.name}`,
            input: { hint: HINT_PLACEHOLDER },
          });
        }
      }
    } catch {
      // Ignore errors during extension command discovery
    }
  }

  return commands.toSorted((a, z) => a.name.localeCompare(z.name));
}

/**
 * Look up an extension command by its registered name (without suffix).
 * Returns the ResolvedCommand if found, or undefined.
 */
export function findExtensionCommand(
  session: AgentSession,
  name: string,
): ResolvedCommand | undefined {
  const extensionRunner = session.extensionRunner;
  if (!extensionRunner || typeof extensionRunner.getCommand !== "function") {
    return undefined;
  }
  try {
    return extensionRunner.getCommand(name);
  } catch {
    return undefined;
  }
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
    argsHint: "New session name (or empty to show current name)",
    execute: executeName,
  },
  {
    name: "session",
    description: "Show session information (file, ID, messages, tokens, cost)",
    execute: executeSession,
  },
  {
    name: "compact",
    description: "Manually compact the session context",
    argsHint: "Optional custom compaction instructions",
    execute: executeCompact,
  },
  {
    name: "export",
    description: "Export session to HTML file",
    argsHint: "Output file path (default: session.html)",
    execute: executeExport,
  },
  {
    name: "reload",
    description: "Reload extensions, skills, prompts, and context files",
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
async function executeName(session: AgentSession, args: string): Promise<string> {
  if (!args) {
    const currentName = session.sessionName;
    return currentName
      ? `Session name is: "${currentName}"`
      : "Session has no name. Usage: /name <name>";
  }

  session.setSessionName(args);
  return `Session name set to: "${args}"`;
}

/**
 * Execute the `/session` command.
 * Shows session statistics.
 */
async function executeSession(session: AgentSession): Promise<string> {
  const stats = session.getSessionStats();
  const lines: string[] = [];

  if (session.sessionName) lines.push(`- Name: ${session.sessionName}`);
  lines.push(`- ID: ${stats.sessionId}`);
  if (stats.sessionFile) lines.push(`- File: ${stats.sessionFile}`);
  if (stats.contextUsage) {
    const cu = stats.contextUsage;
    if (cu.percent !== null) {
      const tokens = cu.tokens?.toLocaleString() ?? "?";
      lines.push(
        `- Context: ${cu.percent.toFixed(1)}% (${tokens} / ${cu.contextWindow.toLocaleString()})`,
      );
    }
  }
  lines.push(
    `- Messages: ${stats.userMessages.toLocaleString()} user, ${stats.assistantMessages.toLocaleString()} assistant, ${stats.toolCalls.toLocaleString()} tool calls`,
  );
  lines.push(
    `- Tokens: ${stats.tokens.total.toLocaleString()} (${stats.tokens.input.toLocaleString()} input, ${stats.tokens.output.toLocaleString()} output, ${stats.tokens.cacheRead.toLocaleString()} cache-read, ${stats.tokens.cacheWrite.toLocaleString()} cache-write)`,
  );
  lines.push(`- Cost Estimation: $${stats.cost.toFixed(4)}`);

  return lines.join("\n");
}

/**
 * Execute the `/compact` command.
 * Triggers context compaction with optional custom instructions.
 */
async function executeCompact(session: AgentSession, args: string): Promise<string> {
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

  return lines.join("\n");
}

/**
 * Execute the `/export` command.
 * Exports the session to HTML. Default to session.html and dark theme.
 */
async function executeExport(session: AgentSession, args: string): Promise<string> {
  const outputPath = args || "session.html";
  const originalTheme = session.settingsManager.getTheme();
  session.settingsManager.setTheme("dark");
  try {
    const filePath = await session.exportToHtml(outputPath);
    return `Session exported to ${filePath}`;
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
async function executeReload(session: AgentSession): Promise<string> {
  await session.reload();
  return "Extensions, skills, prompts, and context files reloaded.";
}
