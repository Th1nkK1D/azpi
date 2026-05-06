/**
 * Entry point for the Pi ACP adapter.
 * Wires stdio to ndJsonStream and instantiates PiAcpAgent via AgentSideConnection.
 */

import { ndJsonStream, AgentSideConnection } from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";
import { PiAcpAgent } from "./pi-acp-agent";

const stream = ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
const connection = new AgentSideConnection((conn) => new PiAcpAgent(conn), stream);

await connection.closed;
