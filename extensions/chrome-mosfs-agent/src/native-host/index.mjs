#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

const WORKSPACE_ROOT = "/Users/amridha/Documents/MOS_Automations";
const MOSFS_SKILL_ROOT = process.env.MOSFS_SKILL_ROOT || "/Users/amridha/.codex/skills/mosfs";
const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const CODEX_CONFIG = path.join(CODEX_HOME, "config.toml");
const CODEX_MODELS_CACHE = path.join(CODEX_HOME, "models_cache.json");
const PLUGIN_CACHE_ROOT = path.join(CODEX_HOME, "plugins", "cache");
const ARTIFACT_ROOT = path.join(WORKSPACE_ROOT, "artifacts", "mosfs-chrome-agent");
const RUN_ROOT = path.join(ARTIFACT_ROOT, "runs");
const LOG_FILE = path.join(ARTIFACT_ROOT, "logs", "native-host.log");
const DEFAULT_MODEL = "gpt-5.5";
const DEFAULT_REASONING_EFFORT = "medium";
const QIVRYN_ROOT = "/Users/amridha/Documents/qivryn";
const QIVRYN_GLOBAL_DIR = process.env.QIVRYN_GLOBAL_DIR || path.join(os.homedir(), ".qivryn");
const QIVRYN_DAEMON_DESCRIPTOR = path.join(QIVRYN_GLOBAL_DIR, "agents", "daemon.json");
const QIVRYN_AGENT_PROTOCOL_VERSION = 7;
const QIVRYN_CLI = process.env.QIVRYN_CLI_PATH || path.join(QIVRYN_ROOT, "extensions", "cli", "dist", "qivryn.js");
const QIVRYN_REVIEW_ENGINE = path.join(QIVRYN_ROOT, "packages", "review-engine", "dist", "index.js");
const DEFAULT_QIVRYN_MODEL = "gpt-5.5";
const MAX_RESPONSE_TEXT_CHARS = 260000;
const MAX_PROMPT_EVIDENCE_CHARS = 180000;
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const AGENT_COMMAND_TIMEOUT_MS = 3 * 60 * 1000;
const FOLDER_PICKER_TIMEOUT_MS = 175000;
const MCP_PROTOCOL_VERSION = "2024-11-05";
const MCP_DEFAULT_TIMEOUT_MS = 120000;
const AGENT_TERMINAL_STATUSES = new Set(["completed", "failed", "canceled", "archived"]);

const MOSFS_SCRIPTS = {
  fetch_sr: path.join(MOSFS_SKILL_ROOT, "scripts", "fetch_sr.py"),
  update_sr: path.join(MOSFS_SKILL_ROOT, "scripts", "update_sr.py"),
  fetch_kb: path.join(MOSFS_SKILL_ROOT, "scripts", "fetch_kb.py"),
  search_srs: path.join(MOSFS_SKILL_ROOT, "scripts", "search_srs.py"),
  fetch_my_srs: path.join(MOSFS_SKILL_ROOT, "scripts", "fetch_my_srs.py"),
};

const UPDATE_FLAGS_WITH_VALUE = new Set([
  "--action-plan",
  "--action-plan-file",
  "--public-note",
  "--public-note-file",
  "--issue-question",
  "--issue-question-file",
  "--call-outbound",
  "--call-outbound-file",
  "--customer-cause",
  "--customer-cause-file",
  "--solution-answer",
  "--solution-answer-file",
  "--internal-note",
  "--internal-note-file",
  "--internal-note-subtype",
  "--message",
  "--message-file",
  "--message-type",
  "--message-subtype",
  "--message-visibility",
  "--update-message-id",
  "--set-message-visibility",
  "--eos-accomplished-actions",
  "--eos-pending-actions",
  "--eos-warm-handoff",
  "--substatus",
  "--status",
]);

const UPDATE_FLAGS_NO_VALUE = new Set([
  "--dry-run",
  "--json",
  "--allow-duplicate",
  "--confirm-action-plan",
  "--confirm-resolve",
  "--assign-to-self",
  "--standard-public-note",
  "--eos-note",
  "--resolve-with-solution",
  "--force-refresh-auth",
  "--restart-chrome",
]);

const WRITE_FLAGS = new Set([
  "--action-plan",
  "--action-plan-file",
  "--public-note",
  "--public-note-file",
  "--issue-question",
  "--issue-question-file",
  "--call-outbound",
  "--call-outbound-file",
  "--customer-cause",
  "--customer-cause-file",
  "--solution-answer",
  "--solution-answer-file",
  "--internal-note",
  "--internal-note-file",
  "--message",
  "--message-file",
  "--set-message-visibility",
  "--substatus",
  "--status",
  "--assign-to-self",
  "--standard-public-note",
  "--eos-note",
  "--resolve-with-solution",
]);

let pending = Buffer.alloc(0);

mkdirSync(path.dirname(LOG_FILE), { recursive: true });
log(`native host started pid=${process.pid}`);

process.on("uncaughtException", (error) => {
  log(`uncaughtException: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  writeMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
});

process.on("unhandledRejection", (error) => {
  log(`unhandledRejection: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  writeMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
});

process.stdin.on("data", (chunk) => {
  pending = Buffer.concat([pending, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
  readFrames().catch((error) => writeMessage({ ok: false, error: error.message || String(error) }));
});

async function readFrames() {
  while (pending.length >= 4) {
    const length = pending.readUInt32LE(0);
    if (pending.length < 4 + length) return;
    const body = pending.subarray(4, 4 + length);
    pending = pending.subarray(4 + length);
    const message = JSON.parse(body.toString("utf8"));
    log(`message ${message.type || "unknown"}`);
    let response;
    try {
      response = await handleMessage(message);
    } catch (error) {
      response = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    writeMessage({ id: message.id, ...response });
  }
}

async function handleMessage(message) {
  switch (message.type) {
    case "status":
      return status();
    case "list_models":
      return listModels();
    case "inventory":
      return { ok: true, inventory: buildCodexInventory() };
    case "agent_status":
      return qivrynAgentStatusAction();
    case "agent_message":
      return qivrynAgentMessageAction(message);
    case "agent_events":
      return qivrynAgentEventsAction(message);
    case "select_folder":
      return selectFolderAction(message);
    case "qivryn_review":
      return qivrynReviewAction(message);
    case "list_mcp_tools":
      return listMcpToolsAction(message);
    case "call_mcp_tool":
      return callMcpToolAction(message);
    case "fetch_sr":
      return fetchSrAction(message);
    case "analyze_sr":
      return analyzeSrAction(message);
    case "ask":
      return askAction(message);
    case "dry_run_action_plan":
      return updateActionPlanAction(message, true);
    case "post_action_plan":
      return updateActionPlanAction(message, false);
    case "run_mosfs_tool":
      return runMosfsToolAction(message);
    default:
      return { ok: false, error: `Unknown message type: ${message.type}` };
  }
}

async function status() {
  const codex = readCodexConfig({ includeToken: false });
  const inventory = buildCodexInventory({ includeSkills: false });
  const qivrynAgent = await qivrynAgentStatusSummary();
  return {
    ok: true,
    workspaceRoot: WORKSPACE_ROOT,
    mosfsSkillRoot: MOSFS_SKILL_ROOT,
    artifactRoot: ARTIFACT_ROOT,
    defaultModel: DEFAULT_MODEL,
    defaultReasoningEffort: DEFAULT_REASONING_EFFORT,
    qivrynAgentState: qivrynAgent.state,
    qivrynAgent,
    codexAuth: codex.ok ? "available" : "missing",
    codexAuthDetail: codex.ok ? codex.authMode || "unknown" : codex.error,
    codexConfig: inventory.config,
    mcpServerCount: inventory.mcpServers.length,
    enabledPluginCount: inventory.plugins.filter((plugin) => plugin.enabled !== false).length,
    helpers: Object.fromEntries(Object.entries(MOSFS_SCRIPTS).map(([key, value]) => [key, existsSync(value)])),
  };
}

async function listModels() {
  const codex = readCodexConfig({ includeToken: true });
  if (!codex.ok) return cachedModelsOrError(codex.error);
  const url = `https://chatgpt.com/backend-api/codex/models?client_version=${encodeURIComponent(codex.clientVersion || "")}`;
  let response;
  let text = "";
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${codex.accessToken}`,
        "x-codex-installation-id": codex.installationId,
      },
    });
    text = await response.text();
  } catch (error) {
    return cachedModelsOrError(`Codex models request failed: ${error.message || String(error)}`);
  }
  if (!response.ok) {
    return cachedModelsOrError(`Codex models request failed: HTTP ${response.status}`, sanitize(text).slice(0, 4000));
  }
  const json = JSON.parse(text);
  const models = normalizeCodexModels(json.models);
  if (!models.length) return cachedModelsOrError("Codex models request returned no models.");
  return {
    ok: true,
    source: "codex-backend",
    models,
  };
}

function cachedModelsOrError(error, detail = "") {
  const cached = readCodexModelsCache();
  if (cached.ok) {
    return {
      ok: true,
      source: "codex-models-cache",
      warning: sanitize(error),
      detail,
      models: cached.models,
    };
  }
  return {
    ok: false,
    error: sanitize(error),
    detail,
    cacheError: cached.error,
  };
}

function readCodexModelsCache() {
  try {
    const json = JSON.parse(readFileSync(CODEX_MODELS_CACHE, "utf8"));
    const models = normalizeCodexModels(json.models);
    if (!models.length) throw new Error("models_cache.json contains no models");
    return {
      ok: true,
      source: "codex-models-cache",
      clientVersion: json.client_version || "",
      fetchedAt: json.fetched_at || "",
      models,
    };
  } catch (error) {
    return { ok: false, error: `Codex models cache is not available: ${error.message || String(error)}` };
  }
}

function normalizeCodexModels(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const slug = String(item?.slug || item?.id || item?.model || "").trim();
      const displayName = String(item?.display_name || item?.displayName || item?.name || slug).trim();
      const contextLength = Number(
        item?.context_window ||
          item?.contextLength ||
          item?.context_length ||
          item?.max_context_tokens ||
          0,
      );
      return {
        displayName: displayName || slug,
        slug,
        contextLength: Number.isFinite(contextLength) && contextLength > 0 ? contextLength : undefined,
      };
    })
    .filter((model) => model.slug);
}

async function fetchSrAction(message) {
  const srNumber = requireSrNumber(message);
  const liveEvidence = liveSrMarkdownFromMessage(message);
  if (liveEvidence) {
    return {
      ok: true,
      srNumber,
      source: "active-tab-live-session",
      stdout: liveEvidence,
      stderr: "",
      artifacts: null,
      exitCode: 0,
    };
  }
  const result = await runMosfsScript("fetch_sr", ["-r", srNumber], { label: `fetch-${srNumber}` });
  return { ok: result.ok, srNumber, command: result.command, stdout: result.stdout, stderr: result.stderr, artifacts: result.artifacts, exitCode: result.exitCode };
}

async function analyzeSrAction(message) {
  const srNumber = requireSrNumber(message);
  const model = safeModel(message.model);
  const reasoningEffort = safeReasoningEffort(message.reasoningEffort);
  let fetchResult = liveFetchResultFromMessage(message);
  if (!fetchResult) {
    fetchResult = await runMosfsScript("fetch_sr", ["-r", srNumber], { label: `analyze-fetch-${srNumber}` });
  }
  if (!fetchResult.ok) {
    return { ok: false, srNumber, error: "Live SR fetch failed; analysis was not generated.", fetch: fetchResult };
  }
  const fetchedEvidence = fetchResult.stdout || "";
  const prompt = [
    `Analyze MOSFS SR ${srNumber} using only the fetched SR markdown and active tab context below.`,
    "Return concise internal engineering analysis plus a customer-safe next-action draft when useful.",
    "Do not claim any write/update occurred.",
    message.prompt ? `User request: ${message.prompt}` : "",
    activeTabBlock(message.tabContext),
    "Fetched SR markdown:",
    fetchedEvidence,
  ].filter(Boolean).join("\n\n");
  const ai = await callCodexResponses({ model, reasoningEffort, prompt });
  return {
    ok: ai.ok,
    srNumber,
    model,
    reasoningEffort,
    analysis: ai.text,
    ai,
    fetch: {
      ok: fetchResult.ok,
      command: fetchResult.command,
      artifacts: fetchResult.artifacts,
      stdout: fetchResult.stdout,
      stderr: fetchResult.stderr,
      exitCode: fetchResult.exitCode,
    },
  };
}

async function askAction(message) {
  const model = safeModel(message.model);
  const reasoningEffort = safeReasoningEffort(message.reasoningEffort);
  const srNumber = extractSrNumber(message.srNumber || message.tabContext?.url || message.prompt || "");
  let evidence = "";
  let fetchResult = liveFetchResultFromMessage(message);
  if (srNumber && message.includeLiveSr !== false) {
    if (!fetchResult) {
      fetchResult = await runMosfsScript("fetch_sr", ["-r", srNumber], { label: `ask-fetch-${srNumber}` });
    }
    if (fetchResult.ok) evidence = fetchResult.stdout;
  }
  const prompt = [
    message.prompt || "Review the active MOSFS context.",
    srNumber ? `Detected SR: ${srNumber}` : "No SR number was detected.",
    activeTabBlock(message.tabContext),
    evidence ? `Live SR evidence:\n\n${evidence}` : "Live SR evidence was not fetched or not available.",
  ].join("\n\n");
  const ai = await callCodexResponses({ model, reasoningEffort, prompt });
  return { ok: ai.ok, srNumber, model, reasoningEffort, answer: ai.text, ai, fetch: fetchResult };
}

async function updateActionPlanAction(message, dryRun) {
  const srNumber = requireSrNumber(message);
  const text = requireNonEmpty(message.actionPlan || message.text, "Action Plan text is required.");
  const args = [srNumber, "--action-plan", text, "--json"];
  if (dryRun) {
    args.push("--dry-run");
  } else {
    requireTypedConfirmation(message, srNumber, "POST");
    args.push("--confirm-action-plan");
  }
  const result = await runMosfsScript("update_sr", args, { label: `${dryRun ? "dry-run-action-plan" : "post-action-plan"}-${srNumber}` });
  return {
    ok: result.ok,
    srNumber,
    dryRun,
    command: result.command,
    stdout: result.stdout,
    stderr: result.stderr,
    artifacts: result.artifacts,
    exitCode: result.exitCode,
  };
}

async function runMosfsToolAction(message) {
  const tool = String(message.tool || "");
  if (!Object.hasOwn(MOSFS_SCRIPTS, tool)) {
    return { ok: false, error: `Unsupported MOSFS tool: ${tool}` };
  }
  const args = Array.isArray(message.args) ? message.args.map((arg) => String(arg)) : [];
  validateToolArgs(tool, args, message);
  const srNumber = args.find((arg) => /^(\d|[34])-/.test(arg)) || "";
  const label = `${tool}-${srNumber || "manual"}`;
  const result = await runMosfsScript(tool, args, { label });
  return {
    ok: result.ok,
    tool,
    command: result.command,
    stdout: result.stdout,
    stderr: result.stderr,
    artifacts: result.artifacts,
    exitCode: result.exitCode,
  };
}

async function listMcpToolsAction(message) {
  const serverName = requireSafeName(message.server, "MCP server");
  return withMcpClient(serverName, async (client, config) => {
    const result = await client.request("tools/list", {});
    const tools = Array.isArray(result?.tools)
      ? result.tools.map((tool) => ({
          name: String(tool.name || ""),
          description: String(tool.description || ""),
          inputSchema: tool.inputSchema || tool.input_schema || null,
        })).filter((tool) => tool.name)
      : [];
    return { ok: true, server: publicMcpServer(config), tools };
  });
}

async function callMcpToolAction(message) {
  const serverName = requireSafeName(message.server, "MCP server");
  const toolName = requireSafeName(message.tool, "MCP tool");
  requireTypedMcpConfirmation(message, serverName, toolName);
  const args = message.arguments && typeof message.arguments === "object" && !Array.isArray(message.arguments)
    ? message.arguments
    : {};
  return withMcpClient(serverName, async (client, config) => {
    const result = await client.request("tools/call", { name: toolName, arguments: args });
    return {
      ok: true,
      server: publicMcpServer(config),
      tool: toolName,
      result,
    };
  });
}

async function qivrynAgentStatusAction() {
  const summary = await qivrynAgentStatusSummary();
  if (summary.state !== "ready") {
    return {
      ok: true,
      state: summary.state,
      error: summary.error || "Qivryn agent runtime is not running yet.",
      descriptor: summary.descriptor,
    };
  }
  return { ok: true, state: "ready", descriptor: summary.descriptor, health: summary.health };
}

async function qivrynAgentMessageAction(message) {
  const userPrompt = requireNonEmpty(message.prompt, "Agent task is required.");
  const srNumber = extractSrNumber(message.srNumber || message.tabContext?.url || message.tabContext?.title || userPrompt);
  const model = safeQivrynModel(message.model || DEFAULT_QIVRYN_MODEL);
  const reasoningEffort = safeReasoningEffort(message.reasoningEffort);
  const sessionId = safeQivrynSessionId(message.sessionId || `mosfs-extension-${srNumber || "active"}`);
  const workspaceRoot = safeWorkspaceRoot(message.workspaceRoot);
  const prompt = buildQivrynMosfsPrompt({ message, userPrompt, srNumber, reasoningEffort, workspaceRoot });
  log(`agent_message direct start session=${sessionId} sr=${srNumber || "none"} cwd=${workspaceRoot}`);
  const direct = await runQivrynDirectAgent({
    prompt,
    model,
    sessionId,
    srNumber,
    workspaceRoot,
  });
  log(`agent_message direct done session=${sessionId} sr=${srNumber || "none"} ok=${direct.ok} exit=${direct.exitCode}`);
  const event = {
    id: `direct-${Date.now()}`,
    runId: sessionId,
    sequence: Date.now(),
    kind: direct.ok ? "message.assistant" : "tool.failed",
    createdAt: new Date().toISOString(),
    payload: direct.ok
      ? { text: direct.text || "Qivryn agent completed without visible text." }
      : { toolName: "qivryn-agent", text: direct.error || "Qivryn agent failed." },
  };
  return {
    ok: direct.ok,
    source: "qivryn-direct-agent",
    action: "answered",
    srNumber,
    run: {
      id: sessionId,
      title: srNumber ? `MOSFS ${srNumber}` : "MOSFS browser task",
      status: direct.ok ? "completed" : "failed",
      model,
      updatedAt: new Date().toISOString(),
      artifacts: direct.artifacts,
    },
    events: publicAgentEvents([event]),
    artifacts: direct.artifacts,
    error: direct.ok ? "" : direct.error,
  };
}

async function qivrynAgentEventsAction(message) {
  const runId = requireAgentRunId(message.runId);
  const client = await getQivrynDaemon({ start: false });
  if (!client) return { ok: false, error: "Qivryn agent runtime is not running." };
  const afterSequence = safeSequence(message.afterSequence);
  const run = await qivrynGetRun(client, runId);
  const events = await qivrynReadEvents(client, runId, { afterSequence, limit: 80 });
  return {
    ok: true,
    source: "qivryn-agent-daemon",
    run: publicAgentRun(run),
    events: publicAgentEvents(events),
  };
}

async function selectFolderAction(message) {
  const defaultPath = safeWorkspaceRoot(message.defaultPath || message.workspaceRoot);
  const selected = await selectFolderWithNativeDialog({
    defaultPath,
    prompt: String(message.prompt || "Choose Qivryn repository folder"),
  });
  if (!selected) {
    return { ok: true, canceled: true, path: "", uri: "" };
  }
  const workspaceRoot = safeWorkspaceRoot(selected);
  return {
    ok: true,
    canceled: false,
    path: workspaceRoot,
    uri: pathToFileURL(workspaceRoot).href,
  };
}

async function qivrynReviewAction(message) {
  const engine = await createQivrynReviewEngine();
  const data = message.data || {};
  let content;
  switch (message.messageType) {
    case "reviews/list":
      content = await engine.listReports();
      break;
    case "reviews/get": {
      const report = data.reportId ? await engine.getReport(String(data.reportId)) : undefined;
      content = report ? await engine.reanchorReport(report.id) : undefined;
      break;
    }
    case "reviews/run":
      content = await engine.run(data);
      break;
    case "reviews/cancel":
      content = await engine.cancel(requireNonEmpty(data.reportId, "Review report id is required."));
      break;
    case "reviews/comments":
      content = await engine.listComments(requireNonEmpty(data.findingId, "Review finding id is required."));
      break;
    case "reviews/action":
      content = await runQivrynReviewAction(engine, data);
      break;
    default:
      throw new Error(`Unsupported review protocol: ${message.messageType}`);
  }
  return { ok: true, content };
}

async function createQivrynReviewEngine() {
  if (!existsSync(QIVRYN_REVIEW_ENGINE)) {
    throw new Error(`Qivryn review engine is not visible: ${QIVRYN_REVIEW_ENGINE}`);
  }
  const review = await import(pathToFileURL(QIVRYN_REVIEW_ENGINE).href);
  const engine = new review.ReviewEngine(
    new review.FileReviewStore(path.join(QIVRYN_GLOBAL_DIR, "reviews")),
    new review.GitReviewTargetResolver(),
    [
      new review.DiffSafetyAnalyzer(),
      new review.SemanticDiffAnalyzer(async (prompt, signal) => {
        if (signal?.aborted) throw new Error("Review canceled.");
        const direct = await runQivrynDirectAgent({
          prompt,
          model: DEFAULT_QIVRYN_MODEL,
          sessionId: `semantic-review-${Date.now()}`,
          srNumber: "semantic-review",
        });
        if (!direct.ok) {
          throw new Error(direct.error || "Semantic review model call failed.");
        }
        return direct.text;
      }),
    ],
    new review.GitPatchReviewFixer(),
  );
  await engine.initialize();
  return engine;
}

async function runQivrynReviewAction(engine, action) {
  switch (action.action) {
    case "status":
      return engine.setFindingStatus(
        requireNonEmpty(action.reportId, "Review report id is required."),
        requireNonEmpty(action.findingId, "Review finding id is required."),
        requireNonEmpty(action.status, "Review status is required."),
      );
    case "comment":
      return engine.addComment(
        requireNonEmpty(action.findingId, "Review finding id is required."),
        requireNonEmpty(action.body, "Review comment is required."),
      );
    case "feedback":
      return engine.setFeedback(
        requireNonEmpty(action.findingId, "Review finding id is required."),
        requireNonEmpty(action.value, "Review feedback value is required."),
      );
    case "reanchor":
      return engine.reanchor(
        requireNonEmpty(action.reportId, "Review report id is required."),
        requireNonEmpty(action.findingId, "Review finding id is required."),
      );
    case "fix":
      return engine.fixFinding(
        requireNonEmpty(action.reportId, "Review report id is required."),
        requireNonEmpty(action.findingId, "Review finding id is required."),
      );
    default:
      throw new Error(`Unsupported review action: ${action.action || "unknown"}`);
  }
}

async function qivrynAgentStatusSummary() {
  try {
    const client = await getQivrynDaemon({ start: false });
    if (!client) {
      return {
        state: "unavailable",
        error: existsSync(QIVRYN_DAEMON_DESCRIPTOR)
          ? "Qivryn daemon descriptor is present but the daemon is not healthy."
          : "Qivryn daemon descriptor is not present.",
        descriptor: { path: QIVRYN_DAEMON_DESCRIPTOR },
      };
    }
    return {
      state: "ready",
      descriptor: publicQivrynDescriptor(client),
      health: client.health,
    };
  } catch (error) {
    return {
      state: "unavailable",
      error: sanitize(error.message || String(error)),
      descriptor: { path: QIVRYN_DAEMON_DESCRIPTOR },
    };
  }
}

async function getQivrynDaemon({ start }) {
  const existing = await tryQivrynDescriptor();
  if (existing) return existing;
  if (!start) return null;
  await startQivrynDaemon();
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const client = await tryQivrynDescriptor().catch(() => null);
    if (client) return client;
    await sleep(75);
  }
  return null;
}

async function tryQivrynDescriptor() {
  const descriptor = readQivrynDaemonDescriptor();
  if (!descriptor) return null;
  if (descriptor.protocolVersion !== QIVRYN_AGENT_PROTOCOL_VERSION) return null;
  const baseUrl = safeLoopbackBaseUrl(descriptor.baseUrl);
  const token = requireNonEmpty(descriptor.token, "Qivryn daemon token is missing.");
  const client = { baseUrl, token, protocolVersion: descriptor.protocolVersion, pid: descriptor.pid };
  const health = await qivrynRequest(client, "/health", { method: "GET", timeoutMs: 1500 });
  return { ...client, health };
}

async function startQivrynDaemon() {
  if (!existsSync(QIVRYN_CLI)) throw new Error(`Qivryn CLI is not visible: ${QIVRYN_CLI}`);
  const token = randomBytes(32).toString("hex");
  const env = {
    ...buildHelperEnv(),
    QIVRYN_AGENT_DAEMON_TOKEN: token,
    QIVRYN_GLOBAL_DIR,
    QIVRYN_CLI_PATH: QIVRYN_CLI,
  };
  const child = spawn(process.execPath, [QIVRYN_CLI, "agents", "daemon"], {
    detached: true,
    stdio: "ignore",
    env,
  });
  child.unref();
  log(`started qivryn agent daemon pid=${child.pid || "unknown"}`);
}

function readQivrynDaemonDescriptor() {
  try {
    return JSON.parse(readFileSync(QIVRYN_DAEMON_DESCRIPTOR, "utf8"));
  } catch {
    return null;
  }
}

async function qivrynGetRun(client, runId) {
  const result = await qivrynRequest(client, `/runs/${encodeURIComponent(runId)}`, { method: "GET" });
  return result?.run || null;
}

async function qivrynReadEvents(client, runId, options = {}) {
  const query = new URLSearchParams();
  const afterSequence = safeSequence(options.afterSequence);
  if (afterSequence > 0) query.set("afterSequence", String(afterSequence));
  if (options.limit) query.set("limit", String(Math.min(Number(options.limit) || 80, 200)));
  const result = await qivrynRequest(client, `/runs/${encodeURIComponent(runId)}/events?${query}`, { method: "GET" });
  return Array.isArray(result?.events) ? result.events : [];
}

async function qivrynRequest(client, endpoint, options = {}) {
  if (!String(endpoint || "").startsWith("/")) throw new Error("Qivryn daemon endpoint must be a path.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 30000);
  try {
    const response = await fetch(`${client.baseUrl}${endpoint}`, {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${client.token}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let json = {};
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = { text };
      }
    }
    if (!response.ok) {
      const detail = typeof json?.error === "string" ? json.error : text;
      throw new Error(`Qivryn daemon request failed: HTTP ${response.status} ${limitText(sanitize(detail), 1200)}`);
    }
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

async function runQivrynDirectAgent({ prompt, model, sessionId, srNumber, workspaceRoot }) {
  if (!existsSync(QIVRYN_CLI)) throw new Error(`Qivryn CLI is not visible: ${QIVRYN_CLI}`);
  const label = `qivryn-direct-${srNumber || sessionId}`;
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${safeName(label)}`;
  const runDir = path.join(RUN_ROOT, runId);
  await mkdir(runDir, { recursive: true });
  const args = [
    QIVRYN_CLI,
    prompt,
    "--print",
    "--session-id",
    sessionId,
    "--beta-subagent-tool",
    "--autonomous",
    "--model",
    model,
  ];
  const command = [process.execPath, ...args];
  const startedAt = new Date().toISOString();
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  let ok = true;
  try {
    const result = await execFileAsync(process.execPath, args, {
      cwd: workspaceRoot || WORKSPACE_ROOT,
      timeout: AGENT_COMMAND_TIMEOUT_MS,
      maxBuffer: 40 * 1024 * 1024,
      env: {
        ...buildHelperEnv(),
        QIVRYN_GLOBAL_DIR,
        QIVRYN_CLI_PATH: QIVRYN_CLI,
        QIVRYN_AGENT_EVENT_STREAM: "1",
        QIVRYN_AGENT_CONTROL_STREAM: "1",
      },
    });
    stdout = result.stdout || "";
    stderr = result.stderr || "";
  } catch (error) {
    ok = false;
    exitCode = typeof error.code === "number" ? error.code : 1;
    stdout = error.stdout || "";
    stderr = error.stderr || error.message || String(error);
  }
  const sanitizedStdout = sanitize(stdout);
  const sanitizedStderr = sanitize(stderr);
  await writeFile(path.join(runDir, "command.json"), JSON.stringify({ command: redactCommand(command), startedAt, exitCode }, null, 2), "utf8");
  await writeFile(path.join(runDir, "stdout.txt"), sanitizedStdout, "utf8");
  await writeFile(path.join(runDir, "stderr.txt"), sanitizedStderr, "utf8");
  const text = parseQivrynAgentText(sanitizedStdout);
  const error = ok
    ? ""
    : limitText(sanitizedStderr || sanitizedStdout || "Qivryn direct agent exited without details.", 12000);
  return {
    ok,
    text: limitText(text || sanitizedStdout, MAX_RESPONSE_TEXT_CHARS),
    error,
    exitCode,
    artifacts: {
      runDir,
      stdout: path.join(runDir, "stdout.txt"),
      stderr: path.join(runDir, "stderr.txt"),
      command: path.join(runDir, "command.json"),
    },
  };
}

function parseQivrynAgentText(stdout) {
  const lines = String(stdout || "").split(/\r?\n/);
  const chunks = [];
  let parsedAny = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) continue;
    try {
      const event = JSON.parse(trimmed);
      parsedAny = true;
      const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
      if (event.kind === "message.assistant" && typeof payload.text === "string") chunks.push(payload.text);
      if (event.kind === "tool.output" && typeof payload.text === "string") chunks.push(payload.text);
    } catch {
      // Non-event output is handled below.
    }
  }
  if (chunks.length) return chunks.join("").trim();
  return parsedAny ? "" : String(stdout || "").trim();
}

function buildQivrynMosfsPrompt({ message, userPrompt, srNumber, reasoningEffort, workspaceRoot }) {
  const liveSrMarkdown = liveSrMarkdownFromMessage(message);
  const liveSrError = sanitize(message.liveSrError || "");
  const parts = [
    "You are Qivryn's backend agent running for the MOSFS Chrome extension.",
    "The browser UI is intentionally simple. Do the routing yourself: select the needed MOSFS skills, tools, MCP servers, code search, Python helpers, or browser evidence from the task and page context.",
    "If the user clicked a quick task such as Analyze SR, Draft update, Dry-run AP, or Resolve check, complete that task directly with the available evidence. Do not ask the user to choose the next action unless the requested task is genuinely impossible after checking the active tab evidence.",
    "Follow /Users/amridha/Documents/MOS_Automations/AGENTS.md, /Users/amridha/.codex/skills/mosfs/SKILL.md, evidence-first, and humanizer rules.",
    "Use live active-tab evidence first when available. Never ask for or expose bearer tokens, cookies, auth headers, ECID/XSRF values, refresh tokens, id tokens, or credentials.",
    "For customer-visible wording: plain L3 support tone, customer-safe content only, no DOT wording, no internal code paths, no helper script names, and no speculative statements.",
    "For any send, update, Action Plan, Public Note, assignment, resolve, or closure request: perform a dry-run/readback path first and require explicit user confirmation before any real write. Do not claim a write succeeded unless a tool/readback proves it.",
    `Default model request: ${DEFAULT_QIVRYN_MODEL}. Reasoning effort: ${reasoningEffort}.`,
    srNumber ? `Detected MOSFS SR: ${srNumber}` : "No SR number was detected; infer from the active tab if possible before acting.",
    `User task:\n${userPrompt}`,
    activeTabBlock(message.tabContext),
    liveSrMarkdown
      ? `Live SR evidence from the active Chrome tab/session:\n${liveSrMarkdown}`
      : `Live SR evidence from the active Chrome tab/session: not available.${liveSrError ? `\nFetch gap: ${liveSrError}` : ""}`,
    "Local roots available to the agent:",
    `- Selected Qivryn workspace: ${workspaceRoot || WORKSPACE_ROOT}`,
    `- MOS_Automations workspace: ${WORKSPACE_ROOT}`,
    `- MOSFS skill/helper root: ${MOSFS_SKILL_ROOT}`,
    `- Qivryn source: ${QIVRYN_ROOT}`,
  ];
  return limitText(parts.join("\n\n"), MAX_PROMPT_EVIDENCE_CHARS);
}

function publicQivrynDescriptor(client) {
  return {
    path: QIVRYN_DAEMON_DESCRIPTOR,
    baseUrl: client?.baseUrl || "",
    protocolVersion: client?.protocolVersion || QIVRYN_AGENT_PROTOCOL_VERSION,
    pid: client?.pid,
  };
}

function publicAgentRun(run) {
  if (!run) return null;
  return {
    id: sanitize(run.id || ""),
    title: sanitize(run.title || ""),
    status: sanitize(run.status || ""),
    createdAt: sanitize(run.createdAt || ""),
    updatedAt: sanitize(run.updatedAt || ""),
    model: sanitize(run.model || ""),
    permissionMode: sanitize(run.permissionMode || ""),
    workspace: run.workspace ? {
      location: sanitize(run.workspace.location || ""),
      repositoryPath: sanitize(run.workspace.repositoryPath || ""),
      worktreePath: sanitize(run.workspace.worktreePath || ""),
      branch: sanitize(run.workspace.branch || ""),
    } : null,
    metadata: sanitizeObject(run.metadata || {}),
  };
}

function publicQueueItem(item) {
  if (!item) return null;
  return {
    id: sanitize(item.id || ""),
    runId: sanitize(item.runId || ""),
    position: item.position,
    createdAt: sanitize(item.createdAt || ""),
    behavior: sanitize(item.behavior || ""),
  };
}

function publicAgentEvents(events) {
  const usedSequences = new Set();
  return (Array.isArray(events) ? events : [])
    .map((event, index) => publicAgentEvent(event, index, usedSequences))
    .filter(Boolean);
}

function publicAgentEvent(event, index = 0, usedSequences = new Set()) {
  if (!event?.kind || event.kind === "message.user") return null;
  let sequence = Number(event.sequence);
  if (!Number.isFinite(sequence) || sequence <= 0) sequence = index + 1;
  while (usedSequences.has(sequence)) sequence += 1;
  usedSequences.add(sequence);
  return {
    id: sanitize(event.id || ""),
    runId: sanitize(event.runId || ""),
    sequence,
    kind: sanitize(event.kind || ""),
    createdAt: sanitize(event.createdAt || ""),
    payload: publicAgentPayload(event.kind, event.payload),
  };
}

function publicAgentPayload(kind, payload) {
  if (typeof payload === "string") return { text: limitText(sanitize(payload), 12000) };
  if (!payload || typeof payload !== "object") return {};
  const out = {};
  for (const key of ["text", "detail", "message", "output", "status", "toolName", "name", "channel", "path", "error"]) {
    if (typeof payload[key] === "string") out[key] = limitText(sanitize(payload[key]), key === "text" || key === "output" ? 12000 : 1200);
  }
  if (kind === "run.status" && typeof payload.status === "string") out.status = sanitize(payload.status);
  if (payload.delta === true) out.delta = true;
  return out;
}

function validateToolArgs(tool, args, message) {
  if (args.some((arg) => arg.includes("\u0000"))) throw new Error("Invalid argument contains NUL.");
  if (tool !== "update_sr") return;
  if (!args.length || args[0].startsWith("-")) throw new Error("update_sr requires the SR number as the first argument.");
  const srNumber = extractSrNumber(args[0]);
  if (!srNumber) throw new Error("update_sr first argument must be an SR number.");

  let hasDryRun = false;
  let hasWriteFlag = false;
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    if (UPDATE_FLAGS_WITH_VALUE.has(arg)) {
      hasWriteFlag = hasWriteFlag || WRITE_FLAGS.has(arg);
      i += 1;
      if (i >= args.length) throw new Error(`Missing value for ${arg}`);
      continue;
    }
    if (UPDATE_FLAGS_NO_VALUE.has(arg)) {
      hasDryRun = hasDryRun || arg === "--dry-run";
      hasWriteFlag = hasWriteFlag || WRITE_FLAGS.has(arg);
      continue;
    }
    throw new Error(`Unsupported update_sr flag: ${arg}`);
  }
  if (hasWriteFlag && !hasDryRun) {
    const verb = args.includes("--resolve-with-solution") ? "RESOLVE" : args.includes("--assign-to-self") ? "ASSIGN" : "UPDATE";
    requireTypedConfirmation(message, srNumber, verb);
    if (args.includes("--action-plan") && !args.includes("--confirm-action-plan")) {
      throw new Error("Real Action Plan writes require --confirm-action-plan.");
    }
    if (args.includes("--resolve-with-solution") && !args.includes("--confirm-resolve")) {
      throw new Error("Real resolve writes require --confirm-resolve.");
    }
  }
}

async function runMosfsScript(tool, args, { label }) {
  const script = MOSFS_SCRIPTS[tool];
  if (!script || !existsSync(script)) throw new Error(`MOSFS helper is not visible: ${script}`);
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${safeName(label)}`;
  const runDir = path.join(RUN_ROOT, runId);
  await mkdir(runDir, { recursive: true });
  const command = ["python3", script, ...args];
  const startedAt = new Date().toISOString();
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  let ok = true;
  try {
    const result = await execFileAsync("python3", [script, ...args], {
      cwd: WORKSPACE_ROOT,
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: 40 * 1024 * 1024,
      env: buildHelperEnv(),
    });
    stdout = result.stdout || "";
    stderr = result.stderr || "";
  } catch (error) {
    ok = false;
    exitCode = typeof error.code === "number" ? error.code : 1;
    stdout = error.stdout || "";
    stderr = error.stderr || error.message || String(error);
  }
  const sanitizedStdout = sanitize(stdout);
  const sanitizedStderr = sanitize(stderr);
  await writeFile(path.join(runDir, "command.json"), JSON.stringify({ command: redactCommand(command), startedAt, exitCode }, null, 2), "utf8");
  await writeFile(path.join(runDir, "stdout.txt"), sanitizedStdout, "utf8");
  await writeFile(path.join(runDir, "stderr.txt"), sanitizedStderr, "utf8");
  return {
    ok,
    exitCode,
    command: redactCommand(command),
    stdout: limitText(sanitizedStdout, MAX_RESPONSE_TEXT_CHARS),
    stderr: limitText(sanitizedStderr, 40000),
    artifacts: {
      runDir,
      stdout: path.join(runDir, "stdout.txt"),
      stderr: path.join(runDir, "stderr.txt"),
      command: path.join(runDir, "command.json"),
    },
  };
}

function buildHelperEnv() {
  const pathParts = [
    path.dirname(process.execPath),
    "/Users/amridha/.nvm/versions/node/v25.2.1/bin",
    "/Users/amridha/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
    process.env.PATH || "",
  ].filter(Boolean);
  return {
    ...process.env,
    MOSFS_EXTENSION_AGENT: "1",
    NODE: process.execPath,
    PATH: [...new Set(pathParts.join(":").split(":").filter(Boolean))].join(":"),
  };
}

async function withMcpClient(serverName, callback) {
  const config = getMcpServerConfig(serverName);
  if (!config) return { ok: false, error: `MCP server is not configured: ${serverName}` };
  if (config.enabled === false) return { ok: false, error: `MCP server is disabled: ${serverName}` };
  if (!config.command) {
    return {
      ok: false,
      error: `MCP server ${serverName} is not a local stdio server or has no command configured.`,
      server: publicMcpServer(config),
    };
  }
  const client = createMcpClient(config);
  try {
    await client.initialize();
    return await callback(client, config);
  } finally {
    client.close();
  }
}

function createMcpClient(config) {
  const startupTimeoutMs = toTimeoutMs(config.startup_timeout_sec, 30000);
  const toolTimeoutMs = toTimeoutMs(config.tool_timeout_sec, MCP_DEFAULT_TIMEOUT_MS);
  const cwd = resolveMcpCwd(config.cwd);
  const child = spawn(config.command, Array.isArray(config.args) ? config.args : [], {
    cwd,
    env: { ...process.env, ...(config.env || {}) },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let nextId = 1;
  let stdoutBuffer = Buffer.alloc(0);
  let stderrText = "";
  const pendingRequests = new Map();

  child.stdout.on("data", (chunk) => {
    stdoutBuffer = Buffer.concat([stdoutBuffer, chunk]);
    drainMcpFrames();
  });
  child.stderr.on("data", (chunk) => {
    stderrText = limitText(`${stderrText}${sanitize(chunk.toString("utf8"))}`, 24000);
  });
  child.on("error", (error) => rejectAll(new Error(`MCP server ${config.name} failed to start: ${error.message || String(error)}`)));
  child.on("exit", (code, signal) => {
    if (pendingRequests.size) {
      rejectAll(new Error(`MCP server ${config.name} exited before responding: code=${code ?? "null"} signal=${signal ?? "null"} stderr=${stderrText}`));
    }
  });

  function request(method, params, timeoutMs = toolTimeoutMs) {
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }, timeoutMs);
      pendingRequests.set(id, { resolve, reject, timer, method });
      try {
        sendMcpMessage({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timer);
        pendingRequests.delete(id);
        reject(error);
      }
    });
  }

  function notify(method, params) {
    sendMcpMessage({ jsonrpc: "2.0", method, params });
  }

  function sendMcpMessage(message) {
    const body = Buffer.from(JSON.stringify(message), "utf8");
    child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    child.stdin.write(body);
  }

  function drainMcpFrames() {
    while (stdoutBuffer.length) {
      let headerEnd = stdoutBuffer.indexOf("\r\n\r\n");
      let separatorLength = 4;
      if (headerEnd === -1) {
        headerEnd = stdoutBuffer.indexOf("\n\n");
        separatorLength = 2;
      }
      if (headerEnd === -1) return;
      const header = stdoutBuffer.subarray(0, headerEnd).toString("utf8");
      const match = header.match(/content-length:\s*(\d+)/i);
      if (!match) {
        stdoutBuffer = stdoutBuffer.subarray(headerEnd + separatorLength);
        continue;
      }
      const bodyStart = headerEnd + separatorLength;
      const bodyLength = Number(match[1]);
      if (stdoutBuffer.length < bodyStart + bodyLength) return;
      const body = stdoutBuffer.subarray(bodyStart, bodyStart + bodyLength).toString("utf8");
      stdoutBuffer = stdoutBuffer.subarray(bodyStart + bodyLength);
      try {
        handleMcpMessage(JSON.parse(body));
      } catch (error) {
        rejectAll(new Error(`Invalid MCP response from ${config.name}: ${error.message || String(error)}`));
      }
    }
  }

  function handleMcpMessage(message) {
    if (message?.method && message.id !== undefined) {
      handleMcpServerRequest(message);
      return;
    }
    if (message?.id === undefined) return;
    const pending = pendingRequests.get(message.id);
    if (!pending) return;
    pendingRequests.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(new Error(message.error.message || `MCP request failed: ${pending.method}`));
      return;
    }
    pending.resolve(message.result);
  }

  function handleMcpServerRequest(message) {
    if (message.method === "roots/list") {
      sendMcpMessage({ jsonrpc: "2.0", id: message.id, result: { roots: [] } });
      return;
    }
    if (message.method === "ping") {
      sendMcpMessage({ jsonrpc: "2.0", id: message.id, result: {} });
      return;
    }
    sendMcpMessage({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32601, message: `Unsupported MCP client method: ${message.method}` },
    });
  }

  function rejectAll(error) {
    for (const pending of pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    pendingRequests.clear();
  }

  return {
    request,
    initialize: async () => {
      await request("initialize", {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "mosfs-chrome-agent", version: "0.1.0" },
      }, startupTimeoutMs);
      notify("notifications/initialized", {});
    },
    close: () => {
      rejectAll(new Error("MCP client closed."));
      child.kill();
    },
  };
}

function getMcpServerConfig(serverName) {
  const parsed = parseCodexConfig(loadText(CODEX_CONFIG), { redact: false });
  return parsed.mcpServers.find((server) => server.name === serverName) || null;
}

function publicMcpServer(config) {
  return {
    name: config.name,
    type: config.type || (config.command ? "stdio" : config.url ? "http" : ""),
    command: sanitize(config.command || ""),
    args: sanitizeConfigValue(config.args || []),
    cwd: sanitize(config.cwd || ""),
    url: sanitize(config.url || ""),
    enabled: config.enabled !== false,
    startup_timeout_sec: config.startup_timeout_sec,
    tool_timeout_sec: config.tool_timeout_sec,
    envKeys: Object.keys(config.env || {}).sort(),
    headerKeys: Object.keys(config.headers || {}).sort(),
    tools: [...new Set(config.tools || [])].sort(),
  };
}

function resolveMcpCwd(cwd) {
  const value = String(cwd || "").trim();
  if (!value) return WORKSPACE_ROOT;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  if (path.isAbsolute(value)) return value;
  return path.join(WORKSPACE_ROOT, value);
}

function toTimeoutMs(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return number < 1000 ? Math.round(number * 1000) : Math.round(number);
}

async function callCodexResponses({ model, reasoningEffort, prompt }) {
  const codex = readCodexConfig({ includeToken: true });
  if (!codex.ok) return { ok: false, error: codex.error, text: "" };
  const instructions = buildInstructions();
  const baseBody = {
    model,
    store: false,
    stream: true,
    instructions,
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: limitText(prompt, MAX_PROMPT_EVIDENCE_CHARS) }],
      },
    ],
  };
  const withReasoning = {
    ...baseBody,
    reasoning: { effort: reasoningEffort },
    model_reasoning_effort: reasoningEffort,
  };
  const first = await postCodexResponses(codex, withReasoning);
  if (first.ok || ![400, 422].includes(first.status || 0)) return first;
  const fallback = await postCodexResponses(codex, baseBody);
  if (fallback.ok) {
    return { ...fallback, reasoningApplied: false, warning: "Backend rejected the reasoning field; retried without it." };
  }
  return first;
}

async function postCodexResponses(codex, body) {
  const response = await fetch("https://chatgpt.com/backend-api/codex/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${codex.accessToken}`,
      "Content-Type": "application/json",
      "x-codex-installation-id": codex.installationId,
    },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: `Codex responses request failed: HTTP ${response.status}`,
      detail: sanitize(raw).slice(0, 4000),
      text: "",
    };
  }
  return { ok: true, status: response.status, text: sanitize(parseSseText(raw)), rawEventCount: raw.split("\n\n").length };
}

function parseSseText(raw) {
  let out = "";
  for (const block of raw.split(/\n\n+/)) {
    const eventLine = block.split("\n").find((line) => line.startsWith("event:"));
    const dataLines = block.split("\n").filter((line) => line.startsWith("data:"));
    if (!dataLines.length) continue;
    const eventName = eventLine ? eventLine.replace(/^event:\s*/, "").trim() : "";
    const dataText = dataLines.map((line) => line.replace(/^data:\s?/, "")).join("\n");
    if (!dataText || dataText === "[DONE]") continue;
    try {
      const data = JSON.parse(dataText);
      if (eventName === "response.output_text.delta" && typeof data.delta === "string") out += data.delta;
      if (eventName === "response.output_text.done" && !out && typeof data.text === "string") out = data.text;
    } catch {
      continue;
    }
  }
  return out.trim();
}

function buildInstructions() {
  const files = [
    ["AGENTS.md", path.join(WORKSPACE_ROOT, "AGENTS.md")],
    ["evidence-first", "/Users/amridha/.codex/skills/evidence-first/SKILL.md"],
    ["support-debug-stack", "/Users/amridha/.codex/skills/support-debug-stack/SKILL.md"],
    ["humanizer", "/Users/amridha/.codex/skills/humanizer/SKILL.md"],
    ["mosfs", path.join(MOSFS_SKILL_ROOT, "SKILL.md")],
  ];
  const parts = [
    "You are MOSFS Chrome Agent, a local assistant for Atanu's Oracle Retail MOSFS work.",
    "Evidence-first is mandatory. Use only reviewed active-tab context and tool output. Mark anything else as not visible or not verified.",
    "Never reveal, quote, summarize, or request bearer tokens, cookies, raw auth headers, ECID values, XSRF values, refresh tokens, id tokens, or credentials.",
    "Never claim an SR write, post, status change, assignment, or closure succeeded unless the tool output/readback proves it.",
    "For customer-visible wording, never mention DOT or internal file paths, helper scripts, package names, Slack, private code paths, or raw payloads.",
    "For MOSFS writes, keep dry-run and explicit approval gates. If the user asks only for wording, draft text only.",
    `\n--- local Codex inventory ---\n${JSON.stringify(buildCodexInventory({ includeSkills: false }), null, 2)}`,
  ];
  for (const [name, file] of files) {
    parts.push(`\n--- ${name} (${file}) ---\n${loadText(file)}`);
  }
  return limitText(parts.join("\n"), 220000);
}

function buildCodexInventory(options = {}) {
  const includeSkills = options.includeSkills !== false;
  const configText = loadText(CODEX_CONFIG);
  const parsed = parseCodexConfig(configText);
  return {
    sourcePaths: {
      codexConfig: CODEX_CONFIG,
      pluginCacheRoot: PLUGIN_CACHE_ROOT,
      workspaceRoot: WORKSPACE_ROOT,
      mosfsSkillRoot: MOSFS_SKILL_ROOT,
      codexClone: "/Users/amridha/Documents/CodexClone",
      codexCloneStatus: codexCloneStatus(),
      codexCloneApp: existsSync("/Users/amridha/Downloads/CodexCloneApp")
        ? "/Users/amridha/Downloads/CodexCloneApp"
        : "not visible",
    },
    config: parsed.config,
    features: parsed.features,
    mcpServers: parsed.mcpServers,
    plugins: parsed.plugins,
    mosfsTools: Object.keys(MOSFS_SCRIPTS),
    updateSrAllowlist: {
      flagsWithValue: [...UPDATE_FLAGS_WITH_VALUE].sort(),
      flagsNoValue: [...UPDATE_FLAGS_NO_VALUE].sort(),
      writeFlags: [...WRITE_FLAGS].sort(),
    },
    skills: includeSkills ? discoverSkills() : [],
  };
}

function codexCloneStatus() {
  const dir = "/Users/amridha/Documents/CodexClone";
  if (!existsSync(dir)) return "not visible";
  try {
    const entries = readdirSync(dir).filter((entry) => entry !== ".git");
    return entries.length === 0 ? "empty working tree; no code files visible" : `contains ${entries.length} top-level non-git entries`;
  } catch (error) {
    return `not readable: ${error.message || String(error)}`;
  }
}

function parseCodexConfig(text, options = {}) {
  const redact = options.redact !== false;
  const config = {};
  const features = {};
  const plugins = [];
  const mcpMap = new Map();
  let section = "";
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const sectionMatch = line.match(/^\[(.+)]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      const mcpTool = section.match(/^mcp_servers\.(?:"([^"]+)"|([^.]+))\.tools\.(?:"([^"]+)"|(.+))$/);
      if (mcpTool) ensureMcp(mcpMap, mcpTool[1] || mcpTool[2]).tools.push(mcpTool[3] || mcpTool[4]);
      const mcpChild = section.match(/^mcp_servers\.(?:"([^"]+)"|([^.]+))\.(env|headers|http_headers)$/);
      if (mcpChild) ensureMcp(mcpMap, mcpChild[1] || mcpChild[2]);
      const mcpName = section.match(/^mcp_servers\.(?:"([^"]+)"|([^.]+))$/);
      if (mcpName) ensureMcp(mcpMap, mcpName[1] || mcpName[2]);
      const pluginName = section.match(/^plugins\."([^"]+)"$/);
      if (pluginName) plugins.push({ id: pluginName[1], enabled: true });
      continue;
    }

    const pair = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!pair) continue;
    const key = pair[1];
    const value = parseTomlScalar(pair[2]);

    if (!section) {
      if (["model", "model_reasoning_effort", "model_context_window", "model_auto_compact_token_limit", "sandbox_mode", "network_access", "approval_policy", "service_tier"].includes(key)) {
        config[key] = value;
      }
      continue;
    }
    if (section === "features") {
      features[key] = value;
      continue;
    }
    const pluginSection = section.match(/^plugins\."([^"]+)"$/);
    if (pluginSection && key === "enabled") {
      const plugin = plugins.find((item) => item.id === pluginSection[1]) || { id: pluginSection[1] };
      plugin.enabled = value;
      if (!plugins.includes(plugin)) plugins.push(plugin);
      continue;
    }
    const mcpChild = section.match(/^mcp_servers\.(?:"([^"]+)"|([^.]+))\.(env|headers|http_headers)$/);
    if (mcpChild) {
      const mcp = ensureMcp(mcpMap, mcpChild[1] || mcpChild[2]);
      if (mcpChild[3] === "env") {
        mcp.env[key] = redact ? "[configured]" : String(value);
      } else {
        mcp.headers[key] = redact ? "[configured]" : sanitizeConfigValue(value);
      }
      continue;
    }
    const mcpToolSection = section.match(/^mcp_servers\.(?:"([^"]+)"|([^.]+))\.tools\.(?:"([^"]+)"|(.+))$/);
    if (mcpToolSection) {
      const mcp = ensureMcp(mcpMap, mcpToolSection[1] || mcpToolSection[2]);
      const toolName = mcpToolSection[3] || mcpToolSection[4];
      if (!mcp.tools.includes(toolName)) mcp.tools.push(toolName);
      continue;
    }
    const mcpName = section.match(/^mcp_servers\.(?:"([^"]+)"|([^.]+))$/);
    if (mcpName) {
      const mcp = ensureMcp(mcpMap, mcpName[1] || mcpName[2]);
      if (key === "args") {
        mcp.args = Array.isArray(value) ? value.map((item) => String(item)) : [];
        if (redact) mcp.args = sanitizeConfigValue(mcp.args);
        continue;
      }
      if (["command", "url", "enabled", "startup_timeout_sec", "tool_timeout_sec", "cwd", "type", "bearer_token_env_var"].includes(key)) {
        mcp[key] = redact ? sanitizeConfigValue(value) : value;
      }
    }
  }
  return {
    config,
    features,
    plugins: plugins.sort((a, b) => a.id.localeCompare(b.id)),
    mcpServers: [...mcpMap.values()].map((server) => ({
      ...server,
      args: Array.isArray(server.args) ? server.args : [],
      env: server.env || {},
      headers: server.headers || {},
      tools: [...new Set(server.tools)].sort(),
    })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function ensureMcp(map, name) {
  if (!map.has(name)) map.set(name, { name, type: "", command: "", args: [], env: {}, headers: {}, url: "", cwd: "", enabled: true, tools: [] });
  return map.get(name);
}

function parseTomlScalar(value) {
  const trimmed = String(value || "").trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return splitTomlArray(trimmed.slice(1, -1)).map((item) => parseTomlScalar(item.trim())).filter((item) => item !== "");
  }
  return sanitize(trimmed);
}

function splitTomlArray(value) {
  const items = [];
  let current = "";
  let quote = "";
  let escaped = false;
  let depth = 0;
  for (const char of String(value || "")) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (quote && char === "\\") {
      current += char;
      escaped = true;
      continue;
    }
    if (quote) {
      current += char;
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "[" || char === "{") depth += 1;
    if (char === "]" || char === "}") depth -= 1;
    if (char === "," && depth === 0) {
      items.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) items.push(current);
  return items;
}

function sanitizeConfigValue(value) {
  if (Array.isArray(value)) return value.map((item) => sanitizeConfigValue(item));
  if (typeof value === "string") return sanitize(value);
  return value;
}

function discoverSkills() {
  const roots = [
    path.join(WORKSPACE_ROOT, ".agents", "skills"),
    path.join(WORKSPACE_ROOT, "skills"),
    path.join(CODEX_HOME, "skills"),
    path.join(os.homedir(), ".agents", "skills"),
    PLUGIN_CACHE_ROOT,
  ];
  const seen = new Map();
  for (const root of roots) {
    for (const file of findSkillFiles(root, 8)) {
      const id = skillIdFromPath(file);
      if (seen.has(file)) continue;
      const text = loadText(file).slice(0, 12000);
      const meta = parseSkillFrontMatter(text);
      seen.set(file, {
        id,
        name: meta.name || id,
        description: meta.description || "",
        shortDescription: meta.shortDescription || "",
        path: file,
        source: skillSource(file),
      });
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 400);
}

function findSkillFiles(root, maxDepth) {
  const out = [];
  if (!existsSync(root)) return out;
  function walk(dir, depth) {
    if (depth > maxDepth || out.length > 700) return;
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name.startsWith("plugin-backup-")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === "SKILL.md") {
        out.push(full);
      } else if (entry.isDirectory()) {
        walk(full, depth + 1);
      }
    }
  }
  walk(root, 0);
  return out;
}

function parseSkillFrontMatter(text) {
  const match = String(text || "").match(/^---\s*\n([\s\S]*?)\n---\s*/);
  if (!match) return {};
  const out = {};
  const lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || /^\s/.test(line)) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = normalizeSkillMetaKey(line.slice(0, idx).trim());
    let value = unquote(line.slice(idx + 1).trim());
    if ((value === "|" || value === ">") && key) {
      const block = [];
      for (let j = i + 1; j < lines.length; j += 1) {
        if (!/^\s+/.test(lines[j])) break;
        block.push(lines[j].trim());
        i = j;
      }
      value = block.join(" ");
    }
    if (key) out[key] = value;
  }
  return out;
}

function normalizeSkillMetaKey(key) {
  const map = {
    name: "name",
    description: "description",
    "short-description": "shortDescription",
    short_description: "shortDescription",
    shortDescription: "shortDescription",
  };
  return map[key] || "";
}

function unquote(value) {
  return String(value || "").replace(/^['"](.*)['"]$/, "$1").replace(/\\"/g, '"');
}

function skillIdFromPath(file) {
  const parent = path.basename(path.dirname(file));
  return parent || path.basename(file, ".md");
}

function skillSource(file) {
  if (file.startsWith(PLUGIN_CACHE_ROOT)) return "plugin-cache";
  if (file.startsWith(path.join(CODEX_HOME, "skills"))) return "codex-home";
  if (file.startsWith(path.join(os.homedir(), ".agents", "skills"))) return "user-agents";
  if (file.startsWith(WORKSPACE_ROOT)) return "workspace";
  return "other";
}

function readCodexConfig({ includeToken }) {
  try {
    const authPath = path.join(CODEX_HOME, "auth.json");
    const installPath = path.join(CODEX_HOME, "installation_id");
    const auth = JSON.parse(readFileSync(authPath, "utf8"));
    const installationId = readFileSync(installPath, "utf8").trim();
    const models = JSON.parse(readFileSync(CODEX_MODELS_CACHE, "utf8"));
    const accessToken = auth?.tokens?.access_token;
    if (!accessToken) throw new Error("missing .tokens.access_token in auth.json");
    return {
      ok: true,
      authMode: auth.auth_mode || "",
      installationId,
      clientVersion: models.client_version || "",
      accessToken: includeToken ? accessToken : undefined,
    };
  } catch (error) {
    return { ok: false, error: `Codex auth is not available: ${error.message || String(error)}` };
  }
}

function loadText(file) {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    return `Not visible: ${error.message || String(error)}`;
  }
}

function liveSrMarkdownFromMessage(message) {
  const text = String(message.liveSrMarkdown || "").trim();
  return text ? limitText(sanitize(text), MAX_RESPONSE_TEXT_CHARS) : "";
}

function liveFetchResultFromMessage(message) {
  const stdout = liveSrMarkdownFromMessage(message);
  if (!stdout) return null;
  return {
    ok: true,
    source: "active-tab-live-session",
    command: ["chrome.activeTab.fetch"],
    artifacts: null,
    stdout,
    stderr: message.liveSrError ? sanitize(message.liveSrError) : "",
    exitCode: 0,
  };
}

function activeTabBlock(tabContext) {
  if (!tabContext) return "Active tab context: not available.";
  return [
    "Active tab context:",
    `URL: ${tabContext.url || "not visible"}`,
    `Title: ${tabContext.title || "not visible"}`,
    tabContext.crmRestBasePath ? `CRM REST base: ${tabContext.crmRestBasePath}` : "",
    tabContext.resourcesVersion ? `Resources version: ${tabContext.resourcesVersion}` : "",
    tabContext.selectedText ? `Selected text:\n${tabContext.selectedText}` : "",
    tabContext.visibleText ? `Visible text excerpt:\n${limitText(tabContext.visibleText, 16000)}` : "",
  ].filter(Boolean).join("\n");
}

function requireSrNumber(message) {
  const srNumber = extractSrNumber(message.srNumber || message.tabContext?.url || message.prompt || "");
  if (!srNumber) throw new Error("No SR number was provided or detected from the active tab.");
  return srNumber;
}

function extractSrNumber(value) {
  const match = String(value || "").match(/\b[34]-\d{10}\b/);
  return match ? match[0] : "";
}

function requireNonEmpty(value, message) {
  const text = String(value || "").trim();
  if (!text) throw new Error(message);
  return text;
}

function requireTypedConfirmation(message, srNumber, verb) {
  const expected = `${verb} ${srNumber}`;
  if (message.confirm !== true || String(message.confirmText || "").trim() !== expected) {
    throw new Error(`Real MOSFS write blocked. Type exactly "${expected}" to confirm.`);
  }
}

function requireTypedMcpConfirmation(message, serverName, toolName) {
  const expected = `MCP ${serverName}.${toolName}`;
  if (message.confirm !== true || String(message.confirmText || "").trim() !== expected) {
    throw new Error(`MCP tool call blocked. Type exactly "${expected}" to confirm.`);
  }
}

function requireSafeName(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} is required.`);
  if (!/^[a-zA-Z0-9_.:@/-]+$/.test(text)) throw new Error(`Invalid ${label}: ${text}`);
  return text;
}

function requireAgentRunId(value) {
  const text = optionalAgentRunId(value);
  if (!text) throw new Error("Qivryn agent run id is required.");
  return text;
}

function optionalAgentRunId(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (!/^[a-zA-Z0-9._:-]{1,160}$/.test(text)) throw new Error(`Invalid Qivryn agent run id: ${text}`);
  return text;
}

function safeModel(value) {
  const model = String(value || DEFAULT_MODEL).trim();
  if (!/^[a-zA-Z0-9._:-]+$/.test(model)) throw new Error(`Invalid model: ${model}`);
  return model;
}

function safeQivrynModel(value) {
  const model = String(value || DEFAULT_QIVRYN_MODEL).trim();
  if (!/^[a-zA-Z0-9 ._:/+-]{1,120}$/.test(model)) throw new Error(`Invalid Qivryn model: ${model}`);
  return model;
}

function safeQivrynSessionId(value) {
  const sessionId = String(value || "").trim();
  if (!sessionId) throw new Error("Qivryn session id is required.");
  if (!/^[a-zA-Z0-9._:-]{1,160}$/.test(sessionId)) throw new Error(`Invalid Qivryn session id: ${sessionId}`);
  return sessionId;
}

function safeWorkspaceRoot(value) {
  const raw = String(value || "").replace(/^file:\/\//, "").trim();
  if (!raw) return WORKSPACE_ROOT;
  if (raw.includes("\u0000")) throw new Error("Invalid workspace path.");
  if (raw === "~" || raw.startsWith("~/")) return path.join(os.homedir(), raw.slice(raw === "~" ? 1 : 2));
  if (!path.isAbsolute(raw)) throw new Error("Qivryn workspace path must be absolute.");
  return raw;
}

function appleScriptString(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, " ");
}

async function selectFolderWithNativeDialog({ defaultPath, prompt }) {
  if (process.platform !== "darwin") {
    throw new Error("Folder selection is currently implemented for macOS native host sessions.");
  }
  const root = existsSync(defaultPath) ? defaultPath : os.homedir();
  const script = [
    `set defaultFolderPath to "${appleScriptString(root)}"`,
    `set dialogPrompt to "${appleScriptString(prompt)}"`,
    "try",
    "  set selectedFolder to choose folder with prompt dialogPrompt default location (POSIX file defaultFolderPath)",
    "  return POSIX path of selectedFolder",
    "on error number -128",
    '  return ""',
    "end try",
  ].join("\n");
  const result = await execFileAsync("osascript", ["-e", script], {
    timeout: FOLDER_PICKER_TIMEOUT_MS,
    maxBuffer: 64 * 1024,
  });
  const selected = String(result.stdout || "").trim();
  if (!selected) return "";
  return selected.length > 1 ? selected.replace(/\/+$/, "") : selected;
}

function safeReasoningEffort(value) {
  const effort = String(value || DEFAULT_REASONING_EFFORT).trim().toLowerCase();
  const allowed = new Set(["minimal", "low", "medium", "high", "xhigh"]);
  if (!allowed.has(effort)) throw new Error(`Invalid reasoning effort: ${effort}`);
  return effort;
}

function safeSequence(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.floor(number);
}

function safeLoopbackBaseUrl(value) {
  const url = new URL(String(value || ""));
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error("Qivryn daemon descriptor must use an HTTP loopback baseUrl.");
  }
  return url.origin;
}

function safeName(value) {
  return String(value || "run").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "run";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitize(value) {
  return String(value || "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/("?(?:access|refresh|id)_token"?\s*[:=]\s*")([^"]+)(")/gi, "$1[REDACTED]$3")
    .replace(/((?:Cookie|Set-Cookie|X-XSRF-TOKEN|ECID|Authorization)\s*:\s*)([^\n\r]+)/gi, "$1[REDACTED]")
    .replace(/([?&](?:access_token|id_token|refresh_token|xsrf|ecid)=)[^&\s]+/gi, "$1[REDACTED]");
}

function redactCommand(command) {
  return command.map((part) => sanitize(part));
}

function limitText(value, maxChars) {
  const text = String(value || "");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated ${text.length - maxChars} chars; see artifact file for full sanitized output]`;
}

function log(message) {
  mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${sanitize(message)}\n`, "utf8");
}

function writeMessage(value) {
  const safeValue = sanitizeObject(value);
  const body = Buffer.from(JSON.stringify(safeValue), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

function sanitizeObject(value) {
  if (typeof value === "string") return sanitize(value);
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeObject(item));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (/token|cookie|authorization|credential|secret|password|xsrf|ecid/i.test(key)) {
      return [key, item ? "[REDACTED]" : item];
    }
    return [key, sanitizeObject(item)];
  }));
}
