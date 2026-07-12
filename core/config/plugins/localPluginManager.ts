import path from "node:path";
import os from "node:os";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { getQivrynGlobalPath } from "../../util/paths";

const REGISTRY_VERSION = 1;
const MAX_PLUGIN_FILES = 1_000;
const MAX_PLUGIN_BYTES = 128 * 1024 * 1024;
const PLUGIN_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export interface LocalPluginManifest {
  name: string;
  version: string;
  description?: string;
  skills?: string;
  rules?: string;
  agents?: string;
  mcp?: string;
  mcpServers?: string;
  interface?: { displayName?: string; developerName?: string };
}

export interface InstalledLocalPlugin {
  id: string;
  name: string;
  displayName: string;
  version: string;
  description?: string;
  developerName?: string;
  enabled: boolean;
  sourcePath: string;
  installedPath: string;
  installedAt: string;
  updatedAt: string;
  sourceKind?: "local" | "codex";
  installMode?: "copied" | "linked";
  contributions: { skills: number; rules: number; agents: number; mcp: number };
}

export interface LocalPluginContributionPaths {
  skills: string[];
  rules: string[];
  agents: string[];
  mcp: string[];
}

interface PluginRegistry {
  version: 1;
  plugins: InstalledLocalPlugin[];
}

const pluginRoot = (qivrynHome = getQivrynGlobalPath()) =>
  path.join(qivrynHome, "plugins");
const installedRoot = (qivrynHome?: string) =>
  path.join(pluginRoot(qivrynHome), "installed");
const registryPath = (qivrynHome?: string) =>
  path.join(pluginRoot(qivrynHome), "registry.json");

async function readRegistry(qivrynHome?: string): Promise<PluginRegistry> {
  try {
    const parsed = JSON.parse(
      await readFile(registryPath(qivrynHome), "utf8"),
    ) as Partial<PluginRegistry>;
    if (parsed.version !== REGISTRY_VERSION || !Array.isArray(parsed.plugins)) {
      throw new Error("Unsupported local plugin registry format");
    }
    return { version: REGISTRY_VERSION, plugins: parsed.plugins };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { version: REGISTRY_VERSION, plugins: [] };
    throw error;
  }
}

async function writeRegistry(
  registry: PluginRegistry,
  qivrynHome?: string,
): Promise<void> {
  await mkdir(pluginRoot(qivrynHome), { recursive: true });
  const temporaryPath = `${registryPath(qivrynHome)}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(registry, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporaryPath, registryPath(qivrynHome));
}

function resolveContribution(
  root: string,
  contribution?: string,
): string | undefined {
  if (!contribution) return undefined;
  const resolved = path.resolve(root, contribution);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Plugin contribution escapes its bundle: ${contribution}`);
  }
  return resolved;
}

async function countFiles(root: string | undefined, suffix?: string) {
  if (!root) return 0;
  try {
    const rootStat = await stat(root);
    if (rootStat.isFile()) {
      return !suffix || root.endsWith(suffix) ? 1 : 0;
    }
    let count = 0;
    const visit = async (directory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          await visit(path.join(directory, entry.name));
        } else if (entry.isFile() && (!suffix || entry.name.endsWith(suffix))) {
          count += 1;
        }
      }
    };
    await visit(root);
    return count;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

async function inspectBundle(sourcePath: string) {
  const root = await realpath(path.resolve(sourcePath));
  if (!(await stat(root)).isDirectory())
    throw new Error("Plugin source must be a local directory");
  const manifest = JSON.parse(
    await readFile(path.join(root, ".codex-plugin", "plugin.json"), "utf8"),
  ) as Partial<LocalPluginManifest>;
  if (!manifest.name?.trim() || !PLUGIN_ID_PATTERN.test(manifest.name)) {
    throw new Error("Plugin manifest name must be a lowercase identifier");
  }
  if (!manifest.version?.trim())
    throw new Error("Plugin manifest version is required");

  let fileCount = 0;
  let byteCount = 0;
  const inspectDirectory = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      const entryStat = await lstat(entryPath);
      if (entryStat.isSymbolicLink())
        throw new Error(
          `Plugin bundles may not contain symbolic links: ${entry.name}`,
        );
      if (entryStat.isDirectory()) await inspectDirectory(entryPath);
      else if (entryStat.isFile()) {
        fileCount += 1;
        byteCount += entryStat.size;
        if (fileCount > MAX_PLUGIN_FILES || byteCount > MAX_PLUGIN_BYTES)
          throw new Error("Plugin bundle exceeds the local size limit");
      } else throw new Error(`Unsupported plugin bundle entry: ${entry.name}`);
    }
  };
  await inspectDirectory(root);

  const validManifest = manifest as LocalPluginManifest;
  return {
    root,
    manifest: validManifest,
    contributions: {
      skills: await countFiles(
        resolveContribution(root, validManifest.skills),
        "SKILL.md",
      ),
      rules: await countFiles(
        resolveContribution(root, validManifest.rules),
        ".md",
      ),
      agents: await countFiles(
        resolveContribution(root, validManifest.agents),
        ".md",
      ),
      mcp: await countFiles(
        resolveContribution(
          root,
          validManifest.mcp ?? validManifest.mcpServers,
        ),
      ),
    },
  };
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function isExcludedCodexCachePath(candidate: string): boolean {
  return candidate
    .split(path.sep)
    .some((segment) =>
      /(?:^|[-_.])(backup|staging|installing|tmp)(?:$|[-_.])/i.test(segment),
    );
}

/**
 * Register an active Codex plugin in place. Codex plugin bundles can be much
 * larger than Qivryn's copied-plugin limit, so trusted cache entries remain
 * read-only and are never removed from the Codex installation.
 */
export async function linkCodexPlugin(
  sourcePath: string,
  enabled: boolean,
  codexHome = process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"),
  qivrynHome = getQivrynGlobalPath(),
): Promise<InstalledLocalPlugin> {
  const root = await realpath(path.resolve(sourcePath));
  const codexCacheRoot = await realpath(
    path.join(codexHome, "plugins", "cache"),
  );
  if (!isWithin(codexCacheRoot, root) || isExcludedCodexCachePath(root)) {
    throw new Error(
      "Codex plugins may only be linked from the active Codex cache",
    );
  }
  if (!(await stat(root)).isDirectory()) {
    throw new Error("Codex plugin source must be a directory");
  }

  const manifest = JSON.parse(
    await readFile(path.join(root, ".codex-plugin", "plugin.json"), "utf8"),
  ) as Partial<LocalPluginManifest>;
  if (!manifest.name?.trim() || !PLUGIN_ID_PATTERN.test(manifest.name)) {
    throw new Error(
      "Codex plugin manifest name must be a lowercase identifier",
    );
  }
  if (!manifest.version?.trim()) {
    throw new Error("Codex plugin manifest version is required");
  }

  const validManifest = manifest as LocalPluginManifest;
  const contributions = {
    skills: await countFiles(
      resolveContribution(root, validManifest.skills),
      "SKILL.md",
    ),
    rules: await countFiles(
      resolveContribution(root, validManifest.rules),
      ".md",
    ),
    agents: await countFiles(
      resolveContribution(root, validManifest.agents),
      ".md",
    ),
    mcp: await countFiles(
      resolveContribution(root, validManifest.mcp ?? validManifest.mcpServers),
    ),
  };
  const registry = await readRegistry(qivrynHome);
  const existing = registry.plugins.find(
    (plugin) => plugin.id === validManifest.name,
  );
  const now = new Date().toISOString();
  const plugin: InstalledLocalPlugin = {
    id: validManifest.name,
    name: validManifest.name,
    displayName: validManifest.interface?.displayName ?? validManifest.name,
    version: validManifest.version,
    description: validManifest.description,
    developerName: validManifest.interface?.developerName,
    enabled,
    sourcePath: root,
    installedPath: root,
    installedAt: existing?.installedAt ?? now,
    updatedAt: now,
    sourceKind: "codex",
    installMode: "linked",
    contributions,
  };
  registry.plugins = [
    ...registry.plugins.filter((candidate) => candidate.id !== plugin.id),
    plugin,
  ];
  await writeRegistry(registry, qivrynHome);
  return plugin;
}

export async function listLocalPlugins(): Promise<InstalledLocalPlugin[]> {
  return (await readRegistry()).plugins.sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );
}

export async function installLocalPlugin(
  sourcePath: string,
): Promise<InstalledLocalPlugin> {
  const { root, manifest, contributions } = await inspectBundle(sourcePath);
  const registry = await readRegistry();
  const existing = registry.plugins.find(
    (plugin) => plugin.id === manifest.name,
  );
  const destination = path.join(installedRoot(), manifest.name);
  const temporaryDestination = `${destination}.installing-${process.pid}-${Date.now()}`;
  await mkdir(installedRoot(), { recursive: true });
  await rm(temporaryDestination, { recursive: true, force: true });
  await cp(root, temporaryDestination, { recursive: true, errorOnExist: true });
  await rm(destination, { recursive: true, force: true });
  await rename(temporaryDestination, destination);

  const now = new Date().toISOString();
  const plugin: InstalledLocalPlugin = {
    id: manifest.name,
    name: manifest.name,
    displayName: manifest.interface?.displayName ?? manifest.name,
    version: manifest.version,
    description: manifest.description,
    developerName: manifest.interface?.developerName,
    enabled: existing?.enabled ?? true,
    sourcePath: root,
    installedPath: destination,
    installedAt: existing?.installedAt ?? now,
    updatedAt: now,
    sourceKind: "local",
    installMode: "copied",
    contributions,
  };
  registry.plugins = [
    ...registry.plugins.filter((candidate) => candidate.id !== plugin.id),
    plugin,
  ];
  await writeRegistry(registry);
  return plugin;
}

export async function setLocalPluginEnabled(id: string, enabled: boolean) {
  const registry = await readRegistry();
  const plugin = registry.plugins.find((candidate) => candidate.id === id);
  if (!plugin) throw new Error(`Local plugin not found: ${id}`);
  plugin.enabled = enabled;
  plugin.updatedAt = new Date().toISOString();
  await writeRegistry(registry);
  return plugin;
}

export async function uninstallLocalPlugin(id: string): Promise<void> {
  const registry = await readRegistry();
  const plugin = registry.plugins.find((candidate) => candidate.id === id);
  if (!plugin) throw new Error(`Local plugin not found: ${id}`);
  if (plugin.installMode !== "linked") {
    const expectedPath = path.join(installedRoot(), id);
    if (path.resolve(plugin.installedPath) !== path.resolve(expectedPath))
      throw new Error(
        "Refusing to remove a plugin outside the managed directory",
      );
    await rm(expectedPath, { recursive: true, force: true });
  }
  registry.plugins = registry.plugins.filter(
    (candidate) => candidate.id !== id,
  );
  await writeRegistry(registry);
}

export async function getEnabledLocalPluginContributionPaths(): Promise<LocalPluginContributionPaths> {
  const plugins = (await readRegistry()).plugins.filter(
    (plugin) => plugin.enabled,
  );
  const paths: LocalPluginContributionPaths = {
    skills: [],
    rules: [],
    agents: [],
    mcp: [],
  };
  for (const plugin of plugins) {
    try {
      const manifest = JSON.parse(
        await readFile(
          path.join(plugin.installedPath, ".codex-plugin", "plugin.json"),
          "utf8",
        ),
      ) as LocalPluginManifest;
      for (const kind of Object.keys(paths) as Array<
        keyof LocalPluginContributionPaths
      >) {
        const manifestPath =
          kind === "mcp"
            ? (manifest.mcp ?? manifest.mcpServers)
            : manifest[kind];
        const contributionPath = resolveContribution(
          plugin.installedPath,
          manifestPath,
        );
        if (contributionPath) paths[kind].push(contributionPath);
      }
    } catch {
      // Damaged installs remain visible but contribute nothing until updated.
    }
  }
  return paths;
}

export async function getEnabledLocalPluginSkillPaths(): Promise<string[]> {
  return (await getEnabledLocalPluginContributionPaths()).skills;
}
