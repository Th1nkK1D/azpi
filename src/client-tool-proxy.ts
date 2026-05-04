/* eslint-disable no-await-in-loop */
import * as acp from "@agentclientprotocol/sdk";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { defineTool } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { resolve as _resolve } from "path";

const readParams = Type.Object({
  path: Type.String({ description: "File path to read" }),
  offset: Type.Optional(Type.Number({ description: "Line number to start from (1-based)" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to return" })),
});

const writeParams = Type.Object({
  path: Type.String({ description: "File path to write" }),
  content: Type.String({ description: "Content to write" }),
});

const editParams = Type.Object({
  path: Type.String({ description: "File path to edit" }),
  edits: Type.Array(
    Type.Object({
      oldText: Type.String({ description: "Exact text to replace" }),
      newText: Type.String({ description: "Replacement text" }),
    }),
    { description: "Text replacements to apply" },
  ),
});

const bashParams = Type.Object({
  command: Type.String({ description: "Command to execute" }),
  timeout: Type.Optional(Type.Number({ description: "Timeout in milliseconds" })),
});

/** 1-based indexing for line numbers in Pi/ACP. */
const ONE_BASED_LINE_OFFSET = 1;

export interface AcpProxyToolOptions {
  /** The ACP agent-side connection */
  connection: acp.AgentSideConnection;
  /** Current session ID */
  sessionId: string;
  /** Client capabilities from initialize */
  capabilities: acp.ClientCapabilities | undefined;
  /** Working directory for resolving relative paths */
  cwd: string;
}

/**
 * Creates proxy ToolDefinitions for ACP client methods that the client
 * advertised capabilities for. Returns an empty array when no capabilities
 * are advertised (all native tools remain active).
 */
export function createAcpProxyTools(options: AcpProxyToolOptions): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  const { connection, sessionId, capabilities, cwd } = options;

  if (!capabilities) {
    return tools;
  }

  if (capabilities.fs?.readTextFile) {
    tools.push(createReadProxy(connection, sessionId, cwd));
  }

  if (capabilities.fs?.writeTextFile) {
    tools.push(createWriteProxy(connection, sessionId, cwd));
  }

  // The "edit" tool requires both read + write capabilities
  if (capabilities.fs?.readTextFile && capabilities.fs?.writeTextFile) {
    tools.push(createEditProxy(connection, sessionId, cwd));
  }

  if (capabilities.terminal) {
    tools.push(createBashProxy(connection, sessionId, cwd));
  }

  return tools;
}

/** Resolve a potentially-relative path against the cwd. */
function resolvePath(cwd: string, path: string): string {
  if (path.startsWith("/")) return path;
  return _resolve(cwd, path);
}

/** Apply offset/limit/truncation to raw file content, matching Pi's semantics. */
function applyOffsetLimit(content: string, offset?: number, limit?: number): string {
  const lines = content.split("\n");
  let resultLines = lines;

  if (offset && offset > ONE_BASED_LINE_OFFSET) {
    resultLines = resultLines.slice(offset - ONE_BASED_LINE_OFFSET);
  }

  if (limit !== undefined && limit >= 0) {
    resultLines = resultLines.slice(0, limit);
  }

  return resultLines.join("\n");
}

function createReadProxy(
  connection: acp.AgentSideConnection,
  sessionId: string,
  cwd: string,
): ToolDefinition {
  return defineTool({
    name: "read",
    label: "Read File",
    description: "Read the contents of a text file at the given path. Lines are 1-indexed.",
    parameters: readParams,
    execute: async (toolCallId, params) => {
      const absolutePath = resolvePath(cwd, params.path);

      // Read full file via ACP; we apply offset/limit locally for Pi-consistent semantics
      const response = await connection.readTextFile({
        sessionId,
        path: absolutePath,
      });

      const content = applyOffsetLimit(response.content, params.offset, params.limit);

      return {
        content: [{ type: "text" as const, text: content }],
        details: {},
      };
    },
  });
}

function createWriteProxy(
  connection: acp.AgentSideConnection,
  sessionId: string,
  cwd: string,
): ToolDefinition {
  return defineTool({
    name: "write",
    label: "Write File",
    description: "Write the contents to a text file at the given path.",
    parameters: writeParams,
    execute: async (_toolCallId, params) => {
      const absolutePath = resolvePath(cwd, params.path);

      await connection.writeTextFile({
        sessionId,
        path: absolutePath,
        content: params.content,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Successfully wrote ${params.content.length} bytes to ${absolutePath}`,
          },
        ],
        details: {},
      };
    },
  });
}

function createEditProxy(
  connection: acp.AgentSideConnection,
  sessionId: string,
  cwd: string,
): ToolDefinition {
  return defineTool({
    name: "edit",
    label: "Edit File",
    description: "Apply exact-text replacements to a file.",
    parameters: editParams,
    execute: async (_toolCallId, params) => {
      const absolutePath = resolvePath(cwd, params.path);

      const readResponse = await connection.readTextFile({
        sessionId,
        path: absolutePath,
      });
      let content = readResponse.content;

      for (const edit of params.edits) {
        const index = content.indexOf(edit.oldText);
        if (index === -1) {
          throw new Error(
            `Edit failed: could not find exact text to replace in ${absolutePath}. ` +
              `The text may have already been changed or the oldText is incorrect.`,
          );
        }
        content =
          content.slice(0, index) + edit.newText + content.slice(index + edit.oldText.length);
      }

      await connection.writeTextFile({
        sessionId,
        path: absolutePath,
        content,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Successfully applied ${params.edits.length} edit(s) to ${absolutePath}`,
          },
        ],
        details: {},
      };
    },
  });
}

function createBashProxy(
  connection: acp.AgentSideConnection,
  sessionId: string,
  cwd: string,
): ToolDefinition {
  return defineTool({
    name: "bash",
    label: "Bash",
    description: "Run a shell command. Returns output and exit code.",
    parameters: bashParams,
    execute: async (_toolCallId, params, signal, onUpdate) => {
      const terminal = await connection.createTerminal({
        sessionId,
        command: params.command,
        cwd,
      });

      try {
        const pollInterval = 250;
        let accumulated = "";
        const startTime = Date.now();

        while (true) {
          if (signal?.aborted) {
            await terminal.kill();
            await terminal.release();
            return {
              content: [{ type: "text" as const, text: accumulated || "Command cancelled" }],
              details: { cancelled: true, truncated: false },
            };
          }

          if (params.timeout && Date.now() - startTime > params.timeout) {
            await terminal.kill();

            const finalOutput = await terminal.currentOutput();
            await terminal.release();
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Command timed out after ${params.timeout}ms.
${finalOutput.output}`,
                },
              ],
              details: { exitCode: null, timedOut: true, truncated: finalOutput.truncated },
            };
          }

          const output = await terminal.currentOutput();
          if (output.output !== accumulated) {
            accumulated = output.output;

            onUpdate?.({
              content: [{ type: "text" as const, text: accumulated }],
              details: { truncated: output.truncated },
            });
          }

          if (output.exitStatus) {
            const exitCode = output.exitStatus.exitCode ?? -1;

            await terminal.release();

            return {
              content: [{ type: "text" as const, text: accumulated }],
              details: {
                exitCode,
                truncated: output.truncated,
              },
            };
          }

          await sleep(pollInterval, signal);
        }
      } catch (err) {
        try {
          await terminal.release();
        } catch {
          /* ignore */
        }
        throw err;
      }
    },
  });
}

/** Sleep for ms, aborting early if the signal fires. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
