import { describe, expect, it, mock } from "bun:test";
import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import { createAcpUiBridge } from "../src/extension-ui-bridge";

function createMockConnection(): AgentSideConnection {
  return {
    sessionUpdate: mock(async () => {}),
  } as unknown as AgentSideConnection;
}

describe("createAcpUiBridge", () => {
  const sessionId = "test-session-id";
  const NOT_SUPPORTED = "not supported";

  describe("notify", () => {
    it("sends sessionUpdate with the message text", () => {
      const conn = createMockConnection();
      const bridge = createAcpUiBridge(conn, sessionId);

      bridge.notify("Hello from extension", "info");

      expect(conn.sessionUpdate).toHaveBeenCalledWith({
        sessionId,
        update: {
          content: { text: "Hello from extension", type: "text" },
          sessionUpdate: "agent_message_chunk",
        },
      });
    });

    it("does not throw when connection fails", () => {
      const conn = createMockConnection();
      (conn.sessionUpdate as any) = mock(async () => {
        throw new Error("connection closed");
      });
      const bridge = createAcpUiBridge(conn, sessionId);

      expect(() => bridge.notify("test")).not.toThrow();
    });
  });

  describe("confirm", () => {
    it("throws descriptive error", async () => {
      const bridge = createAcpUiBridge(createMockConnection(), sessionId);
      await expect(bridge.confirm("Title", "Message")).rejects.toThrow(NOT_SUPPORTED);
    });
  });

  describe("select", () => {
    it("throws descriptive error", async () => {
      const bridge = createAcpUiBridge(createMockConnection(), sessionId);
      await expect(bridge.select("Title", ["A", "B"])).rejects.toThrow(NOT_SUPPORTED);
    });
  });

  describe("input", () => {
    it("throws descriptive error", async () => {
      const bridge = createAcpUiBridge(createMockConnection(), sessionId);
      await expect(bridge.input("Title")).rejects.toThrow(NOT_SUPPORTED);
    });
  });

  describe("editor", () => {
    it("throws descriptive error", async () => {
      const bridge = createAcpUiBridge(createMockConnection(), sessionId);
      await expect(bridge.editor("Title")).rejects.toThrow(NOT_SUPPORTED);
    });
  });

  describe("custom", () => {
    it("throws descriptive error", async () => {
      const bridge = createAcpUiBridge(createMockConnection(), sessionId);
      await expect(bridge.custom(async () => ({ dispose() {} }) as any)).rejects.toThrow(
        NOT_SUPPORTED,
      );
    });
  });

  describe("setStatus", () => {
    it("is a no-op", () => {
      const bridge = createAcpUiBridge(createMockConnection(), sessionId);
      expect(() => bridge.setStatus("key", "text")).not.toThrow();
    });
  });

  describe("getEditorText", () => {
    it("returns empty string", () => {
      const bridge = createAcpUiBridge(createMockConnection(), sessionId);
      expect(bridge.getEditorText()).toBe("");
    });
  });

  describe("theme", () => {
    it("throws descriptive error", () => {
      const bridge = createAcpUiBridge(createMockConnection(), sessionId);
      expect(() => bridge.theme).toThrow("Theme is not available in ACP mode");
    });
  });
});
