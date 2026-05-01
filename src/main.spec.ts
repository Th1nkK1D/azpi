import { describe, expect, it } from "bun:test";
import * as acp from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";

describe("main — stdio transport", () => {
  it("can create ndJsonStream over simulated streams", () => {
    const stream = acp.ndJsonStream(
      new WritableStream<Uint8Array>(),
      new ReadableStream<Uint8Array>(),
    );
    expect(stream.writable).toBeDefined();
    expect(stream.readable).toBeDefined();
  });

  it("ndJsonStream produces a valid Stream shape", () => {
    const stream = acp.ndJsonStream(
      new WritableStream<Uint8Array>(),
      new ReadableStream<Uint8Array>(),
    );
    expect(typeof stream.writable.getWriter).toBe("function");
    expect(typeof stream.readable.getReader).toBe("function");
  });

  it("can convert process.stdin/stdout to web streams", () => {
    // Verify that the node:stream toWeb conversions work
    const writable = Writable.toWeb(process.stdout);
    const readable = Readable.toWeb(process.stdin);
    expect(writable).toBeDefined();
    expect(readable).toBeDefined();
    expect(typeof writable.getWriter).toBe("function");
    expect(typeof readable.getReader).toBe("function");
  });
});
