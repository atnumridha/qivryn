#!/usr/bin/env node
/**
 * sync-models.mjs
 *
 * Fetches live models from both backends and writes ~/.qivryn/config.yaml.
 *
 * For models that support reasoning levels, ONE ENTRY PER REASONING LEVEL is
 * generated so the user can switch reasoning directly from Qivryn's model
 * picker (e.g. "Codex: GPT-5.6-Sol (high)" vs "Codex: GPT-5.6-Sol (max)").
 *
 * Run:  node ~/Documents/qivryn/scripts/sync-models.mjs
 * Auto: called by setup-qivryn-providers.sh on every invocation
 */

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import * as YAML from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CODEX_DIR = path.join(os.homedir(), ".codex");
const QIVRYN_DIR = path.join(os.homedir(), ".qivryn");
const COPILOT_AUTH_FILE = path.join(CODEX_DIR, "copilot-auth.json");
const CHATGPT_AUTH_FILE = path.join(CODEX_DIR, "auth.json");
const INSTALL_ID_FILE = path.join(CODEX_DIR, "installation_id");
const MODELS_CACHE_FILE = path.join(CODEX_DIR, "models_cache.json");
const CONFIG_SRC = path.join(__dirname, "..", ".qivryn-config", "config.yaml");
const CONFIG_DST = path.join(QIVRYN_DIR, "config.yaml");
const GLOBAL_CTX_FILE = path.join(QIVRYN_DIR, "index", "globalContext.json");

const LEGACY_DEFAULT_RULES = new Set([
  "You are a precise software engineering assistant. Think carefully before making changes.",
  "Prefer minimal, targeted edits. Always explain your reasoning concisely.",
  "When using tools, be explicit about which file and line you are editing.",
]);

export function removeLegacyDefaultRules(config) {
  if (!Array.isArray(config?.rules)) return config;

  const rules = config.rules.filter(
    (rule) => typeof rule !== "string" || !LEGACY_DEFAULT_RULES.has(rule),
  );
  if (rules.length > 0) config.rules = rules;
  else delete config.rules;
  return config;
}

// Reasoning level labels shown in the model picker
const REASONING_LABELS = {
  none: "off",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
  ultra: "ultra",
};

// For Codex backend: which level is the default (shown without a suffix)
const CODEX_DEFAULT_EFFORT = "medium";

// For Copilot: which level is the default
const COPILOT_DEFAULT_EFFORT = "medium";

// ── helpers ───────────────────────────────────────────────────────────────────
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
function writePrivate(file, data) {
  const tmp = `${file}.sync.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
}
function log(msg) {
  process.stderr.write(`  ${msg}\n`);
}

// ── Copilot bearer token refresh ──────────────────────────────────────────────
async function freshCopilotToken(auth) {
  const ghToken = auth.github_token || auth.githubAccessToken || "";
  const exp = Number(auth.expires_at || auth.expiresAt || 0);
  const now = Math.floor(Date.now() / 1000);
  if (auth.token && exp && exp - now > 300) return auth.token;
  if (!ghToken) return auth.token || auth.copilot_token || "";
  try {
    const res = await fetch(
      "https://api.github.com/copilot_internal/v2/token",
      {
        headers: {
          Authorization: `token ${ghToken}`,
          Accept: "application/json",
          "X-GitHub-Api-Version": "2025-04-01",
        },
      },
    );
    if (!res.ok) return auth.token || "";
    const envelope = await res.json();
    if (envelope.token) {
      const next = {
        ...auth,
        token: envelope.token,
        expires_at: Number(envelope.expires_at) || undefined,
        capi_base:
          envelope.endpoints?.api ||
          auth.capi_base ||
          "https://api.githubcopilot.com",
        capiBase:
          envelope.endpoints?.api ||
          auth.capiBase ||
          "https://api.githubcopilot.com",
        endpoints: envelope.endpoints || auth.endpoints || {},
      };
      writePrivate(COPILOT_AUTH_FILE, next);
      return envelope.token;
    }
  } catch {
    /* ignore */
  }
  return auth.token || "";
}

// ── Fetch Copilot models ──────────────────────────────────────────────────────
async function fetchCopilotModels() {
  const auth = readJson(COPILOT_AUTH_FILE);
  if (!auth) {
    log("Copilot auth not found — skipping");
    return [];
  }
  const token = await freshCopilotToken(auth);
  if (!token) {
    log("No Copilot token — skipping");
    return [];
  }
  const base = (
    auth.capiBase ||
    auth.capi_base ||
    auth.endpoints?.api ||
    "https://api.githubcopilot.com"
  ).replace(/\/+$/, "");
  const editorVersion =
    auth.editor_version || auth.editorVersion || "vscode/unknown";
  const pluginVersion =
    auth.editor_plugin_version ||
    auth.editorPluginVersion ||
    "copilot-chat/qivryn";
  try {
    const res = await fetch(`${base}/models`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Copilot-Integration-Id": "vscode-chat",
        "Editor-Version": editorVersion,
        "Editor-Plugin-Version": pluginVersion,
        "X-GitHub-Api-Version": "2026-06-01",
        "OpenAI-Intent": "model-access",
        "X-Interaction-Type": "model-access",
      },
    });
    if (!res.ok) {
      log(`Copilot /models → ${res.status}`);
      return [];
    }
    const data = await res.json();
    const all = Array.isArray(data) ? data : data.data || [];
    return all.filter(
      (m) =>
        m.model_picker_enabled &&
        !m.id?.startsWith("text-embedding") &&
        m.id !== "trajectory-compaction",
    );
  } catch (e) {
    log(`Copilot fetch: ${e.message}`);
    return [];
  }
}

// ── Fetch ChatGPT Codex models ────────────────────────────────────────────────
async function fetchCodexModels() {
  const auth = readJson(CHATGPT_AUTH_FILE);
  if (!auth || auth.auth_mode !== "chatgpt") {
    log("ChatGPT auth not found — skipping");
    return [];
  }
  const token = auth.tokens?.access_token || "";
  if (!token) {
    log("No ChatGPT access token");
    return [];
  }
  const installId = fs.existsSync(INSTALL_ID_FILE)
    ? fs.readFileSync(INSTALL_ID_FILE, "utf8").trim()
    : "";
  const clientVersion =
    readJson(MODELS_CACHE_FILE)?.client_version || "0.140.0";
  try {
    const res = await fetch(
      `https://chatgpt.com/backend-api/codex/models?client_version=${encodeURIComponent(clientVersion)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(installId ? { "x-codex-installation-id": installId } : {}),
        },
      },
    );
    if (!res.ok) {
      log(`Codex /models → ${res.status}`);
      return [];
    }
    const data = await res.json();
    return (data.models || []).filter(
      (m) =>
        m.slug &&
        !["codex-auto-review", "trajectory-compaction"].includes(m.slug),
    );
  } catch (e) {
    log(`Codex fetch: ${e.message}`);
    return [];
  }
}

// ── Model entry builders ──────────────────────────────────────────────────────

/** One config.yaml model entry, optionally locked to a specific reasoning level */
function makeEntry({
  name,
  provider,
  model,
  apiBase,
  roles,
  capabilities,
  reasoningEffort,
}) {
  const entry = { name, provider, model, apiBase, roles };
  if (capabilities?.length) entry.capabilities = capabilities;
  if (reasoningEffort) {
    entry.requestOptions = {
      extraBodyProperties: { reasoning_effort: reasoningEffort },
    };
  }
  return entry;
}

function copilotEntries(m) {
  const slug = m.id;
  const name = m.name || slug;
  const caps = m.capabilities?.supports || {};
  const reasoningLevels = caps.reasoning_effort || [];
  const hasTools = caps.tool_calls !== false;
  const hasVision = !!caps.vision;

  const roles = ["chat", "edit", "apply"];
  if (slug.includes("mini") || slug.includes("haiku") || slug.includes("flash"))
    roles.push("subagent");
  else roles.push("summarize");

  const capabilities = [];
  if (hasTools) capabilities.push("tool_use");
  if (hasVision) capabilities.push("image_input");

  const defaultEffort = reasoningLevels.includes(COPILOT_DEFAULT_EFFORT)
    ? COPILOT_DEFAULT_EFFORT
    : reasoningLevels[0] || null;

  const entry = makeEntry({
    name: `Copilot: ${name}`,
    provider: "github-copilot",
    model: slug,
    apiBase: "https://api.githubcopilot.com/",
    roles,
    capabilities,
    reasoningEffort: defaultEffort,
  });

  // Store available levels as metadata for the UI reasoning picker
  if (reasoningLevels.length > 0) {
    entry.requestOptions = {
      ...(entry.requestOptions || {}),
      extraBodyProperties: {
        ...(entry.requestOptions?.extraBodyProperties || {}),
        reasoning_effort: defaultEffort,
        _reasoningLevels: reasoningLevels,
      },
    };
  }

  return [entry];
}

function codexEntries(m) {
  const slug = m.slug;
  const name = m.display_name || slug;
  const reasoningLevels = (m.supported_reasoning_levels || [])
    .map((r) => (typeof r === "object" ? r.effort : r))
    .filter(Boolean);

  const roles = ["chat", "edit", "apply"];
  if (slug.includes("mini") || slug.includes("luna")) roles.push("subagent");
  else roles.push("summarize");

  const defaultEffort = reasoningLevels.includes(CODEX_DEFAULT_EFFORT)
    ? CODEX_DEFAULT_EFFORT
    : reasoningLevels[0] || null;

  const entry = makeEntry({
    name: `Codex: ${name}`,
    provider: "chatgpt-codex",
    model: slug,
    apiBase: "https://chatgpt.com/backend-api/codex/",
    roles,
    capabilities: ["tool_use", "image_input"],
    reasoningEffort: defaultEffort,
  });

  // Store available levels as metadata for the UI reasoning picker
  if (reasoningLevels.length > 0) {
    entry.requestOptions = {
      ...(entry.requestOptions || {}),
      extraBodyProperties: {
        ...(entry.requestOptions?.extraBodyProperties || {}),
        reasoning_effort: defaultEffort,
        _reasoningLevels: reasoningLevels,
      },
    };
  }

  return [entry];
}

// ── Build full model list ─────────────────────────────────────────────────────
async function buildModelList(copilotModels, codexModels) {
  const models = [];

  // ChatGPT Codex models (newest frontier first)
  for (const m of codexModels) {
    models.push(...codexEntries(m));
  }

  // Codex autocomplete — use the default (medium) entry of the smallest model
  const codexAutoBase =
    codexModels.find((m) => m.slug?.includes("mini")) ||
    codexModels.find((m) => m.slug?.includes("luna")) ||
    codexModels[0];
  if (codexAutoBase) {
    models.push(
      makeEntry({
        name: "Codex Autocomplete",
        provider: "chatgpt-codex",
        model: codexAutoBase.slug,
        apiBase: "https://chatgpt.com/backend-api/codex/",
        roles: ["autocomplete"],
        reasoningEffort: CODEX_DEFAULT_EFFORT,
      }),
    );
  }

  // GitHub Copilot models
  for (const m of copilotModels) {
    models.push(...copilotEntries(m));
  }

  // Copilot autocomplete
  const copilotAutoBase =
    copilotModels.find((m) => m.id === "gpt-5.4-mini") ||
    copilotModels.find((m) => m.id?.includes("mini")) ||
    copilotModels[0];
  if (copilotAutoBase) {
    models.push(
      makeEntry({
        name: "Copilot Autocomplete",
        provider: "github-copilot",
        model: copilotAutoBase.id,
        apiBase: "https://api.githubcopilot.com/",
        roles: ["autocomplete"],
      }),
    );
  }

  // OCA models (static)
  const ocaBase =
    "https://code-internal.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm/v1/";
  models.push(
    makeEntry({
      name: "OCA: gpt-5.3-codex",
      provider: "oca",
      model: "oca/gpt-5.3-codex",
      apiBase: ocaBase,
      roles: ["chat", "edit", "apply"],
      capabilities: ["tool_use"],
    }),
    makeEntry({
      name: "OCA: gpt-4.1",
      provider: "oca",
      model: "oca/gpt-4.1",
      apiBase: ocaBase,
      roles: ["chat", "edit", "apply", "summarize"],
      capabilities: ["tool_use"],
    }),
    makeEntry({
      name: "OCA: gpt-4o",
      provider: "oca",
      model: "oca/gpt-4o",
      apiBase: ocaBase,
      roles: ["chat", "edit", "apply"],
      capabilities: ["tool_use"],
    }),
    makeEntry({
      name: "OCA Autocomplete",
      provider: "oca",
      model: "oca/gpt-4o-mini",
      apiBase: ocaBase,
      roles: ["autocomplete"],
    }),
  );

  return models;
}

// ── Write config.yaml ─────────────────────────────────────────────────────────
function writeConfig(models) {
  let base;
  try {
    base = YAML.parse(fs.readFileSync(CONFIG_DST, "utf8"));
  } catch {
    base = {};
  }

  base.name = "Qivryn — ChatGPT Codex, Copilot, OCA (auto-synced)";
  base.version = "1.0.0";
  base.schema = "v1";
  base.models = models.map((m) =>
    Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined)),
  );
  removeLegacyDefaultRules(base);
  if (!base.context)
    base.context = [
      { provider: "code" },
      { provider: "docs" },
      { provider: "diff" },
      { provider: "terminal" },
      { provider: "problems" },
      { provider: "folder" },
      { provider: "codebase" },
    ];
  if (!base.env) base.env = ["OCA_API_KEY"];

  const yaml = YAML.stringify(base, {
    lineWidth: 140,
    defaultKeyType: "PLAIN",
    defaultStringType: "QUOTE_DOUBLE",
  });
  fs.mkdirSync(QIVRYN_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_DST, yaml);
  try {
    fs.mkdirSync(path.dirname(CONFIG_SRC), { recursive: true });
    fs.writeFileSync(CONFIG_SRC, yaml);
  } catch {
    /* ok */
  }
}

// ── Clear stale selections ────────────────────────────────────────────────────
function clearStaleSelections() {
  try {
    if (!fs.existsSync(GLOBAL_CTX_FILE)) return;
    const ctx = JSON.parse(fs.readFileSync(GLOBAL_CTX_FILE, "utf8"));
    ctx.selectedModelsByProfileId = {};
    fs.writeFileSync(GLOBAL_CTX_FILE, JSON.stringify(ctx, null, 2));
  } catch {
    /* ignore */
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  log("Syncing models from live backends...");

  const [copilotModels, codexModels] = await Promise.all([
    fetchCopilotModels(),
    fetchCodexModels(),
  ]);

  log(`Copilot: ${copilotModels.length} picker models`);
  log(`ChatGPT Codex: ${codexModels.length} models`);

  if (copilotModels.length === 0 && codexModels.length === 0) {
    log("No models fetched — keeping existing config unchanged");
    process.exit(0);
  }

  const models = await buildModelList(copilotModels, codexModels);
  log(
    `Expanded to ${models.length} entries (including per-reasoning variants)`,
  );

  writeConfig(models);
  clearStaleSelections();
  log(`Written: ${CONFIG_DST}`);
  log("Reload VS Code (Developer: Reload Window) to apply");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((e) => {
    process.stderr.write(`sync-models error: ${e.message}\n`);
    process.exit(1);
  });
}
