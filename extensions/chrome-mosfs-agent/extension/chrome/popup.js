const DEFAULT_MODEL = "gpt-5.5";
const DEFAULT_REASONING_EFFORT = "medium";
const STORAGE_VERSION = 2;
const STORAGE_KEYS = ["mosfsAgentRunId", "mosfsAgentMessages", "mosfsAgentLastSequence", "mosfsAgentSessionId", "mosfsAgentMode", "mosfsAgentUiVersion"];

const contextLine = document.querySelector("#contextLine");
const stateBadge = document.querySelector("#stateBadge");
const srPill = document.querySelector("#srPill");
const runPill = document.querySelector("#runPill");
const messagesEl = document.querySelector("#messages");
const promptInput = document.querySelector("#prompt");
const sendButton = document.querySelector("#sendButton");
const refreshButton = document.querySelector("#refreshButton");
const newButton = document.querySelector("#newButton");
const composerForm = document.querySelector("#composerForm");

const state = {
  context: null,
  activeRunId: "",
  lastSequence: 0,
  sessionId: "",
  messages: [],
  polling: null,
};

chrome.storage.local.get(STORAGE_KEYS, (stored) => {
  state.sessionId = stored.mosfsAgentSessionId || newSessionId();
  const directMode = stored.mosfsAgentMode === "direct" && Number(stored.mosfsAgentUiVersion || 0) === STORAGE_VERSION;
  state.activeRunId = directMode ? (stored.mosfsAgentRunId || "") : "";
  state.lastSequence = directMode ? Number(stored.mosfsAgentLastSequence || 0) : 0;
  state.messages = directMode && Array.isArray(stored.mosfsAgentMessages) ? stored.mosfsAgentMessages.slice(-40) : [];
  if (!state.messages.length) {
    addMessage("assistant", "Tell me what you want to do with the active MOSFS SR. I will route it through the Qivryn agent and use the live tab context.");
  } else {
    renderMessages();
  }
  updateRunPill();
  refreshContext();
  checkAgentStatus();
});

refreshButton.addEventListener("click", refreshContext);
newButton.addEventListener("click", resetConversation);
composerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendPrompt(promptInput.value);
});

for (const button of document.querySelectorAll("[data-prompt]")) {
  button.addEventListener("click", () => sendPrompt(button.dataset.prompt || ""));
}

promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    sendPrompt(promptInput.value);
  }
});

async function checkAgentStatus() {
  const response = await sendMessage({ type: "agent-status" });
  if (!response?.ok) {
    setState("error", "Agent unavailable");
    addMessage("error", response?.error || "Qivryn agent runtime is not available.");
    return;
  }
  if (response.state === "ready") {
    setState("ok", "Agent ready");
    return;
  }
  setState("idle", response.state === "starting" ? "Agent starting" : "Starts on send");
}

async function refreshContext() {
  contextLine.textContent = "Reading active tab";
  const response = await sendMessage({ type: "active-tab" });
  if (!response?.ok) {
    contextLine.textContent = response?.error || "Active tab not available";
    srPill.textContent = "SR not detected";
    return;
  }
  state.context = response.tabContext || {};
  const sr = firstSr(state.context);
  srPill.textContent = sr || "SR not detected";
  const status = state.context.statusCd ? ` · ${state.context.statusCd}` : "";
  contextLine.textContent = sr ? `${sr}${status}` : (state.context.title || "MOSFS tab connected");
  persist();
}

async function sendPrompt(rawPrompt) {
  const prompt = String(rawPrompt || "").trim();
  if (!prompt) {
    promptInput.focus();
    return;
  }

  addMessage("user", prompt);
  promptInput.value = "";
  setBusy(true, "Running agent");

  const srNumber = firstSr(state.context) || firstSr({ url: prompt, title: prompt });
  const response = await sendMessage({
    type: "agent-message",
    prompt,
    srNumber,
    sessionId: state.sessionId,
    model: DEFAULT_MODEL,
    reasoningEffort: DEFAULT_REASONING_EFFORT,
  });

  setBusy(false);
  if (response?.run?.id) {
    const previousRunId = state.activeRunId;
    state.activeRunId = response.run.id;
    if (previousRunId !== state.activeRunId) state.lastSequence = 0;
    updateRunPill(response.run);
  }
  if (!response?.ok) {
    renderAgentEvents(response?.events || []);
    setState("error", "Blocked");
    addMessage("error", response?.error || "Agent request failed.");
    return;
  }

  if (response.action === "answered") {
    const rendered = renderAgentEvents(response.events || []);
    if (!rendered) addMessage("assistant", "Qivryn agent completed without visible response text.");
    setState("ok", "Answered");
  } else {
    addMessage("assistant", response.action === "queued"
      ? `Queued that for the active Qivryn agent run.\n\nRun: ${state.activeRunId}`
      : `Started a Qivryn agent run for this MOSFS task.\n\nRun: ${state.activeRunId}`);
    renderAgentEvents(response.events || []);
  }
  persist();
  if (response.source === "qivryn-agent-daemon" && response.action !== "answered") pollEvents();
}

async function pollEvents() {
  if (!state.activeRunId) return;
  if (state.polling) clearTimeout(state.polling);
  const response = await sendMessage({
    type: "agent-events",
    runId: state.activeRunId,
    afterSequence: state.lastSequence,
  });
  if (response?.ok) {
    if (response.run) updateRunPill(response.run);
    renderAgentEvents(response.events || []);
    persist();
    const status = response.run?.status || "";
    if (!["completed", "failed", "canceled", "archived"].includes(status)) {
      state.polling = setTimeout(pollEvents, 2500);
    }
  } else {
    addMessage("error", response?.error || "Could not read Qivryn agent events.");
  }
}

function renderAgentEvents(events) {
  let rendered = 0;
  for (const event of events) {
    if (!event || Number(event.sequence) <= state.lastSequence) continue;
    state.lastSequence = Number(event.sequence);
    const text = agentEventText(event);
    if (!text) continue;
    const role = event.kind === "message.assistant" ? "assistant" : "event";
    addMessage(role, text, { persistNow: false });
    rendered += 1;
  }
  renderMessages();
  return rendered;
}

function agentEventText(event) {
  const payload = event.payload || {};
  if (event.kind === "message.assistant") return payloadText(payload);
  if (event.kind === "message.reasoning") return `Reasoning\n${payloadText(payload)}`;
  if (event.kind === "tool.started") return `Tool started: ${payload.toolName || payload.name || payloadText(payload) || "tool"}`;
  if (event.kind === "tool.completed") return `Tool completed: ${payload.toolName || payload.name || "tool"}`;
  if (event.kind === "tool.failed") return `Tool failed: ${payload.toolName || payload.name || "tool"}\n${payloadText(payload)}`;
  if (event.kind === "tool.output") return payloadText(payload);
  if (event.kind === "run.status") return payload.status ? `Run status: ${payload.status}` : "";
  if (event.kind === "runtime.notice") return payloadText(payload);
  if (event.kind === "approval.requested") return `Approval requested\n${payloadText(payload)}`;
  return "";
}

function payloadText(payload) {
  if (typeof payload === "string") return payload;
  if (typeof payload.text === "string") return payload.text;
  if (typeof payload.output === "string") return payload.output;
  if (typeof payload.detail === "string") return payload.detail;
  if (typeof payload.message === "string") return payload.message;
  return "";
}

function addMessage(role, text, options = {}) {
  state.messages.push({
    role,
    text: limitText(text, 12000),
    at: new Date().toISOString(),
  });
  state.messages = state.messages.slice(-60);
  renderMessages();
  if (options.persistNow !== false) persist();
}

function renderMessages() {
  messagesEl.textContent = "";
  for (const message of state.messages) {
    const div = document.createElement("div");
    div.className = `message ${message.role}`;
    div.textContent = message.text;
    messagesEl.appendChild(div);
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setBusy(busy, label = "") {
  sendButton.disabled = busy;
  refreshButton.disabled = busy;
  newButton.disabled = busy;
  for (const button of document.querySelectorAll("[data-prompt]")) button.disabled = busy;
  if (busy) setState("busy", label);
  else setState("ok", "Agent ready");
}

function setState(kind, label) {
  stateBadge.className = `badge ${kind}`;
  stateBadge.textContent = label;
}

function updateRunPill(run = null) {
  if (!state.activeRunId) {
    runPill.textContent = "No run";
    runPill.className = "pill muted";
    return;
  }
  const shortId = state.activeRunId.slice(0, 8);
  const status = run?.status ? ` · ${run.status}` : "";
  runPill.textContent = state.activeRunId.startsWith("mosfs-extension-") ? `Direct${status}` : `${shortId}${status}`;
  runPill.className = run?.status === "failed" ? "pill error" : "pill";
}

async function sendMessage(message) {
  try {
    const response = await chrome.runtime.sendMessage(message);
    return response || { ok: false, error: "Service worker did not return a response." };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

function firstSr(tabContext) {
  const matches = tabContext?.srMatches || [];
  if (matches.length) return matches[0];
  const match = `${tabContext?.srNumber || ""} ${tabContext?.url || ""} ${tabContext?.title || ""}`.match(/\b[34]-\d{10}\b/);
  return match ? match[0] : "";
}

function persist() {
  chrome.storage.local.set({
    mosfsAgentRunId: state.activeRunId,
    mosfsAgentMessages: state.messages,
    mosfsAgentLastSequence: state.lastSequence,
    mosfsAgentSessionId: state.sessionId,
    mosfsAgentMode: "direct",
    mosfsAgentUiVersion: STORAGE_VERSION,
  });
}

function resetConversation() {
  if (state.polling) clearTimeout(state.polling);
  state.activeRunId = "";
  state.lastSequence = 0;
  state.sessionId = newSessionId();
  state.messages = [];
  addMessage("assistant", "Ask what you want to do with the active MOSFS SR. I will run it through the Qivryn agent and show the answer here.");
  updateRunPill();
  setState("ok", "Agent ready");
  promptInput.focus();
  persist();
}

function newSessionId() {
  const uuid = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `mosfs-extension-${uuid}`;
}

function limitText(value, maxChars) {
  const text = String(value || "");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated ${text.length - maxChars} chars]`;
}
