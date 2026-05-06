# Instruction

- Use bun as a JS runtime and package manager
- When changing business logic, always add or update unit test `tests/name.spec.ts` accordingly
- After finishing any task, run the following commands:
  - Check typescript type with `bun run check`
  - Lint with `bun run lint:agent`, all errors and warnings must be fixed
  - Tests with `bun test` to confirm that everything is working
  - Format code with `bun run format` before declaring task as done

# References

Can fetch these resources if you need to understand how it works:

- Agent Client Protocol (ACP) -> https://agentclientprotocol.com/llms.txt
- Pi Coding Agent SDK -> https://raw.githubusercontent.com/badlogic/pi-mono/refs/heads/main/packages/coding-agent/docs/sdk.md
