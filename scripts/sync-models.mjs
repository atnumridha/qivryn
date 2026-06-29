#!/usr/bin/env node
/**
 * sync-models.mjs
 *
 * Fetches the live model list from both backends and rewrites the
 * ~/.continue/config.yaml models block so Continue always shows the
 * latest available models with correct reasoning levels.
 *
 * Run automatically:  called by setup-continue-providers.sh
 * Run manually:       node ~/Documents/continue/scripts/sync-models.mjs
 *
 * Backends queried:
 *   1. GitHub Copilot CAPI  — ~/.codex/copilot-auth.json
 *   2. ChatGPT Codex backend — ~/.codex/auth.json
 */

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import * as YAML from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CODEX_DIR = path.join(os.homedir(), ".codex");
const CONTINUE_DIR = path.join(os.homedir(), ".continue");
const COPILOT_AUTH_FILE = path.join(CODEX_DIR, "copilot-auth.json");
const CHATGPT_AUTH_FILE = path.join(CODEX_DIR, "auth.json");
const INSTALL_ID_FILE = path.join(CODEX_DIR, "installation_id");
const MODELS_CACHE_FILE = path.join(CODEX_DIR, "models_cache.json");
const CONFIG_SRC = path.join(__dirname, "..", ".continue-config", "config.yaml");
const CONFIG_DST = path.join(CONTINUE_DIR, "config.yaml");
const GLOBAL_CONTEXT_FILE = path.join(CONTINUE_DIR, "index", "globalContext.json");

// ── helpers ──────────────────────────────────────────────────────────────────
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}
function writePrivate(file, data) {
  const tmp = `${file}.sync.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
}
function log(msg) { process.stderr.write(`  ${msg}\n`); }

// ── GitHub Copilot token refresh ─────────────────────────────────────────────
async function freshCopilotToken(auth) {
  const ghToken = auth.github_token || auth.githubAccessToken || "";
  if (!ghToken) return auth.token || auth.copilot_token || "";
  const exp = Number(auth.expires_at || auth.expiresAt || 0);
  const now = Math.floor(Date.now() / 1000);
  if (auth.token && exp && exp - now > 300) return auth.token;
  try {
    const res = await fetch("https://api.github.com/copilot_internal/v2/token", {
      headers: { Authorization: `token ${ghToken}`, Accept: "application/json", "X-GitHub-Api-Version": "2025-04-01" },
    });
    if (!res.ok) return auth.token || "";
    const envelope = await res.json();
    if (envelope.token) {
      const next = { ...auth, token: envelope.token,
        expires_at: Number(envelope.expires_at) || undefined,
        capi_base: envelope.endpoints?.api || auth.capi_base || "https://api.githubcopilot.com",
      };
      writePrivate(COPILOT_AUTH_FILE, next);
      return envelope.token;
    }
  } catch { /* ignore */ }
  return auth.token || "";
}

// ── Fetch Copilot models ──────────────────────────────────────────────────────
async function fetchCopilotModels() {
  const auth = readJson(COPILOT_AUTH_FILE);
  if (!auth) { log("Copilot auth not found — skipping Copilot models"); return []; }
  const token = await freshCopilotToken(auth);
  if (!token) { log("No Copilot token — skipping"); return []; }
  const base = (auth.capiBase || auth.capi_base || auth.endpoints?.api || "https://api.githubcopilot.com").replace(/\/+$/, "");
  const editorVersion = auth.editor_version || auth.editorVersion || "vscode/unknown";
  const pluginVersion = auth.editor_plugin_version || auth.editorPluginVersion || "copilot-chat/continue";
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
    if (!res.ok) { log(`Copilot /models returned ${res.status}`); return []; }
    const data = await res.json();
    const all = Array.isArray(data) ? data : (data.data || []);
    // Only picker-enabled models, not embeddings/trajectory-compaction
    return all.filter(m => m.model_picker_enabled && !m.id?.startsWith("text-embedding") && m.id !== "trajectory-compaction");
  } catch (e) { log(`Copilot fetch error: ${e.message}`); return []; }
}

// ── Fetch ChatGPT Codex models ────────────────────────────────────────────────
async function fetchCodexModels() {
  const auth = readJson(CHATGPT_AUTH_FILE);
  if (!auth || auth.auth_mode !== "chatgpt") { log("ChatGPT auth not found — skipping Codex models"); return []; }
  const token = auth.tokens?.access_token || "";
  if (!token) { log("No ChatGPT token"); return []; }
  const installId = fs.existsSync(INSTALL_ID_FILE) ? fs.readFileSync(INSTALL_ID_FILE, "utf8").trim() : "";
  const clientVersion = readJson(MODELS_CACHE_FILE)?.client_version || "0.140.0";
  try {
    const res = await fetch(`https://chatgpt.com/backend-api/codex/models?client_version=${encodeURIComponent(clientVersion)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(installId ? { "x-codex-installation-id": installId } : {}),
      },
    });
    if (!res.ok) { log(`Codex /models returned ${res.status}`); return []; }
    const data = await res.json();
    return (data.models || []).filter(m => m.slug && !["codex-auto-review", "trajectory-compaction"].includes(m.slug));
  } catch (e) { log(`Codex fetch error: ${e.message}`); return []; }
}

// ── Convert to config.yaml model entries ─────────────────────────────────────
function copilotModelEntry(m) {
  const slug = m.id;
  const name = m.name || slug;
  const endpoints = m.supported_endpoints || [];
  const caps = m.capabilities?.supports || {};
  const reasoningLevels = caps.reasoning_effort || [];
  const hasTools = caps.tool_calls !== false;
  const hasVision = !!caps.vision;

  // Routing: Claude/Gemini use chat/completions; GPT with /responses use responses
  const useChat = endpoints.some(e => e === "/chat/completions" || e === "/v1/messages") && !endpoints.includes("/responses");

  const roles = ["chat", "edit", "apply"];
  if (slug.includes("mini") || slug.includes("haiku") || slug.includes("flash")) roles.push("subagent");
  else roles.push("summarize");

  const capabilities = [];
  if (hasTools) capabilities.push("tool_use");
  if (hasVision) capabilities.push("image_input");

  const entry = {
    name: `Copilot: ${name}`,
    provider: "github-copilot",
    model: slug,
    apiBase: "https://api.githubcopilot.com/",
    roles,
    capabilities: capabilities.length ? capabilities : undefined,
  };

  if (reasoningLevels.length) {
    entry.defaultCompletionOptions = { reasoning: true };
    entry._reasoningLevels = reasoningLevels; // metadata only, stripped before write
  }

  return entry;
}

function codexModelEntry(m) {
  const slug = m.slug;
  const name = m.display_name || slug;
  const reasoningLevels = (m.supported_reasoning_levels || []).map(r => r.effort || r);
  const defaultReasoning = m.default_reasoning_level || (reasoningLevels.includes("medium") ? "medium" : reasoningLevels[0] || null);

  const roles = ["chat", "edit", "apply"];
  if (slug.includes("mini") || slug.includes("luna")) roles.push("subagent");
  else roles.push("summarize");

  const entry = {
    name: `Codex: ${name}`,
    provider: "chatgpt-codex",
    model: slug,
    apiBase: "https://chatgpt.com/backend-api/codex/",
    roles,
    capabilities: ["tool_use", "image_input"],
  };

  if (reasoningLevels.length && defaultReasoning) {
    entry.defaultCompletionOptions = {
      reasoning: true,
      // store the default as a requestOptions extra body property
    };
    entry.requestOptions = {
      extraBodyProperties: { reasoning_effort: defaultReasoning },
    };
  }

  return entry;
}

// ── Build the full model list ─────────────────────────────────────────────────
async function buildModelList(copilotModels, codexModels) {
  const models = [];

  // Codex models first (newest frontier models)
  for (const m of codexModels) {
    models.push(codexModelEntry(m));
  }

  // Codex autocomplete
  const autocompleteCodex = codexModels.find(m => m.slug?.includes("mini")) || codexModels[0];
  if (autocompleteCodex) {
    models.push({
      name: "Codex Autocomplete",
      provider: "chatgpt-codex",
      model: autocompleteCodex.slug,
      apiBase: "https://chatgpt.com/backend-api/codex/",
      roles: ["autocomplete"],
    });
  }

  // Copilot models
  for (const m of copilotModels) {
    const entry = copilotModelEntry(m);
    delete entry._reasoningLevels;
    models.push(entry);
  }

  // Copilot autocomplete (prefer gpt-5.4-mini or gpt-5-mini)
  const copilotAutoModel = copilotModels.find(m => m.id === "gpt-5.4-mini") || copilotModels.find(m => m.id?.includes("mini")) || copilotModels[0];
  if (copilotAutoModel) {
    models.push({
      name: "Copilot Autocomplete",
      provider: "github-copilot",
      model: copilotAutoModel.id,
      apiBase: "https://api.githubcopilot.com/",
      roles: ["autocomplete"],
    });
  }

  // OCA models (static — no live endpoint available without VPN)
  models.push(
    { name: "OCA: gpt-5.3-codex", provider: "oca", model: "oca/gpt-5.3-codex", apiBase: "https://code-internal.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm/v1/", roles: ["chat", "edit", "apply"], capabilities: ["tool_use"] },
    { name: "OCA: gpt-4.1", provider: "oca", model: "oca/gpt-4.1", apiBase: "https://code-internal.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm/v1/", roles: ["chat", "edit", "apply", "summarize"], capabilities: ["tool_use"] },
    { name: "OCA: gpt-4o", provider: "oca", model: "oca/gpt-4o", apiBase: "https://code-internal.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm/v1/", roles: ["chat", "edit", "apply"], capabilities: ["tool_use"] },
    { name: "OCA Autocomplete", provider: "oca", model: "oca/gpt-4o-mini", apiBase: "https://code-internal.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm/v1/", roles: ["autocomplete"] },
  );

  return models;
}

// ── Write config.yaml ─────────────────────────────────────────────────────────
function writeConfig(models) {
  // Read existing config to preserve non-model sections
  let base;
  try { base = YAML.parse(fs.readFileSync(CONFIG_DST, "utf8")); } catch { base = {}; }

  // Merge: replace models block, keep context/rules/env
  base.name = "Continue with ChatGPT Codex, Copilot and OCA";
  base.version = "1.0.0";
  base.schema = "v1";
  base.models = models.map(m => {
    // Strip undefined values for clean YAML
    return Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined));
  });

  const yaml = YAML.stringify(base, { lineWidth: 120, defaultKeyType: "PLAIN", defaultStringType: "QUOTE_DOUBLE" });

  // Write to both locations
  fs.mkdirSync(CONTINUE_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_DST, yaml);
  // Also keep source in sync
  try { fs.mkdirSync(path.dirname(CONFIG_SRC), { recursive: true }); fs.writeFileSync(CONFIG_SRC, yaml); } catch { /* ok */ }
}

// ── Clear stale model selections so extension picks fresh ones ────────────────
function clearStaleSelections() {
  try {
    if (!fs.existsSync(GLOBAL_CONTEXT_FILE)) return;
    const ctx = JSON.parse(fs.readFileSync(GLOBAL_CONTEXT_FILE, "utf8"));
    if (ctx.selectedModelsByProfileId) {
      ctx.selectedModelsByProfileId = {};
    }
    fs.writeFileSync(GLOBAL_CONTEXT_FILE, JSON.stringify(ctx, null, 2));
  } catch { /* ignore */ }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  log("Syncing models from live backends...");

  const [copilotModels, codexModels] = await Promise.all([
    fetchCopilotModels(),
    fetchCodexModels(),
  ]);

  log(`Copilot: ${copilotModels.length} models`);
  log(`ChatGPT Codex: ${codexModels.length} models`);

  if (copilotModels.length === 0 && codexModels.length === 0) {
    log("No models fetched from either backend — keeping existing config");
    process.exit(0);
  }

  const models = await buildModelList(copilotModels, codexModels);
  log(`Total models built: ${models.length}`);

  writeConfig(models);
  clearStaleSelections();

  log(`Config written: ${CONFIG_DST}`);
  log("Model selections cleared — reload VS Code to apply");
}

main().catch(e => { process.stderr.write(`Error: ${e.message}\n`); process.exit(1); });
