import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { version as PI_VERSION } from "../node_modules/@earendil-works/pi-coding-agent/package.json";
import { version as AGENT_VERSION } from "../package.json";

/**
 * Builds a markdown startup message with agent metadata for display in the ACP client.
 */
export function buildStartupMessage({ resourceLoader }: AgentSession): string {
  const { agentsFiles } = resourceLoader.getAgentsFiles();
  const { extensions } = resourceLoader.getExtensions();
  const { skills } = resourceLoader.getSkills();

  return [
    `### AZPi v${AGENT_VERSION}`,
    "",
    `Using Pi coding agent v${PI_VERSION}`,
    "",
    "**Contexts:**",
    getSortedBulletList(agentsFiles, (f) => f.path),
    "",
    "**Extensions:**",
    getSortedBulletList(dedupeExtensions(extensions), (e) => e),
    "",
    "**Skills:**",
    getSortedBulletList(skills, (s) => s.name),
    "",
  ].join("\n");
}

/**
 * Deduplicate extensions by package source, returning unique source labels.
 * When a package provides multiple extension entry points, only the first is kept.
 */
function dedupeExtensions(extensions: Array<{ sourceInfo: { source: string } }>): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const ext of extensions) {
    const source = ext.sourceInfo.source;
    if (!seen.has(source)) {
      seen.add(source);
      labels.push(source);
    }
  }
  return labels;
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
