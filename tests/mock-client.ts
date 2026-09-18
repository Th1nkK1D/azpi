import { mock } from "bun:test";
import type { Mock } from "bun:test";
import type { AgentContext } from "@agentclientprotocol/sdk";

type Handler = (params: any) => any;

/**
 * Mock AgentContext that routes `notify`/`request` calls to one mock per ACP method.
 * `method("fs/read_text_file")` returns that mock; `sessionUpdate` aliases "session/update".
 */
export function mockClient(handlers: Record<string, Handler> = {}) {
  const methods: Record<string, Mock<Handler>> = {};
  const method = (name: string) => (methods[name] ??= mock(handlers[name] ?? (async () => ({}))));
  const route = (name: string, params: unknown) => method(name)(params);

  return {
    notify: mock(route),
    request: mock(route),
    method,
    get sessionUpdate() {
      return method("session/update");
    },
  } as unknown as AgentContext & {
    method: typeof method;
    sessionUpdate: Mock<Handler>;
  };
}
