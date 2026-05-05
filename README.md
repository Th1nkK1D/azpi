# azpi

Seamless ACP client on top of the Pi coding agent

## Why?

The [Agent Client Protocol (ACP)](https://agentclientprotocol.com) standardizes communication between code editors/IDEs and coding agents. It decouples vendor lock-in and allows both sides to innovate independently while giving developers the freedom to choose the best tools for their workflow—like me, who loves [Zed](https://zed.dev) and [Pi](https://pi.dev).

Pi does not support ACP out of the box, and there are a couple of ACP adapters out there that communicate with Pi through [RPC mode](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md) (for example, my main inspiration, [svkozak/pi-acp](https://github.com/svkozak/pi-acp)). The main advantage of this approach is that it decouples the ACP adapter from Pi, allowing you to use the same Pi executable through the CLI and ACP. As a trade-off, some ACP specifications are limited by Pi's RPC constraints.

This project decides to take a different approach by using [Pi's JavaScript SDK](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md). This allows us to maximize Pi's functionality and support more ACP features in the specification, at the cost of bundling the Pi coding agent together with the package.

## Features

- **Pi CLI interoperability** — Shares settings, persistent sessions, extensions, and user prompts with Pi CLI.
- **Model & thinking selection** — Exposed as ACP config options and synced bidirectionally.
- **Startup message** — Shows Pi version, loaded contexts, extensions, and skills.
- **Rich content** — Handles `text`, `image`, `resource`, and `resource_link` content blocks.
- **Real-time event streaming** — Text, thinking, tool execution, and session info changes are all bridged to ACP.
- **Auto session naming** — Derives session names from the first prompt.
- **Client tool proxy** — Delegates `read`, `write`, `edit`, and `bash` to the ACP client when available, allowing editors like Zed to show agent change diffs.
- **Slash commands** — Supports Pi's built-in commands (`/name`, `/session`, `/compact`, `/export`, and `/reload`), skills, and prompt templates.

## Usage

The package is neither pre-built nor published yet. You can clone the repository and build the project with [Bun](https://bun.com/):

```bash
git clone https://github.com/Th1nkK1D/azpi.git
cd azpi
bun i --frozen-lockfile --production
bun run build
```

The binary file will then be available at `dist/azpi`. Example configuration for Zed:

```jsonc
"agent_servers": {
  "azpi": {
    "type": "custom",
    "command": "<path-to-repository>/dist/azpi",
    "env": {
      "PI_OFFLINE": "true" // If you want to handle package installation via CLI, not automatically through the SDK
    }
  }
}
```

## Limitations / Future Improvements

- Slash commands from Pi's [extensions](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent#extensions)
- ACP's Agent Plan [specification](https://agentclientprotocol.com/protocol/agent-plan)
- Publish package on NPM
