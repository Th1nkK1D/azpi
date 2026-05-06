# azpi

A seamless ACP client built on top of the Pi coding agent.

## Why?

The [Agent Client Protocol (ACP)](https://agentclientprotocol.com) standardizes communication between code editors/IDEs and coding agents. It breaks vendor lock-in, allowing both sides to innovate independently while giving developers the freedom to choose the best tools for their workflow—like me, as a fan of [Zed](https://zed.dev) and [Pi](https://pi.dev).

Pi does not support ACP out of the box. While there are a few ACP adapters that communicate with Pi via [RPC mode](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md) (such as [svkozak/pi-acp](https://github.com/svkozak/pi-acp), my main inspiration), that approach decouples the adapter from Pi to allow shared use of the same executable. However, this often results in ACP features being limited by Pi's RPC constraints.

**azpi** takes a different approach by using [Pi's JavaScript SDK](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md). This allows us to maximize Pi's functionality and support a broader range of ACP specifications, trading off the requirement of bundling the Pi coding agent within the package.

## Features

- **Pi interoperability** — Shares settings, API keys, sessions, extensions, and user prompts with the Pi coding agent.
- **Model & thinking selection** — Exposed as ACP configuration options and synced bidirectionally.
- **Startup message** — Displays Pi version, loaded contexts, extensions, and skills upon launch.
- **Rich content** — Handles `text`, `image`, `resource`, and `resource_link` content blocks.
- **Real-time event streaming** — Bridges text, thinking, tool execution, and session info changes directly to ACP.
- **Auto session naming** — Automatically derives session names from the initial prompt.
- **Client tool proxy** — Delegates `read`, `write`, `edit`, and `bash` to the ACP client when available, enabling editors like Zed to display agent change diffs.
- **Slash commands** — Supports Pi's built-in commands (`/name`, `/session`, `/compact`, `/export`, and `/reload`), skills, and prompt templates.

## Usage

The package is not yet pre-built or published. You can clone the repository and build the project using [Bun](https://bun.com/):

```bash
git clone https://github.com/Th1nkK1D/azpi.git
cd azpi
bun i --frozen-lockfile --production --ignore-scripts
bun run build
```

The binary will be available at `dist/azpi`. Here is an example configuration for Zed:

```jsonc
"agent_servers": {
  "azpi": {
    "type": "custom",
    "command": "<path-to-repository>/dist/azpi",
    "env": {
      // Set to "true" to handle package installation via CLI
      // rather than automatically through the SDK
      "PI_OFFLINE": "true"
    }
  }
}
```

If you haven't set up the Pi coding agent before, please refer to the [Pi configuration guide](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) or at least configure your [API keys](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/providers.md#api-keys) to enable LLM access.

## Limitations / Future Improvements

- No interactive provider authentication via the `/login` command; uses [API Keys](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/providers.md#api-keys) instead.
- [MCP](https://agentclientprotocol.com/protocol/session-setup#mcp-servers) and [agent plans](https://agentclientprotocol.com/protocol/agent-plan) conflict with Pi's [philosophy](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent#philosophy) and are unlikely to be implemented.
- Currently does not support Pi's `/tree` and `/fork` commands.
- Slash commands from Pi's [extensions](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent#extensions) are not yet supported, as some commands rely on TUI-specific rendering.
- No published package on NPM yet.
