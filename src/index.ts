/**
 * Entry point for the Pi ACP adapter.
 * Wires stdio to ndJsonStream and serves the AZPi agent app over it.
 */

import { ndJsonStream } from "@agentclientprotocol/sdk";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Readable, Writable } from "node:stream";
import { createAgentApp } from "./pi-acp-agent";

const modelRuntime = await ModelRuntime.create();
const stream = ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
const connection = createAgentApp({ modelRuntime }).connect(stream);

await connection.closed;
