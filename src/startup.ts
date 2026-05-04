import { VERSION as PI_VERSION } from "@mariozechner/pi-coding-agent";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import { name as AGENT_NAME, version as AGENT_VERSION } from "../package.json";

/**
 * Builds a markdown startup message with agent metadata for display in the ACP client.
 */
export function buildStartupMessage({ resourceLoader }: AgentSession): string {
  const { agentsFiles } = resourceLoader.getAgentsFiles();
  const { extensions } = resourceLoader.getExtensions();
  const { skills } = resourceLoader.getSkills();

  return [
    `### ${AGENT_NAME} v${AGENT_VERSION}`,
    "",
    `Using Pi coding agent v${PI_VERSION}`,
    "",
    "**Contexts:**",
    toBulletList(agentsFiles, (f) => f.path),
    "",
    "**Extensions:**",
    toBulletList(extensions, (e) => e.sourceInfo.source),
    "",
    "**Skills:**",
    toBulletList(skills, (s) => s.name),
    "",
  ].join("\n");
}

function toBulletList<T>(items: T[], prop: (item: T) => string): string {
  const list = items.map((item) => `- ${prop(item)}`).join("\n");
  return list || "- _(none)_";
}
