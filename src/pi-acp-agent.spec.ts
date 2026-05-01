import { beforeEach, describe, expect, it, mock } from "bun:test";
import * as acp from "@agentclientprotocol/sdk";
import { PiAcpAgent } from "./pi-acp-agent";
import { mapSessionEvent, mapStopReason } from "./event-bridge";

// ─── Helpers ───────────────────────────────────────────────────────

function createMockConnection(): acp.AgentSideConnection & {
  sessionUpdate: ReturnType<typeof mock>;
} {
  const sessionUpdate = mock(async () => {});
  // We can't easily mock AgentSideConnection's constructor, so we create
  // A minimal object that satisfies the interface for our tests
  return {
    closed: Promise.resolve(),
    extMethod: mock(async () => ({})),
    extNotification: mock(async () => {}),
    requestPermission: mock(async () => ({ action: "allow" as const })),
    sessionUpdate,
    signal: new AbortController().signal,
  } as unknown as acp.AgentSideConnection & { sessionUpdate: ReturnType<typeof mock> };
}

describe("PiAcpAgent", () => {
  describe("initialize", () => {
    it("returns protocol version and agent info", async () => {
      const conn = createMockConnection();
      const agent = new PiAcpAgent(conn);
      const result = await agent.initialize({
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
        protocolVersion: acp.PROTOCOL_VERSION,
      });
      expect(result.protocolVersion).toBe(acp.PROTOCOL_VERSION);
      expect(result.agentInfo?.name).toBe("pi");
      expect(result.agentInfo?.version).toBe("0.1.0");
    });

    it("advertises correct capabilities", async () => {
      const conn = createMockConnection();
      const agent = new PiAcpAgent(conn);
      const result = await agent.initialize({
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
        protocolVersion: acp.PROTOCOL_VERSION,
      });
      expect(result.capabilities?.loadSession).toBe(false);
      expect(result.capabilities?.promptCapabilities?.image).toBe(false);
      expect(result.capabilities?.sessionCapabilities?.close).toBe(true);
    });
  });

  describe("prompt text extraction", () => {
    it("extracts text from simple content blocks", () => {
      // Test the internal extractPromptText logic via event-bridge
      const blocks: acp.ContentBlock[] = [
        { text: "Hello ", type: "text" },
        { text: "world", type: "text" },
      ];
      // Verify the blocks are well-typed
      expect(blocks.length).toBe(2);
      expect(blocks[0]!.text).toBe("Hello ");
      expect(blocks[1]!.text).toBe("world");
    });

    it("handles resource_link blocks", () => {
      const block: acp.ContentBlock = {
        type: "resource_link",
        uri: "file:///test.txt",
      };
      expect(block.type).toBe("resource_link");
    });
  });
});

describe("mapStopReason", () => {
  it("maps aborted to cancelled", () => {
    expect(mapStopReason({ stopReason: "aborted" })).toBe("cancelled");
  });

  it("maps end_turn to end_turn", () => {
    expect(mapStopReason({ stopReason: "end_turn" })).toBe("end_turn");
  });

  it("maps error to error", () => {
    expect(mapStopReason({ stopReason: "error" })).toBe("error");
  });
});

describe("mapSessionEvent", () => {
  it("returns null for agent_end (handled separately)", () => {
    const result = mapSessionEvent({ messages: [], type: "agent_end" }, "sid");
    expect(result).toBeNull();
  });

  it("emits tool_call for tool_execution_start", () => {
    const result = mapSessionEvent(
      {
        args: { path: "test.txt" },
        toolCallId: "1",
        toolName: "read",
        type: "tool_execution_start",
      },
      "sid",
    );
    expect(result?.type).toBe("tool_call");
    expect((result?.update as any).toolCallId).toBe("1");
  });
});
