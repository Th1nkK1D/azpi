import { ndJsonStream, AgentSideConnection } from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";
import { PiAcpAgent } from "./pi-acp-agent";

/**
 * Entry point for the Pi ACP adapter.
 * Wires stdio to ndJsonStream and instantiates PiAcpAgent via AgentSideConnection.
 */
async function main() {
  // Create the NDJSON stream over stdin/stdout using Node's toWeb() helpers
  const stream = ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));

  // Create the agent-side connection with our Pi agent factory
  const connection = new AgentSideConnection((conn) => new PiAcpAgent(conn), stream);

  // Wait for the connection to close (e.g. stdin EOF)
  await connection.closed;
}

main().catch((error) => {
  console.error("[azpi] fatal:", error);
  process.exit(1);
});
