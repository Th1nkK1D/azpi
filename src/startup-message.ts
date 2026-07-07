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
 * For auto-discovered extensions (source: "auto"), derives a label from the file path.
 */
function dedupeExtensions(
  extensions: Array<{ sourceInfo: { source: string; path?: string } }>,
): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const ext of extensions) {
    const source = ext.sourceInfo.source;
    // For auto-discovered extensions, derive a readable label from the path
    const label = source === "auto" ? getAutoExtensionLabel(ext.sourceInfo.path) : source;
    if (!seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  }
  return labels;
}

/**
 * Derive a human-readable label for auto-discovered extensions from their path.
 * Examples:
 *   ~/.pi/agent/extensions/my-extension.ts -> "my-extension"
 *   ~/.pi/agent/extensions/my-extension/index.ts -> "my-extension"
 *   .pi/extensions/foo.ts -> "foo"
 */
function getAutoExtensionLabel(path: string | undefined): string {
  if (!path) return "auto";

  const parts = path.replace(/\\/g, "/").split("/");
  const extDirIdx = parts.findIndex((p) => p === "extensions");

  if (extDirIdx >= 0 && extDirIdx < parts.length - 1) {
    const nextPart = parts[extDirIdx + 1]!;
    if (nextPart.includes(".")) {
      return nextPart.replace(/\.[^.]+$/, "");
    }
    return nextPart;
  }

  return parts[parts.length - 1]?.replace(/\.[^.]+$/, "") ?? "auto";
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
