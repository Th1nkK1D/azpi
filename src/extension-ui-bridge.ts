import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import type { ExtensionUIContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";

const NOT_SUPPORTED_MSG =
  "Interactive dialogs are not supported in ACP mode. " +
  "Extension commands should use pi.sendMessage() for output instead.";

/** Passthrough theme — returns text as-is since ACP mode has no terminal for ANSI. */
const passthroughTheme = {
  name: "acp-passthrough",
  sourcePath: undefined,
  sourceInfo: undefined,
  fg(_color: ThemeColor, text: string): string {
    return text;
  },
  bg(_color: string, text: string): string {
    return text;
  },
  bold(text: string): string {
    return text;
  },
  italic(text: string): string {
    return text;
  },
  underline(text: string): string {
    return text;
  },
  inverse(text: string): string {
    return text;
  },
  strikethrough(text: string): string {
    return text;
  },
  getFgAnsi(): string {
    return "";
  },
  getBgAnsi(): string {
    return "";
  },
  getColorMode(): "truecolor" {
    return "truecolor";
  },
  getThinkingBorderColor(): (str: string) => string {
    return (str: string) => str;
  },
  getBashModeBorderColor(): (str: string) => string {
    return (str: string) => str;
  },
};

/**
 * Creates an ExtensionUIContext that bridges `notify()` calls to ACP
 * sessionUpdate notifications, enabling extension commands like
 * `/compress-stats` to produce visible output in the ACP client.
 *
 * Interactive methods (confirm, select, input, editor) throw with a
 * descriptive error. Future support via ACP elicitation protocol
 * (elicitation/create) is tracked but not yet implemented since the
 * protocol is still an RFD.
 */
export function createAcpUiBridge(
  connection: AgentSideConnection,
  sessionId: string,
): ExtensionUIContext {
  return {
    notify(message: string, _type?: "info" | "warning" | "error"): void {
      connection
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
    },

    async select(): Promise<string | undefined> {
      throw new Error(NOT_SUPPORTED_MSG);
    },

    async confirm(): Promise<boolean> {
      throw new Error(NOT_SUPPORTED_MSG);
    },

    async input(): Promise<string | undefined> {
      throw new Error(NOT_SUPPORTED_MSG);
    },

    async editor(): Promise<string | undefined> {
      throw new Error(NOT_SUPPORTED_MSG);
    },

    // Non-interactive methods are no-ops in ACP mode
    async custom(): Promise<any> {
      throw new Error(NOT_SUPPORTED_MSG);
    },

    onTerminalInput(): () => void {
      return () => {};
    },

    setStatus(): void {},
    setWorkingMessage(): void {},
    setWorkingVisible(): void {},
    setWorkingIndicator(): void {},
    setHiddenThinkingLabel(): void {},
    setWidget(): void {},
    setFooter(): void {},
    setHeader(): void {},
    setTitle(): void {},
    setEditorText(): void {},
    getEditorText(): string {
      return "";
    },
    pasteToEditor(): void {},
    addAutocompleteProvider(): void {},
    setEditorComponent(): void {},
    getEditorComponent(): undefined {
      return undefined;
    },

    get theme(): Theme {
      return passthroughTheme as unknown as Theme;
    },
    getAllThemes(): { name: string; path: string | undefined }[] {
      return [];
    },
    getTheme(): undefined {
      return undefined;
    },
    setTheme(): { success: boolean; error?: string } {
      return { success: false, error: NOT_SUPPORTED_MSG };
    },
    getToolsExpanded(): boolean {
      return false;
    },
    setToolsExpanded(): void {},
  };
}
