import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { linkCodexPlugin } from "../plugins/localPluginManager";
import { getQivrynGlobalPath } from "../../util/paths";

const execFileAsync = promisify(execFile);
const IMPORT_VERSION = 1;

export type CodexImportKind =
  | "mcp"
  | "plugin"
  | "skill"
  | "hook"
  | "rule"
  | "agent"
  | "automation";

export interface CodexImportItem {
  id: string;
  name: string;
  kind: CodexImportKind;
  enabled: boolean;
  sourcePath?: string;
  detail?: string;
  state: "available" | "linked" | "imported" | "needs-review";
  sourceEnabled?: boolean;
  reviewed?: boolean;
  canToggle?: boolean;
}

export interface CodexImportInventory {
  version: 1;
  sourceRoot: string;
  scannedAt: string;
  items: CodexImportItem[];
  counts: Record<CodexImportKind, number>;
  issues: string[];
}

export interface ApplyCodexImportRequest {
  kinds?: CodexImportKind[];
}

export interface ApplyCodexImportResult {
  inventory: CodexImportInventory;
  imported: Record<CodexImportKind, number>;
  issues: string[];
}

export interface SetCodexImportItemEnabledRequest {
  kind: CodexImportKind;
  id: string;
  enabled: boolean;
  reviewed?: boolean;
}

interface CodexImportOverride {
  enabled: boolean;
  reviewed?: boolean;
  updatedAt: string;
}

interface CodexImportState {
  version: 1;
  overrides: Record<string, CodexImportOverride>;
}

interface CodexMcpListEntry {
  name: string;
  enabled?: boolean;
  transport?:
    | {
        type: "stdio";
        command: string;
        args?: string[];
        cwd?: string | null;
        env?: Record<string, string> | null;
      }
    | {
        type: "streamable_http" | "sse";
        url: string;
        bearer_token_env_var?: string | null;
        http_headers?: Record<string, string> | null;
        env_http_headers?: Record<string, string> | null;
      };
}

interface CodexPluginCandidate {
  id: string;
  name: string;
  version: string;
  root: string;
  enabled: boolean;
}

interface CodexAutomationRecord {
  id: string;
  name: string;
  prompt: string;
  status: string;
  rrule: string;
  model?: string;
  reasoningEffort?: string;
  repositoryPath: string;
  createdAt?: number;
  updatedAt?: number;
  sourcePath: string;
}

export interface CodexImportOptions {
  codexHome?: string;
  qivrynHome?: string;
  mcpServers?: CodexMcpListEntry[];
}

const emptyCounts = (): Record<CodexImportKind, number> => ({
  mcp: 0,
  plugin: 0,
  skill: 0,
  hook: 0,
  rule: 0,
  agent: 0,
  automation: 0,
});

const importStatePath = (qivrynHome: string) =>
  path.join(qivrynHome, "codex-import", "state.json");
const importInventoryPath = (qivrynHome: string) =>
  path.join(qivrynHome, "codex-import", "inventory.json");
const itemKey = (kind: CodexImportKind, id: string) => `${kind}:${id}`;

async function readImportState(qivrynHome: string): Promise<CodexImportState> {
  try {
    const parsed = JSON.parse(
      await readFile(importStatePath(qivrynHome), "utf8"),
    ) as Partial<CodexImportState>;
    if (parsed.version !== IMPORT_VERSION || !parsed.overrides) {
      throw new Error("Unsupported Codex import state format");
    }
    return { version: IMPORT_VERSION, overrides: parsed.overrides };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: IMPORT_VERSION, overrides: {} };
    }
    throw error;
  }
}

async function readImportedInventory(
  qivrynHome: string,
): Promise<CodexImportInventory | undefined> {
  try {
    const parsed = JSON.parse(
      await readFile(importInventoryPath(qivrynHome), "utf8"),
    ) as CodexImportInventory;
    return parsed.version === IMPORT_VERSION ? parsed : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function exists(filepath: string): Promise<boolean> {
  try {
    await access(filepath);
    return true;
  } catch {
    return false;
  }
}

async function writeJsonAtomic(
  filepath: string,
  value: unknown,
): Promise<void> {
  await mkdir(path.dirname(filepath), { recursive: true });
  const temporaryPath = `${filepath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporaryPath, filepath);
}

function parseQuotedTomlString(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith('"')) return trimmed;
  try {
    return JSON.parse(trimmed) as string;
  } catch {
    return trimmed.slice(1, trimmed.endsWith('"') ? -1 : undefined);
  }
}

function tomlScalar(source: string, key: string): string | undefined {
  const match = new RegExp(`^${key}\\s*=\\s*(.+)$`, "m").exec(source);
  return parseQuotedTomlString(match?.[1]);
}

function parseTargetProject(source: string): string | undefined {
  const target = /^target\s*=\s*\{([^}]*)\}/m.exec(source)?.[1];
  if (!target) return undefined;
  return parseQuotedTomlString(
    /project_id\s*=\s*("(?:[^"\\]|\\.)*")/.exec(target)?.[1],
  );
}

function parseCodexAutomation(
  source: string,
  sourcePath: string,
): CodexAutomationRecord | undefined {
  const id = tomlScalar(source, "id");
  const name = tomlScalar(source, "name");
  const prompt = tomlScalar(source, "prompt");
  const rrule = tomlScalar(source, "rrule");
  const repositoryPath = parseTargetProject(source);
  if (!id || !name || !prompt || !rrule || !repositoryPath) return undefined;
  return {
    id,
    name,
    prompt,
    rrule,
    repositoryPath,
    status: tomlScalar(source, "status") ?? "PAUSED",
    model: tomlScalar(source, "model"),
    reasoningEffort: tomlScalar(source, "reasoning_effort"),
    createdAt: Number(tomlScalar(source, "created_at")) || undefined,
    updatedAt: Number(tomlScalar(source, "updated_at")) || undefined,
    sourcePath,
  };
}

async function listCodexAutomations(
  codexHome: string,
  issues: string[],
): Promise<CodexAutomationRecord[]> {
  const root = path.join(codexHome, "automations");
  if (!(await exists(root))) return [];
  const items: CodexAutomationRecord[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sourcePath = path.join(root, entry.name, "automation.toml");
    if (!(await exists(sourcePath))) continue;
    try {
      const parsed = parseCodexAutomation(
        await readFile(sourcePath, "utf8"),
        sourcePath,
      );
      if (parsed) items.push(parsed);
      else issues.push(`Automation ${entry.name} uses an unsupported format.`);
    } catch (error) {
      issues.push(
        `Automation ${entry.name} could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return items;
}

function configuredPluginStates(config: string): Map<string, boolean> {
  const states = new Map<string, boolean>();
  let currentId: string | undefined;
  for (const line of config.split(/\r?\n/)) {
    const section = /^\[plugins\."([^"]+)"\]\s*$/.exec(line);
    if (section) {
      currentId = section[1].split("@")[0];
      continue;
    }
    if (line.startsWith("[") && !section) currentId = undefined;
    const enabled = /^enabled\s*=\s*(true|false)\s*$/.exec(line);
    if (currentId && enabled) states.set(currentId, enabled[1] === "true");
  }
  return states;
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(/[.-]/).map((part) => Number(part));
  const rightParts = right.split(/[.-]/).map((part) => Number(part));
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const a = Number.isFinite(leftParts[index]) ? leftParts[index] : 0;
    const b = Number.isFinite(rightParts[index]) ? rightParts[index] : 0;
    if (a !== b) return a - b;
  }
  return left.localeCompare(right);
}

function excludedPluginPath(filepath: string): boolean {
  return filepath
    .split(path.sep)
    .some((part) =>
      /(?:^|[-_.])(backup|staging|installing|tmp)(?:$|[-_.])/i.test(part),
    );
}

async function findPluginManifests(root: string): Promise<string[]> {
  if (!(await exists(root))) return [];
  const results: string[] = [];
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > 10 || excludedPluginPath(directory)) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (!entry.isDirectory()) continue;
      if (entry.name === ".codex-plugin") {
        const manifestPath = path.join(entryPath, "plugin.json");
        if (await exists(manifestPath)) results.push(manifestPath);
        continue;
      }
      await visit(entryPath, depth + 1);
    }
  };
  await visit(root, 0);
  return results;
}

async function listCodexPlugins(
  codexHome: string,
  issues: string[],
): Promise<CodexPluginCandidate[]> {
  const configPath = path.join(codexHome, "config.toml");
  const config = (await exists(configPath))
    ? await readFile(configPath, "utf8")
    : "";
  const states = configuredPluginStates(config);
  const selected = new Map<string, CodexPluginCandidate>();
  const manifests = await findPluginManifests(
    path.join(codexHome, "plugins", "cache"),
  );
  for (const manifestPath of manifests) {
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        name?: string;
        version?: string;
        interface?: { displayName?: string };
      };
      if (!manifest.name || !manifest.version || !states.has(manifest.name)) {
        continue;
      }
      const candidate: CodexPluginCandidate = {
        id: manifest.name,
        name: manifest.interface?.displayName ?? manifest.name,
        version: manifest.version,
        root: path.dirname(path.dirname(manifestPath)),
        enabled: states.get(manifest.name) ?? false,
      };
      const current = selected.get(candidate.id);
      if (!current || compareVersions(candidate.version, current.version) > 0) {
        selected.set(candidate.id, candidate);
      }
    } catch (error) {
      issues.push(
        `Plugin manifest ${manifestPath} could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  for (const configured of states.keys()) {
    if (!selected.has(configured)) {
      issues.push(
        `Configured Codex plugin ${configured} was not found in the active cache.`,
      );
    }
  }
  return [...selected.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function collectNamedFiles(
  root: string,
  filename: string,
  maxDepth = 8,
): Promise<string[]> {
  if (!(await exists(root))) return [];
  const results: string[] = [];
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > maxDepth || excludedPluginPath(directory)) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isFile() && entry.name === filename) results.push(entryPath);
      else if (entry.isDirectory()) await visit(entryPath, depth + 1);
    }
  };
  await visit(root, 0);
  return results;
}

async function collectCodexAgentFiles(codexHome: string): Promise<string[]> {
  const results: string[] = [];
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > 10 || excludedPluginPath(directory)) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath, depth + 1);
        continue;
      }
      if (
        entry.isFile() &&
        /\.(md|mdc)$/i.test(entry.name) &&
        entryPath.split(path.sep).includes("agents")
      ) {
        results.push(entryPath);
      }
    }
  };
  if (await exists(codexHome)) await visit(codexHome, 0);
  return [...new Set(results)].sort();
}

async function collectMarkdownFiles(
  root: string,
  maxDepth = 8,
): Promise<string[]> {
  if (!(await exists(root))) return [];
  const results: string[] = [];
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > maxDepth || excludedPluginPath(directory)) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(entryPath, depth + 1);
      else if (entry.isFile() && /\.(md|mdc)$/i.test(entry.name)) {
        results.push(entryPath);
      }
    }
  };
  await visit(root, 0);
  return results;
}

function applyImportState(
  items: CodexImportItem[],
  state: CodexImportState,
  previous: CodexImportInventory | undefined,
): CodexImportItem[] {
  const previousItems = new Map(
    (previous?.items ?? []).map((item) => [itemKey(item.kind, item.id), item]),
  );
  return items.map((item) => {
    const key = itemKey(item.kind, item.id);
    const override = state.overrides[key];
    const prior = previousItems.get(key);
    const sourceEnabled = item.enabled;
    const reviewed =
      item.kind === "hook"
        ? (override?.reviewed ?? prior?.reviewed ?? false)
        : true;
    const enabled = override?.enabled ?? sourceEnabled;
    const canToggle = true;
    let nextState = item.state;
    if (prior?.state === "imported") nextState = "imported";
    if (item.kind === "hook" && !reviewed) nextState = "needs-review";
    return {
      ...item,
      enabled,
      sourceEnabled,
      reviewed,
      canToggle,
      state: nextState,
    };
  });
}

async function loadCodexMcpServers(
  options: CodexImportOptions,
): Promise<CodexMcpListEntry[]> {
  if (options.mcpServers) return options.mcpServers;
  const candidates = [
    process.env.CODEX_CLI_PATH,
    "/Applications/ChatGPT.app/Contents/Resources/codex",
    "codex",
  ].filter((candidate): candidate is string => Boolean(candidate));
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const { stdout } = await execFileAsync(
        candidate,
        ["mcp", "list", "--json"],
        {
          cwd: os.homedir(),
          env: {
            ...process.env,
            CODEX_HOME: options.codexHome ?? path.join(os.homedir(), ".codex"),
          },
          maxBuffer: 8 * 1024 * 1024,
        },
      );
      const parsed = JSON.parse(stdout) as unknown;
      if (!Array.isArray(parsed))
        throw new Error("Codex returned a non-array MCP list");
      return parsed as CodexMcpListEntry[];
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `Unable to read Codex MCP configuration: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

function mcpJsonEntry(
  server: CodexMcpListEntry,
): Record<string, unknown> | undefined {
  const transport = server.transport;
  if (!transport) return undefined;
  if (transport.type === "stdio") {
    return {
      type: "stdio",
      command: transport.command,
      ...(transport.args?.length ? { args: transport.args } : {}),
      ...(transport.cwd ? { cwd: transport.cwd } : {}),
      ...(transport.env ? { env: transport.env } : {}),
    };
  }
  const headers = { ...(transport.http_headers ?? {}) };
  if (transport.bearer_token_env_var) {
    headers.Authorization = `Bearer \${${transport.bearer_token_env_var}}`;
  }
  for (const [header, envName] of Object.entries(
    transport.env_http_headers ?? {},
  )) {
    headers[header] = `\${${envName}}`;
  }
  return {
    type: transport.type === "sse" ? "sse" : "http",
    url: transport.url,
    ...(Object.keys(headers).length ? { headers } : {}),
  };
}

async function scanHookItems(codexHome: string): Promise<CodexImportItem[]> {
  const filepath = path.join(codexHome, "hooks.json");
  if (!(await exists(filepath))) return [];
  const parsed = JSON.parse(await readFile(filepath, "utf8")) as {
    hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
  };
  const items: CodexImportItem[] = [];
  for (const [event, groups] of Object.entries(parsed.hooks ?? {})) {
    for (const [groupIndex, group] of groups.entries()) {
      for (const [hookIndex, hook] of (group.hooks ?? []).entries()) {
        if (!hook.command) continue;
        items.push({
          id: `${event}:${groupIndex}:${hookIndex}`,
          name: hook.command.split(/\s+/).at(-1) ?? hook.command,
          kind: "hook",
          enabled: true,
          sourcePath: filepath,
          detail: `${event} · ${hook.command}`,
          state: "needs-review",
        });
      }
    }
  }
  return items;
}

export async function scanCodexImport(
  options: CodexImportOptions = {},
): Promise<CodexImportInventory> {
  const codexHome = options.codexHome ?? path.join(os.homedir(), ".codex");
  const qivrynHome = options.qivrynHome ?? getQivrynGlobalPath();
  const issues: string[] = [];
  const items: CodexImportItem[] = [];

  try {
    for (const server of await loadCodexMcpServers({ ...options, codexHome })) {
      items.push({
        id: server.name,
        name: server.name,
        kind: "mcp",
        enabled: server.enabled !== false,
        detail: server.transport?.type,
        state: "available",
      });
    }
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }

  const plugins = await listCodexPlugins(codexHome, issues);
  items.push(
    ...plugins.map<CodexImportItem>((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      kind: "plugin",
      enabled: plugin.enabled,
      sourcePath: plugin.root,
      detail: `v${plugin.version}`,
      state: "available",
    })),
  );

  for (const skillFile of await collectNamedFiles(
    path.join(codexHome, "skills"),
    "SKILL.md",
    3,
  )) {
    items.push({
      id: path.basename(path.dirname(skillFile)),
      name: path.basename(path.dirname(skillFile)),
      kind: "skill",
      enabled: true,
      sourcePath: skillFile,
      state: "linked",
    });
  }

  items.push(...(await scanHookItems(codexHome)));

  const globalAgents = path.join(codexHome, "AGENTS.md");
  if (await exists(globalAgents)) {
    items.push({
      id: "global-agents",
      name: "Global AGENTS.md",
      kind: "rule",
      enabled: true,
      sourcePath: globalAgents,
      state: "linked",
    });
  }
  for (const ruleFile of await collectMarkdownFiles(
    path.join(codexHome, "rules"),
  )) {
    items.push({
      id: path.relative(codexHome, ruleFile),
      name: path.basename(path.dirname(ruleFile)),
      kind: "rule",
      enabled: true,
      sourcePath: ruleFile,
      state: "linked",
    });
  }
  const commandRulesPath = path.join(codexHome, "rules", "default.rules");
  if (await exists(commandRulesPath)) {
    issues.push(
      "Codex command prefix rules remain read-only in Codex because translating them would broaden Qivryn terminal permissions.",
    );
  }

  for (const agentFile of await collectCodexAgentFiles(codexHome)) {
    items.push({
      id: path.relative(codexHome, agentFile),
      name: path.basename(agentFile).replace(/\.(md|mdc)$/i, ""),
      kind: "agent",
      enabled: true,
      sourcePath: agentFile,
      detail: "Portable subagent definition",
      state: "linked",
    });
  }

  for (const automation of await listCodexAutomations(codexHome, issues)) {
    items.push({
      id: automation.id,
      name: automation.name,
      kind: "automation",
      enabled: automation.status.toUpperCase() === "ACTIVE",
      sourcePath: automation.sourcePath,
      detail: automation.rrule,
      state: "available",
    });
  }

  const managedItems = applyImportState(
    items,
    await readImportState(qivrynHome),
    await readImportedInventory(qivrynHome),
  );
  const counts = emptyCounts();
  for (const item of managedItems) counts[item.kind] += 1;
  return {
    version: IMPORT_VERSION,
    sourceRoot: codexHome,
    scannedAt: new Date().toISOString(),
    items: managedItems,
    counts,
    issues,
  };
}

function selectedKinds(request: ApplyCodexImportRequest): Set<CodexImportKind> {
  return new Set(
    request.kinds ?? [
      "mcp",
      "plugin",
      "skill",
      "hook",
      "rule",
      "agent",
      "automation",
    ],
  );
}

function inventoryItemsByKind(
  inventory: CodexImportInventory,
  kind: CodexImportKind,
): Map<string, CodexImportItem> {
  return new Map(
    inventory.items
      .filter((item) => item.kind === kind)
      .map((item) => [item.id, item]),
  );
}

function hookSettingsWithManagedState(
  value: unknown,
  inventory: CodexImportInventory,
): unknown {
  if (!value || typeof value !== "object") return value;
  const root = structuredClone(value) as {
    hooks?: Record<string, Array<{ hooks?: Array<Record<string, unknown>> }>>;
  };
  const items = inventoryItemsByKind(inventory, "hook");
  for (const [event, groups] of Object.entries(root.hooks ?? {})) {
    for (const [groupIndex, group] of groups.entries()) {
      for (const [hookIndex, hook] of (group.hooks ?? []).entries()) {
        const item = items.get(`${event}:${groupIndex}:${hookIndex}`);
        hook.enabled = Boolean(item?.enabled && item.reviewed);
      }
    }
  }
  return root;
}

export async function applyCodexImport(
  request: ApplyCodexImportRequest = {},
  options: CodexImportOptions = {},
): Promise<ApplyCodexImportResult> {
  const codexHome = options.codexHome ?? path.join(os.homedir(), ".codex");
  const qivrynHome = options.qivrynHome ?? getQivrynGlobalPath();
  const selected = selectedKinds(request);
  const inventory = await scanCodexImport({ ...options, codexHome });
  const imported = emptyCounts();
  const issues = [...inventory.issues];

  if (selected.has("mcp")) {
    try {
      const servers = await loadCodexMcpServers({ ...options, codexHome });
      const managed = inventoryItemsByKind(inventory, "mcp");
      const mcpServers = Object.fromEntries(
        servers
          .filter(
            (server) =>
              (managed.get(server.name)?.enabled ?? server.enabled) !== false,
          )
          .map((server) => [server.name, mcpJsonEntry(server)])
          .filter((entry): entry is [string, Record<string, unknown>] =>
            Boolean(entry[1]),
          ),
      );
      await writeJsonAtomic(
        path.join(qivrynHome, "mcpServers", "codex-import.json"),
        { mcpServers },
      );
      imported.mcp = Object.keys(mcpServers).length;
    } catch (error) {
      issues.push(
        `MCP import failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (selected.has("plugin")) {
    const plugins = await listCodexPlugins(codexHome, issues);
    const managed = inventoryItemsByKind(inventory, "plugin");
    for (const plugin of plugins) {
      try {
        await linkCodexPlugin(
          plugin.root,
          managed.get(plugin.id)?.enabled ?? plugin.enabled,
          codexHome,
          qivrynHome,
        );
        imported.plugin += 1;
      } catch (error) {
        issues.push(
          `Plugin ${plugin.id} could not be linked: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  if (selected.has("hook")) {
    const sourcePath = path.join(codexHome, "hooks.json");
    if (await exists(sourcePath)) {
      const hookSettings = hookSettingsWithManagedState(
        JSON.parse(await readFile(sourcePath, "utf8")),
        inventory,
      ) as { hooks?: Record<string, unknown> };
      await writeJsonAtomic(path.join(qivrynHome, "hooks.json"), hookSettings);
      const settingsPath = path.join(qivrynHome, "settings.json");
      const settings = (await exists(settingsPath))
        ? JSON.parse(await readFile(settingsPath, "utf8"))
        : {};
      await writeJsonAtomic(settingsPath, {
        ...settings,
        hooks: hookSettings.hooks ?? {},
      });
      imported.hook = inventory.counts.hook;
    }
  }

  if (selected.has("automation")) {
    const automations = await listCodexAutomations(codexHome, issues);
    const managed = inventoryItemsByKind(inventory, "automation");
    const targetPath = path.join(qivrynHome, "agents", "automations.json");
    const existing = (await exists(targetPath))
      ? (JSON.parse(await readFile(targetPath, "utf8")) as Array<{
          id: string;
        }>)
      : [];
    const retained = existing.filter(
      (candidate) => !automations.some((item) => item.id === candidate.id),
    );
    const converted = automations.map((automation) => {
      const createdAt = new Date(
        automation.createdAt ?? Date.now(),
      ).toISOString();
      const updatedAt = new Date(
        automation.updatedAt ?? automation.createdAt ?? Date.now(),
      ).toISOString();
      return {
        id: automation.id,
        revision: 1,
        name: automation.name,
        prompt: automation.prompt,
        repositoryPath: automation.repositoryPath,
        enabled:
          managed.get(automation.id)?.enabled ??
          automation.status.toUpperCase() === "ACTIVE",
        trigger: {
          type: "rrule",
          rrule: automation.rrule,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        model: automation.model,
        permissionMode: "autonomous",
        runtimeId: "local",
        createdAt,
        updatedAt,
        metadata: {
          source: "codex",
          reasoningEffort: automation.reasoningEffort,
          sourcePath: automation.sourcePath,
        },
      };
    });
    await writeJsonAtomic(targetPath, [...retained, ...converted]);
    imported.automation = converted.length;
  }

  if (selected.has("skill")) imported.skill = inventory.counts.skill;
  if (selected.has("rule")) imported.rule = inventory.counts.rule;
  if (selected.has("agent")) imported.agent = inventory.counts.agent;

  const importedItems = inventory.items.map((item) => ({
    ...item,
    state: selected.has(item.kind)
      ? item.kind === "hook" && !item.reviewed
        ? "needs-review"
        : item.kind === "skill" || item.kind === "rule" || item.kind === "agent"
          ? "linked"
          : "imported"
      : item.state,
  })) as CodexImportItem[];
  const finalInventory = { ...inventory, items: importedItems, issues };
  await writeJsonAtomic(importInventoryPath(qivrynHome), finalInventory);
  return { inventory: finalInventory, imported, issues };
}

export async function setCodexImportItemEnabled(
  request: SetCodexImportItemEnabledRequest,
  options: CodexImportOptions = {},
): Promise<ApplyCodexImportResult> {
  const qivrynHome = options.qivrynHome ?? getQivrynGlobalPath();
  const inventory = await scanCodexImport({ ...options, qivrynHome });
  const item = inventory.items.find(
    (candidate) =>
      candidate.kind === request.kind && candidate.id === request.id,
  );
  if (!item)
    throw new Error("The selected Codex capability is no longer available");
  if (!item.canToggle) {
    throw new Error(`${item.name} is linked read-only from Codex`);
  }

  const state = await readImportState(qivrynHome);
  const key = itemKey(request.kind, request.id);
  const reviewed = request.reviewed ?? state.overrides[key]?.reviewed;
  if (request.kind === "hook" && request.enabled && reviewed !== true) {
    throw new Error("Review this hook command before enabling it");
  }
  state.overrides[key] = {
    enabled: request.enabled,
    ...(request.kind === "hook" ? { reviewed: reviewed === true } : {}),
    updatedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(importStatePath(qivrynHome), state);
  return applyCodexImport(
    { kinds: [request.kind] },
    { ...options, qivrynHome },
  );
}

function sourceKeys(sourcePath: string): string[] {
  const resolved = path.resolve(sourcePath);
  return [resolved, pathToFileURL(resolved).toString()];
}

export async function getDisabledCodexImportSourcePaths(
  kind: "skill" | "rule" | "agent",
  qivrynHome = getQivrynGlobalPath(),
): Promise<Set<string>> {
  const inventory = await readImportedInventory(qivrynHome);
  const sources = (inventory?.items ?? [])
    .filter((item) => item.kind === kind && !item.enabled && item.sourcePath)
    .flatMap((item) => sourceKeys(item.sourcePath!));
  return new Set(sources);
}
