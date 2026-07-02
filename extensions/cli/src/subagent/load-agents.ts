import { parseMarkdownRule } from "@continuedev/config-yaml";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type PortableSubagentPermission = "default" | "readonly" | "agent-only";

export interface PortableSubagentDefinition {
  name: string;
  description?: string;
  prompt: string;
  tools?: string[];
  model?: string;
  permissionMode: PortableSubagentPermission;
  background: boolean;
  sourceFile: string;
}

const WORKSPACE_ROOTS = [
  ".continue",
  ".cursor",
  ".claude",
  ".codex",
  ".agents",
];

function strings(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const values = value.filter(
      (item): item is string => typeof item === "string",
    );
    return values.length ? values : undefined;
  }
  if (typeof value === "string") {
    const values = value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    return values.length ? values : undefined;
  }
  return undefined;
}

function managedPluginAgentRoots(home: string): string[] {
  const continueHome =
    process.env.CONTINUE_GLOBAL_DIR ?? path.join(home, ".continue");
  const registryPath = path.join(continueHome, "plugins", "registry.json");
  try {
    const registry = JSON.parse(fs.readFileSync(registryPath, "utf8")) as {
      version?: number;
      plugins?: Array<{
        enabled?: boolean;
        installedPath?: string;
      }>;
    };
    if (registry.version !== 1 || !Array.isArray(registry.plugins)) return [];
    return registry.plugins.flatMap((plugin) => {
      if (!plugin.enabled || !plugin.installedPath) return [];
      try {
        const installedPath = fs.realpathSync(plugin.installedPath);
        const manifest = JSON.parse(
          fs.readFileSync(
            path.join(installedPath, ".codex-plugin", "plugin.json"),
            "utf8",
          ),
        ) as { agents?: string };
        if (!manifest.agents) return [];
        const agentsPath = path.resolve(installedPath, manifest.agents);
        const relative = path.relative(installedPath, agentsPath);
        if (relative.startsWith("..") || path.isAbsolute(relative)) return [];
        return [agentsPath];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

function agentFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile() && /\.(md|mdc)$/i.test(entry.name))
        files.push(fullPath);
    }
  }
  return files.sort();
}

/** Load Continue, Cursor, Claude, Codex and .agents subagent definitions. */
export function loadPortableSubagents(
  cwd = process.cwd(),
  home = os.homedir(),
): PortableSubagentDefinition[] {
  const roots = [
    ...WORKSPACE_ROOTS.map((name) => path.join(cwd, name, "agents")),
    ...managedPluginAgentRoots(home),
    ...WORKSPACE_ROOTS.map((name) => path.join(home, name, "agents")),
  ];
  const definitions: PortableSubagentDefinition[] = [];
  const seen = new Set<string>();

  for (const file of roots.flatMap(agentFiles)) {
    try {
      const parsed = parseMarkdownRule(fs.readFileSync(file, "utf8"));
      const frontmatter = parsed.frontmatter as Record<string, unknown>;
      const { markdown } = parsed;
      const name =
        typeof frontmatter.name === "string" && frontmatter.name.trim()
          ? frontmatter.name.trim()
          : path.basename(file).replace(/\.(md|mdc)$/i, "");
      if (!markdown.trim() || seen.has(name)) continue;
      seen.add(name);
      const permissionValue =
        frontmatter.permission_mode ?? frontmatter.permissionMode;
      const rawPermission =
        typeof permissionValue === "string" ? permissionValue : "default";
      const permissionMode: PortableSubagentPermission = [
        "readonly",
        "agent-only",
      ].includes(rawPermission)
        ? (rawPermission as PortableSubagentPermission)
        : "default";
      definitions.push({
        name,
        description:
          typeof frontmatter.description === "string"
            ? frontmatter.description
            : undefined,
        prompt: markdown.trim(),
        tools: strings(frontmatter.tools),
        model:
          typeof frontmatter.model === "string" ? frontmatter.model : undefined,
        permissionMode,
        background: Boolean(
          frontmatter.is_background ?? frontmatter.background,
        ),
        sourceFile: file,
      });
    } catch {
      // Invalid third-party definitions are surfaced by their owning client and
      // must not prevent the Continue CLI from starting.
    }
  }
  return definitions;
}
