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
    getSortedBulletList(agentsFiles, (f) => f.path),
    "",
    "**Extensions:**",
    getSortedBulletList(extensions, (e) => e.sourceInfo.source),
    "",
    "**Skills:**",
    getSortedBulletList(skills, (s) => s.name),
    "",
  ].join("\n");
}

function getSortedBulletList<T>(items: T[], getLabel: (item: T) => string): string {
  return (
    items
      .map(getLabel)
      .toSorted((a, z) => a.localeCompare(z))
      .map((label) => `- ${label}`)
      .join("\n") || "- _(none)_"
  );
}
