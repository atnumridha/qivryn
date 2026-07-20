const NATIVE_HOST_NAME = "com.local.mosfs_chrome_agent";
const MAX_LIVE_JSON_CHARS = 220000;
const QIVRYN_WORKSPACE_ROOT = "/Users/amridha/Documents/MOS_Automations";
const QIVRYN_WORKSPACE_STORAGE_KEY = "qivryn.workspaceRoot.v1";
const QIVRYN_UI_PATH = "qivryn/index.html";
const QIVRYN_DEFAULT_MODEL = "gpt-5.5";
const QIVRYN_DEFAULT_REASONING_EFFORT = "medium";
const QIVRYN_REASONING_LEVELS = ["low", "medium", "high", "xhigh"];
const LAST_CONTEXT_TAB_KEY = "qivryn.lastContextTab.v1";
const LAST_CONTEXT_SNAPSHOT_KEY = "qivryn.lastContextSnapshot.v1";
const NATIVE_MESSAGE_TIMEOUT_MS = 180000;
const QIVRYN_MODEL = {
  title: QIVRYN_DEFAULT_MODEL,
  provider: "openai",
  underlyingProviderName: "openai",
  model: QIVRYN_DEFAULT_MODEL,
  contextLength: 272000,
  completionOptions: {
    reasoning: true,
    reasoningBudgetTokens: 2048,
  },
  requestOptions: {
    extraBodyProperties: {
      _reasoningLevels: QIVRYN_REASONING_LEVELS,
      reasoning_effort: QIVRYN_DEFAULT_REASONING_EFFORT,
    },
  },
  capabilities: {
    tools: true,
  },
};
const BROWSER_CONTROL_TOOLS = [
  {
    type: "function",
    displayTitle: "Browser control",
    wouldLikeTo: "control the current browser tab",
    isCurrently: "controlling the current browser tab",
    hasAlready: "controlled the current browser tab",
    readonly: false,
    isInstant: false,
    group: "Browser",
    defaultToolPolicy: "allowedWithoutPermission",
    toolCallIcon: "CursorArrowRaysIcon",
    function: {
      name: "browser_control",
      description:
        "Inspect, screenshot, navigate, refresh, click, type, press keys, scroll, wait, select values, submit forms, update DOM values/text/attributes, dispatch DOM events, or evaluate explicit JavaScript in the currently open non-Qivryn browser tab. Use inspect before mutating actions and prefer selectors over coordinates.",
      parameters: {
        type: "object",
        required: ["action"],
        properties: {
          action: {
            type: "string",
            enum: [
              "inspect",
              "screenshot",
              "navigate",
              "refresh",
              "click",
              "type",
              "press",
              "scroll",
              "wait",
              "select",
              "submit",
              "set_value",
              "set_text",
              "set_attribute",
              "dispatch",
              "evaluate",
            ],
          },
          url: { type: "string", description: "URL for navigate." },
          selector: {
            type: "string",
            description:
              "CSS selector for click, type, press, wait, select, or submit.",
          },
          text: {
            type: "string",
            description:
              "Text to type, text to find for click/wait, or option value for select.",
          },
          x: { type: "number", description: "Viewport X coordinate fallback." },
          y: { type: "number", description: "Viewport Y coordinate fallback." },
          replace: {
            type: "boolean",
            description: "Replace existing field text when typing.",
          },
          key: {
            type: "string",
            description: "Keyboard key such as Enter, Tab, Escape.",
          },
          deltaX: { type: "number", description: "Horizontal scroll delta." },
          deltaY: { type: "number", description: "Vertical scroll delta." },
          milliseconds: { type: "number", minimum: 0, maximum: 30000 },
          bypassCache: {
            type: "boolean",
            description: "Bypass cache when refreshing.",
          },
          includeScreenshot: {
            type: "boolean",
            description: "Capture screenshot after the action.",
          },
          value: {
            type: "string",
            description: "Value for set_value or set_attribute.",
          },
          attribute: {
            type: "string",
            description: "Attribute name for set_attribute.",
          },
          event: {
            type: "string",
            description: "DOM event name for dispatch.",
          },
          code: {
            type: "string",
            description:
              "JavaScript expression or function body to evaluate in the current tab for explicit DOM behaviour changes.",
          },
        },
      },
    },
    systemMessageDescription: {
      prefix:
        "Use browser_control to operate the user's current browser tab. Inspect first, then use stable selectors. Do not type credentials or submit customer-visible changes unless the user explicitly requested that exact action.",
    },
  },
  {
    type: "function",
    displayTitle: "Browser observe",
    wouldLikeTo: "monitor the current browser tab for changes",
    isCurrently: "monitoring the current browser tab for changes",
    hasAlready: "monitored the current browser tab for changes",
    readonly: false,
    isInstant: false,
    group: "Browser",
    defaultToolPolicy: "allowedWithPermission",
    toolCallIcon: "ArrowPathIcon",
    function: {
      name: "browser_observe",
      description:
        "Monitor the current non-Qivryn browser tab for URL, title, SR, or visible-text changes. Can refresh between checks and capture a screenshot when a change is detected.",
      parameters: {
        type: "object",
        properties: {
          cycles: { type: "number", minimum: 1, maximum: 30 },
          intervalMs: { type: "number", minimum: 1000, maximum: 60000 },
          refresh: { type: "boolean" },
          bypassCache: { type: "boolean" },
          watchText: { type: "string" },
          captureOnChange: { type: "boolean" },
        },
      },
    },
    systemMessageDescription: {
      prefix:
        "Use browser_observe to watch the user's current browser tab for bounded refresh-and-check monitoring. Keep cycles and interval narrow.",
    },
  },
];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) =>
      sendResponse({ ok: false, error: error.message || String(error) }),
    );
  return true;
});

chrome.action.onClicked.addListener((tab) => {
  void toggleQivrynOverlayFromAction(tab).catch((error) => {
    console.error("Failed to open Qivryn overlay", error);
  });
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void rememberContextTabById(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" || changeInfo.url) {
    void rememberContextTab(tab || { id: tabId, url: changeInfo.url || "" });
  }
});

async function handleMessage(message, sender) {
  const contextTabId = messageContextTabId(message, sender);
  switch (message.type) {
    case "status":
      return sendNative({ type: "status" });
    case "list-models":
      return sendNative({ type: "list_models" });
    case "inventory":
      return sendNative({ type: "inventory" });
    case "list-mcp-tools":
      return sendNative({ type: "list_mcp_tools", server: message.server });
    case "call-mcp-tool":
      return sendNativeWithTab({
        type: "call_mcp_tool",
        server: message.server,
        tool: message.tool,
        arguments: message.arguments || {},
        confirm: message.confirm,
        confirmText: message.confirmText,
        contextTabId,
      });
    case "qivryn-protocol":
      return qivrynProtocol({ ...message, contextTabId });
    case "active-tab":
      return {
        ok: true,
        tabContext: await activeTabContext(contextTabId),
      };
    case "browser-control":
      return {
        ok: true,
        result: await browserControl({
          ...(message.args || {}),
          contextTabId: contextTabId || message.args?.contextTabId,
        }),
      };
    case "browser-observe":
      return {
        ok: true,
        result: await browserObserve({
          ...(message.args || {}),
          contextTabId: contextTabId || message.args?.contextTabId,
        }),
      };
    case "open-qivryn-ui":
      return openQivrynUiFromCurrentWindow(contextTabId);
    case "toggle-qivryn-overlay":
      return toggleQivrynOverlayFromCurrentWindow(contextTabId);
    case "minimize-qivryn-ui":
      return minimizeQivrynUi(contextTabId, sender?.tab?.id);
    case "agent-status":
      return sendNative({ type: "agent_status" });
    case "agent-events":
      return sendNative({
        type: "agent_events",
        runId: message.runId,
        afterSequence: message.afterSequence,
      });
    case "agent-message":
      return sendAgentMessage({ ...message, contextTabId });
    case "fetch-sr":
      return fetchSrLiveFirst({ ...message, contextTabId });
    case "analyze-sr":
      return sendNativeWithLiveSr({
        type: "analyze_sr",
        srNumber: message.srNumber,
        model: message.model,
        reasoningEffort: message.reasoningEffort,
        prompt: message.prompt,
        contextTabId,
      });
    case "ask":
      return sendNativeWithLiveSr({
        type: "ask",
        srNumber: message.srNumber,
        model: message.model,
        reasoningEffort: message.reasoningEffort,
        prompt: message.prompt,
        includeLiveSr: message.includeLiveSr,
        contextTabId,
      });
    case "dry-run-action-plan":
      return sendNativeWithTab({
        type: "dry_run_action_plan",
        srNumber: message.srNumber,
        actionPlan: message.actionPlan,
        contextTabId,
      });
    case "post-action-plan":
      return sendNativeWithTab({
        type: "post_action_plan",
        srNumber: message.srNumber,
        actionPlan: message.actionPlan,
        confirm: message.confirm,
        confirmText: message.confirmText,
        contextTabId,
      });
    case "run-mosfs-tool":
      return sendNativeWithTab({
        type: "run_mosfs_tool",
        tool: message.tool,
        args: message.args || [],
        confirm: message.confirm,
        confirmText: message.confirmText,
        contextTabId,
      });
    default:
      return { ok: false, error: `Unknown message type: ${message.type}` };
  }
}

async function qivrynProtocol(message) {
  try {
    const content = await qivrynProtocolContent(
      message.messageType,
      message.data,
      {
        contextTabId: normalizeTabId(message.contextTabId),
        surface: String(message.surface || ""),
        workspaceRoot: message.workspaceRoot,
      },
    );
    return { status: "success", content };
  } catch (error) {
    return { status: "error", error: error.message || String(error) };
  }
}

async function qivrynProtocolContent(messageType, data, context = {}) {
  if (String(messageType || "").startsWith("reviews/")) {
    const response = await sendNative({
      type: "qivryn_review",
      messageType,
      data,
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Qivryn review request failed.");
    }
    return response.content;
  }

  switch (messageType) {
    case "config/getSerializedProfileInfo":
      return {
        profileId: "mosfs-extension",
        profiles: [],
        result: {
          config: await qivrynConfig(),
          errors: [],
          configLoadInterrupted: false,
        },
      };
    case "config/refreshProfiles":
      return {
        profileId: "mosfs-extension",
        profiles: [],
        result: {
          config: await qivrynConfig(),
          errors: [],
          configLoadInterrupted: false,
        },
      };
    case "config/updateSelectedModel":
    case "config/addModel":
    case "config/openProfile":
    case "config/deleteRule":
    case "config/addLocalWorkspaceBlock":
    case "config/newAssistantFile":
    case "config/newPromptFile":
    case "docs/initStatuses":
    case "devdata/log":
    case "showToast":
    case "abort":
    case "rejectDiff":
    case "copyText":
    case "voice/transcribeCancel":
    case "voice/captureCancel":
      return undefined;
    case "config/updateSharedConfig":
      return data || {};
    case "llm/compileChat":
      return compileQivrynChat(data);
    case "conversation/compact":
      return "Earlier MOSFS extension context was compacted.";
    case "chatDescriber/describe":
      return "MOSFS browser session";
    case "getWorkspaceDirs":
      return [workspaceUri(await selectedWorkspaceRoot(context.workspaceRoot))];
    case "getOpenFiles":
      return [];
    case "getCurrentFile":
      return {
        isUntitled: false,
        contents:
          "MOSFS Chrome extension active tab context is available through the extension bridge.",
        path: `${workspaceUri(await selectedWorkspaceRoot(context.workspaceRoot))}/README.md`,
      };
    case "fileExists":
      return true;
    case "readFile":
      return "";
    case "context/getContextItems":
      return [];
    case "context/getSymbolsForFiles":
      return {};
    case "tools/evaluatePolicy":
      return evaluateBrowserToolPolicy(data);
    case "tools/preprocessArgs":
      return { preprocessedArgs: undefined };
    case "tools/call":
      return await callQivrynTool(data?.toolCall, context);
    case "history/list":
      return [];
    case "history/load":
      return qivrynEmptySession(data?.id);
    case "history/save":
    case "history/delete":
    case "history/clear":
      return undefined;
    case "session/openInMain":
      return false;
    case "session/share":
      return undefined;
    case "extensions/skills":
      return {
        skills: [
          {
            name: "mosfs",
            description:
              "Fetch and analyze Oracle MOSFS Service Requests with guarded update workflows.",
            path: "/Users/amridha/.codex/skills/mosfs/SKILL.md",
            readOnly: true,
            provenance: "Codex",
            scope: "user",
            files: [],
          },
        ],
        errors: [],
      };
    case "extensions/plugins":
      return [];
    case "extensions/codexImportPreview":
      return {
        version: 1,
        sourceRoot: "/Users/amridha/.codex",
        scannedAt: new Date().toISOString(),
        items: [],
        counts: {
          mcp: 0,
          plugin: 0,
          skill: 1,
          hook: 0,
          rule: 0,
          agent: 0,
          automation: 0,
        },
        issues: [],
      };
    case "browser/list":
      return await qivrynBrowserList(context);
    case "browser/events":
    case "browser/grants":
      return [];
    case "agents/list":
      return qivrynAgentRuns();
    case "agents/automations":
      return [];
    case "agents/queue":
      return qivrynAgentQueue(data);
    case "agents/checkpoints":
      return qivrynAgentCheckpoints(data);
    case "agents/plans":
      return qivrynAgentPlans(data);
    case "agents/events":
      return qivrynAgentEvents(data);
    case "terminal/jobs":
    case "docs/getIndexedPages":
    case "getFileResults":
      return [];
    case "slack/status":
    case "slack/revoke":
    case "runCommand":
      return undefined;
    case "slack/channels":
    case "slack/messages":
      return [];
    case "agents/status":
      return {
        state: "ready",
        checkedAt: new Date().toISOString(),
        source: "mosfs-chrome-extension",
        capabilities: {
          local: true,
          remote: false,
          persistent: true,
          worktrees: false,
          checkpoints: false,
          browser: true,
          review: false,
          maxConcurrency: 1,
        },
      };
    case "agents/selectRepository":
      return await chooseRepositoryRoot(context.workspaceRoot);
    case "agents/control":
      return qivrynAgentsControl({
        ...(data || {}),
        contextTabId: context.contextTabId,
        workspaceRoot: await selectedWorkspaceRoot(context.workspaceRoot),
      });
    case "models/fetch":
      return await qivrynModels();
    case "process/killTerminalProcess":
      return undefined;
    case "voice/captureStart":
      return { captureId: "mosfs-extension-capture", recorder: "browser" };
    case "voice/captureStop":
      return { audioBase64: "", mimeType: "audio/webm" };
    case "voice/transcribe":
      throw new Error(
        "Voice transcription is not wired in the MOSFS Chrome extension bridge.",
      );
    default:
      return undefined;
  }
}

function qivrynModelFromCodex(item) {
  const slug = String(
    item?.slug || item?.model || item?.id || item?.title || "",
  ).trim();
  const title = String(
    item?.displayName ||
      item?.display_name ||
      item?.name ||
      item?.title ||
      slug,
  ).trim();
  if (!slug && !title) return null;
  const modelId = slug || title;
  const contextLength = Number(
    item?.contextLength ||
      item?.context_window ||
      item?.context_length ||
      item?.max_context_tokens ||
      QIVRYN_MODEL.contextLength,
  );
  return {
    ...QIVRYN_MODEL,
    title: title || modelId,
    model: modelId,
    contextLength:
      Number.isFinite(contextLength) && contextLength > 0
        ? contextLength
        : QIVRYN_MODEL.contextLength,
  };
}

async function qivrynModels() {
  const response = await sendNative({ type: "list_models" });
  const models = Array.isArray(response?.models)
    ? response.models.map(qivrynModelFromCodex).filter(Boolean)
    : [];
  return models.length ? models : [QIVRYN_MODEL];
}

async function qivrynConfig() {
  const models = await qivrynModels();
  const selected =
    models.find(
      (model) =>
        model.model === QIVRYN_DEFAULT_MODEL ||
        model.title === QIVRYN_DEFAULT_MODEL,
    ) ||
    models[0] ||
    QIVRYN_MODEL;

  return {
    tools: BROWSER_CONTROL_TOOLS,
    slashCommands: [],
    contextProviders: [],
    mcpServerStatuses: [],
    modelsByRole: {
      chat: models,
      apply: [],
      edit: models,
      summarize: [],
      autocomplete: [],
      rerank: [],
      embed: [],
      subagent: models,
    },
    selectedModelByRole: {
      chat: selected,
      apply: null,
      edit: selected,
      summarize: null,
      autocomplete: null,
      rerank: null,
      embed: null,
      subagent: selected,
    },
    rules: [
      {
        name: "MOSFS Chrome Extension",
        rule: "Use active-tab MOSFS evidence first. Do not expose tokens, cookies, or auth headers. For writes, dry-run and require explicit confirmation before posting.",
      },
    ],
    ui: {
      showSessionTabs: false,
      showChatScrollbar: true,
    },
    experimental: {
      defaultContext: [],
    },
  };
}

function compileQivrynChat(data) {
  const messages = Array.isArray(data?.messages) ? data.messages : [];
  const charCount = JSON.stringify(messages).length;
  const inputTokens = Math.max(1, Math.ceil(charCount / 4));
  const contextLength = QIVRYN_MODEL.contextLength;
  return {
    compiledChatMessages: messages,
    didPrune: false,
    contextPercentage: Math.min(0.95, inputTokens / contextLength),
    inputTokens,
    contextLength,
    availableTokens: Math.max(0, contextLength - inputTokens),
  };
}

function evaluateBrowserToolPolicy(data) {
  const toolName = String(data?.toolName || "");
  const args = data?.processedArgs || data?.parsedArgs || {};
  if (toolName === "browser_observe") {
    return {
      policy: "allowedWithPermission",
      displayValue: "monitor current tab with bounded refresh checks",
    };
  }
  if (toolName !== "browser_control") {
    return {
      policy: data?.basePolicy || "allowedWithoutPermission",
      displayValue: undefined,
    };
  }
  const action = String(args.action || "").toLowerCase();
  if (["inspect", "screenshot", "wait"].includes(action)) {
    return {
      policy: "allowedWithoutPermission",
      displayValue: action || undefined,
    };
  }
  return {
    policy: "allowedWithPermission",
    displayValue: action || "browser action",
  };
}

async function callQivrynTool(toolCall, context = {}) {
  const name = String(toolCall?.function?.name || "");
  const args = parseToolArguments(toolCall?.function?.arguments);
  if (context.contextTabId && !args.contextTabId) {
    args.contextTabId = context.contextTabId;
  }
  if (name === "browser_control") return browserControl(args);
  if (name === "browser_observe") return browserObserve(args);
  return {
    contextItems: [
      {
        content: `Unsupported Qivryn tool: ${name || "unknown"}`,
        name: "Tool call not supported",
        description: "Qivryn Chrome extension bridge",
      },
    ],
    errorMessage: `Unsupported Qivryn tool: ${name || "unknown"}`,
  };
}

function parseToolArguments(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function browserControl(args) {
  const action = String(args?.action || "").toLowerCase();
  const { tab, source } = await resolveContextTab(args?.contextTabId);
  if (!isContextCandidateTab(tab)) {
    throw new Error("No controllable non-Qivryn browser tab is available.");
  }

  let result;
  switch (action) {
    case "inspect":
      result = await inspectBrowserTab(tab, source);
      break;
    case "screenshot":
      result = await captureTabScreenshot(tab);
      break;
    case "navigate":
      result = await navigateBrowserTab(tab, args);
      break;
    case "refresh":
      result = await refreshBrowserTab(tab, args);
      break;
    case "click":
      result = await clickBrowserTab(tab, args);
      break;
    case "type":
      result = await typeInBrowserTab(tab, args);
      break;
    case "press":
      result = await pressInBrowserTab(tab, args);
      break;
    case "scroll":
      result = await scrollBrowserTab(tab, args);
      break;
    case "wait":
      result = await domAction(tab, "wait", args);
      break;
    case "select":
      result = await domAction(tab, "select", args);
      break;
    case "submit":
      result = await domAction(tab, "submit", args);
      break;
    case "set_value":
      result = await domAction(tab, "set_value", args);
      break;
    case "set_text":
      result = await domAction(tab, "set_text", args);
      break;
    case "set_attribute":
      result = await domAction(tab, "set_attribute", args);
      break;
    case "dispatch":
      result = await domAction(tab, "dispatch", args);
      break;
    case "evaluate":
      result = await domAction(tab, "evaluate", args);
      break;
    default:
      throw new Error(
        `Unsupported browser_control action: ${action || "missing"}`,
      );
  }

  if (args?.includeScreenshot && action !== "screenshot") {
    result.screenshot = await captureTabScreenshot(tab);
  }
  return toolContextResult(
    "Browser control",
    `browser_control:${action}`,
    result,
  );
}

async function browserObserve(args) {
  const cycles = clampInteger(args?.cycles ?? 6, 1, 30);
  const intervalMs = clampInteger(args?.intervalMs ?? 5000, 1000, 60000);
  const refresh = args?.refresh !== false;
  const watchText = String(args?.watchText || "");
  const observations = [];
  const changes = [];
  let previous = null;
  let screenshot = null;

  for (let index = 0; index < cycles; index += 1) {
    const { tab, source } = await resolveContextTab(args?.contextTabId);
    if (!isContextCandidateTab(tab)) {
      throw new Error("No controllable non-Qivryn browser tab is available.");
    }
    if (index > 0 && refresh) {
      await refreshBrowserTab(tab, {
        bypassCache: !!args?.bypassCache,
        waitMs: 30000,
      });
    }
    const context = await activeTabContext(tab.id);
    const snapshot = pageSnapshot(context, watchText);
    observations.push({
      cycle: index + 1,
      checkedAt: new Date().toISOString(),
      contextSource: source,
      ...snapshot.public,
    });
    if (previous) {
      const delta = compareSnapshots(previous, snapshot);
      if (delta.length) {
        const change = {
          cycle: index + 1,
          detectedAt: new Date().toISOString(),
          changes: delta,
        };
        changes.push(change);
        if (args?.captureOnChange && !screenshot) {
          screenshot = await captureTabScreenshot(tab);
        }
      }
    }
    previous = snapshot;
    if (index < cycles - 1) await sleep(intervalMs);
  }

  return toolContextResult("Browser observe", "browser_observe", {
    ok: true,
    cycles,
    intervalMs,
    refresh,
    watchText: watchText || undefined,
    changed: changes.length > 0,
    changes,
    observations,
    screenshot,
  });
}

async function inspectBrowserTab(tab, source) {
  const context = await activeTabContext(tab.id);
  const dom = await domAction(tab, "inspect", {});
  return {
    ok: true,
    contextSource: source,
    tab: tabSummary(tab),
    context,
    dom,
  };
}

async function navigateBrowserTab(tab, args) {
  const url = safeNavigateUrl(args?.url);
  await cdpAction(tab.id, async (send) => {
    await send("Page.enable");
    await send("Page.navigate", { url });
  });
  await waitForTabLoad(tab.id, 30000).catch(() => undefined);
  const updated = await getTabById(tab.id);
  if (updated) await rememberContextTab(updated);
  return {
    ok: true,
    action: "navigate",
    tab: tabSummary(updated || tab),
  };
}

async function refreshBrowserTab(tab, args = {}) {
  await chromeCall(chrome.tabs.reload, tab.id, {
    bypassCache: !!args.bypassCache,
  });
  await waitForTabLoad(
    tab.id,
    clampInteger(args.waitMs ?? 30000, 1000, 60000),
  ).catch(() => undefined);
  const updated = await getTabById(tab.id);
  return {
    ok: true,
    action: "refresh",
    bypassCache: !!args.bypassCache,
    tab: tabSummary(updated || tab),
  };
}

async function captureTabScreenshot(tab) {
  const screenshot = await cdpAction(tab.id, async (send) => {
    await send("Page.enable");
    return send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
      fromSurface: true,
    });
  });
  const dataUrl = `data:image/png;base64,${screenshot.data || ""}`;
  return {
    ok: true,
    action: "screenshot",
    format: "png",
    tab: tabSummary(tab),
    byteLength: Math.ceil((screenshot.data || "").length * 0.75),
    dataUrl,
  };
}

async function clickBrowserTab(tab, args) {
  const point = await resolveBrowserPoint(tab, args);
  await cdpAction(tab.id, async (send) => {
    await send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
      button: "none",
    });
    await send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1,
    });
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1,
    });
  });
  return {
    ok: true,
    action: "click",
    target: point,
    tab: tabSummary((await getTabById(tab.id)) || tab),
  };
}

async function typeInBrowserTab(tab, args) {
  await domAction(tab, "focus", args);
  await cdpAction(tab.id, async (send) => {
    if (args?.replace) {
      await send(
        "Input.dispatchKeyEvent",
        keyboardEvent("keyDown", "a", { modifiers: 2 }),
      );
      await send(
        "Input.dispatchKeyEvent",
        keyboardEvent("keyUp", "a", { modifiers: 2 }),
      );
    }
    await send("Input.insertText", { text: String(args?.text || "") });
  });
  return {
    ok: true,
    action: "type",
    textLength: String(args?.text || "").length,
    selector: args?.selector || "",
    tab: tabSummary(tab),
  };
}

async function pressInBrowserTab(tab, args) {
  const key = String(args?.key || "Enter");
  await domAction(tab, "focus", args).catch(() => undefined);
  await cdpAction(tab.id, async (send) => {
    await send("Input.dispatchKeyEvent", keyboardEvent("keyDown", key));
    await send("Input.dispatchKeyEvent", keyboardEvent("keyUp", key));
  });
  return {
    ok: true,
    action: "press",
    key,
    selector: args?.selector || "",
    tab: tabSummary(tab),
  };
}

async function scrollBrowserTab(tab, args) {
  const viewport = await domAction(tab, "viewport", {});
  const x = Number.isFinite(Number(args?.x))
    ? Number(args.x)
    : Math.round((viewport.width || 1200) / 2);
  const y = Number.isFinite(Number(args?.y))
    ? Number(args.y)
    : Math.round((viewport.height || 800) / 2);
  const deltaX = Number(args?.deltaX || 0);
  const deltaY = Number(args?.deltaY ?? 600);
  await cdpAction(tab.id, async (send) => {
    await send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x,
      y,
      deltaX,
      deltaY,
    });
  });
  return {
    ok: true,
    action: "scroll",
    x,
    y,
    deltaX,
    deltaY,
    tab: tabSummary(tab),
  };
}

async function resolveBrowserPoint(tab, args) {
  if (Number.isFinite(Number(args?.x)) && Number.isFinite(Number(args?.y))) {
    return {
      x: Number(args.x),
      y: Number(args.y),
      source: "coordinates",
    };
  }
  const result = await domAction(tab, "point", args);
  if (
    !Number.isFinite(Number(result?.x)) ||
    !Number.isFinite(Number(result?.y))
  ) {
    throw new Error(
      "Could not resolve a browser target point. Provide selector or x/y.",
    );
  }
  return result;
}

async function domAction(tab, action, args) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: browserDomAction,
    args: [action, args || {}],
  });
  if (result?.result?.ok === false) {
    throw new Error(
      result.result.error || `Browser DOM action failed: ${action}`,
    );
  }
  return result?.result;
}

function browserDomAction(action, args) {
  const clean = (value, limit = 4000) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, limit);
  const cssPath = (element) => {
    if (!element || element.nodeType !== 1) return "";
    if (element.id) return `#${CSS.escape(element.id)}`;
    const parts = [];
    let node = element;
    while (node && node.nodeType === 1 && parts.length < 5) {
      let part = node.localName;
      if (node.classList?.length) {
        part += `.${Array.from(node.classList)
          .slice(0, 2)
          .map((value) => CSS.escape(value))
          .join(".")}`;
      }
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (child) => child.localName === node.localName,
        );
        if (siblings.length > 1)
          part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(" > ");
  };
  const isVisible = (element) => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none"
    );
  };
  const describe = (element) => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      selector: cssPath(element),
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role") || "",
      type: element.getAttribute("type") || "",
      text: clean(
        element.innerText ||
          element.value ||
          element.getAttribute("aria-label") ||
          element.title ||
          "",
        300,
      ),
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      rect: {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    };
  };
  const serializeDomResult = (value, depth = 0) => {
    if (value instanceof Element) return describe(value);
    if (value instanceof Node) return clean(value.textContent || "", 1000);
    if (value === undefined || value === null) return value ?? null;
    if (["string", "number", "boolean"].includes(typeof value)) {
      return typeof value === "string" ? clean(value, 12000) : value;
    }
    if (depth >= 3) return clean(String(value), 1000);
    if (Array.isArray(value)) {
      return value
        .slice(0, 50)
        .map((item) => serializeDomResult(item, depth + 1));
    }
    if (typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .slice(0, 50)
          .map(([key, item]) => [key, serializeDomResult(item, depth + 1)]),
      );
    }
    return clean(String(value), 1000);
  };
  const findElement = () => {
    if (args.selector) {
      const selected = document.querySelector(String(args.selector));
      if (!selected) throw new Error(`Selector not found: ${args.selector}`);
      return selected;
    }
    if (args.text) {
      const needle = clean(args.text, 1000).toLowerCase();
      const candidates = Array.from(
        document.querySelectorAll(
          "button,a,input,textarea,select,[role='button'],[onclick],[contenteditable='true']",
        ),
      );
      const found = candidates.find((element) => {
        const haystack = clean(
          element.innerText ||
            element.value ||
            element.getAttribute("aria-label") ||
            element.title ||
            element.placeholder ||
            "",
          1000,
        ).toLowerCase();
        return isVisible(element) && haystack.includes(needle);
      });
      if (found) return found;
    }
    if (Number.isFinite(Number(args.x)) && Number.isFinite(Number(args.y))) {
      const found = document.elementFromPoint(Number(args.x), Number(args.y));
      if (found) return found;
    }
    if (["focus", "type", "press"].includes(action) && document.activeElement)
      return document.activeElement;
    throw new Error(
      "No target element matched. Provide selector, text, or x/y.",
    );
  };
  const waitFor = async () => {
    const deadline =
      Date.now() +
      Math.min(30000, Math.max(0, Number(args.milliseconds || 10000)));
    let lastError = "";
    while (Date.now() <= deadline) {
      try {
        if (
          args.text &&
          clean(document.body?.innerText || "", 50000).includes(
            String(args.text),
          )
        ) {
          return {
            ok: true,
            action: "wait",
            matched: "text",
            text: String(args.text),
          };
        }
        const element = findElement();
        if (element && isVisible(element))
          return {
            ok: true,
            action: "wait",
            matched: "element",
            target: describe(element),
          };
      } catch (error) {
        lastError = error?.message || String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return {
      ok: false,
      error: lastError || "Timed out waiting for browser condition.",
    };
  };

  try {
    switch (action) {
      case "inspect": {
        const interactive = Array.from(
          document.querySelectorAll(
            "button,a,input,textarea,select,[role='button'],[onclick],[contenteditable='true']",
          ),
        )
          .filter(isVisible)
          .slice(0, 100)
          .map(describe);
        return {
          ok: true,
          action,
          url: location.href,
          title: document.title,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          selectedText: clean(
            window.getSelection ? window.getSelection().toString() : "",
            12000,
          ),
          visibleText: clean(document.body?.innerText || "", 24000),
          interactive,
        };
      }
      case "viewport":
        return {
          ok: true,
          width: window.innerWidth,
          height: window.innerHeight,
        };
      case "point": {
        const element = findElement();
        const target = describe(element);
        return {
          ok: true,
          ...target,
          source: args.selector
            ? "selector"
            : args.text
              ? "text"
              : "coordinates",
        };
      }
      case "focus": {
        const element = findElement();
        element.focus();
        if (args.replace && typeof element.select === "function")
          element.select();
        return { ok: true, action, target: describe(element) };
      }
      case "wait":
        return waitFor();
      case "select": {
        const element = findElement();
        element.focus();
        element.value = String(args.text || "");
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return {
          ok: true,
          action,
          target: describe(element),
          value: String(args.text || ""),
        };
      }
      case "submit": {
        const element = findElement();
        const form = element.closest("form");
        if (form?.requestSubmit) form.requestSubmit();
        else if (form) form.submit();
        else element.click();
        return {
          ok: true,
          action,
          target: describe(element),
          submittedForm: !!form,
        };
      }
      case "set_value": {
        const element = findElement();
        const value = String(args.value ?? args.text ?? "");
        element.focus();
        if ("value" in element) element.value = value;
        else element.textContent = value;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return {
          ok: true,
          action,
          target: describe(element),
          valueLength: value.length,
        };
      }
      case "set_text": {
        const element = findElement();
        const value = String(args.value ?? args.text ?? "");
        element.textContent = value;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return {
          ok: true,
          action,
          target: describe(element),
          valueLength: value.length,
        };
      }
      case "set_attribute": {
        const element = findElement();
        const attribute = String(args.attribute || "").trim();
        if (!/^[A-Za-z_][\w:.-]*$/.test(attribute)) {
          throw new Error(
            "A valid attribute name is required for set_attribute.",
          );
        }
        const value = String(args.value ?? args.text ?? "");
        element.setAttribute(attribute, value);
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return {
          ok: true,
          action,
          target: describe(element),
          attribute,
          valueLength: value.length,
        };
      }
      case "dispatch": {
        const element = findElement();
        const eventName = String(args.event || args.text || "click").trim();
        if (!/^[A-Za-z][\w:-]*$/.test(eventName)) {
          throw new Error("A valid DOM event name is required for dispatch.");
        }
        const event = new Event(eventName, { bubbles: true, cancelable: true });
        const accepted = element.dispatchEvent(event);
        return {
          ok: true,
          action,
          target: describe(element),
          event: eventName,
          accepted,
        };
      }
      case "evaluate": {
        const code = String(args.code || args.text || "").trim();
        if (!code) throw new Error("JavaScript code is required for evaluate.");
        const hasPoint =
          Number.isFinite(Number(args.x)) && Number.isFinite(Number(args.y));
        const element = args.selector || hasPoint ? findElement() : null;
        let value;
        try {
          value = Function(
            "args",
            "element",
            "document",
            "window",
            `"use strict";\n${code}`,
          )(args, element, document, window);
        } catch (error) {
          value = Function(
            "args",
            "element",
            "document",
            "window",
            `"use strict";\nreturn (${code});`,
          )(args, element, document, window);
        }
        return {
          ok: true,
          action,
          target: element ? describe(element) : undefined,
          result: serializeDomResult(value),
        };
      }
      default:
        return { ok: false, error: `Unsupported DOM action: ${action}` };
    }
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

async function cdpAction(tabId, callback) {
  const target = { tabId };
  let attached = false;
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      chrome.debugger.sendCommand(target, method, params, (result) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) reject(new Error(runtimeError.message));
        else resolve(result || {});
      });
    });
  try {
    await new Promise((resolve, reject) => {
      chrome.debugger.attach(target, "1.3", () => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) reject(new Error(runtimeError.message));
        else {
          attached = true;
          resolve();
        }
      });
    });
    return await callback(send);
  } finally {
    if (attached) {
      await new Promise((resolve) => {
        chrome.debugger.detach(target, () => resolve());
      });
    }
  }
}

function keyboardEvent(type, key, options = {}) {
  const map = {
    Enter: {
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    },
    Tab: { code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 },
    Escape: {
      code: "Escape",
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    },
    Backspace: {
      code: "Backspace",
      windowsVirtualKeyCode: 8,
      nativeVirtualKeyCode: 8,
    },
    Delete: {
      code: "Delete",
      windowsVirtualKeyCode: 46,
      nativeVirtualKeyCode: 46,
    },
    ArrowDown: {
      code: "ArrowDown",
      windowsVirtualKeyCode: 40,
      nativeVirtualKeyCode: 40,
    },
    ArrowUp: {
      code: "ArrowUp",
      windowsVirtualKeyCode: 38,
      nativeVirtualKeyCode: 38,
    },
    ArrowLeft: {
      code: "ArrowLeft",
      windowsVirtualKeyCode: 37,
      nativeVirtualKeyCode: 37,
    },
    ArrowRight: {
      code: "ArrowRight",
      windowsVirtualKeyCode: 39,
      nativeVirtualKeyCode: 39,
    },
  };
  const normalized =
    map[key] ||
    (key.length === 1
      ? {
          code: `Key${key.toUpperCase()}`,
          windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0),
          nativeVirtualKeyCode: key.toUpperCase().charCodeAt(0),
          text: key,
        }
      : { code: key, windowsVirtualKeyCode: 0, nativeVirtualKeyCode: 0 });
  return {
    type,
    key,
    code: normalized.code,
    windowsVirtualKeyCode: normalized.windowsVirtualKeyCode,
    nativeVirtualKeyCode: normalized.nativeVirtualKeyCode,
    modifiers: options.modifiers || 0,
    ...(normalized.text && type === "keyDown"
      ? { text: normalized.text, unmodifiedText: normalized.text }
      : {}),
  };
}

function safeNavigateUrl(value) {
  const url = new URL(String(value || ""));
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`Unsupported navigation protocol: ${url.protocol}`);
  }
  return url.href;
}

function toolContextResult(name, description, result) {
  const screenshotUrl = result?.dataUrl || result?.screenshot?.dataUrl || "";
  const content = JSON.stringify(redactLargeDataUrls(result), null, 2);
  const item = {
    name,
    description,
    content: limitText(content, 60000),
  };
  if (screenshotUrl) {
    item.uri = { type: "url", value: screenshotUrl };
    item.content += `\n\nScreenshot data URL length: ${screenshotUrl.length}`;
  }
  return { contextItems: [item] };
}

function redactLargeDataUrls(value) {
  if (typeof value === "string") {
    if (value.startsWith("data:image/"))
      return `[image data URL, ${value.length} chars]`;
    return value;
  }
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactLargeDataUrls);
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      redactLargeDataUrls(item),
    ]),
  );
}

function tabSummary(tab) {
  return {
    tabId: tab?.id,
    windowId: tab?.windowId,
    url: tab?.url || "",
    title: tab?.title || "",
  };
}

function pageSnapshot(context, watchText) {
  const visibleText = String(context?.visibleText || "");
  return {
    public: {
      url: context?.url || "",
      title: context?.title || "",
      srNumber: context?.srNumber || "",
      statusCd: context?.statusCd || "",
      watchTextPresent: watchText ? visibleText.includes(watchText) : undefined,
      visibleTextHash: hashText(visibleText),
    },
    visibleText,
  };
}

function compareSnapshots(previous, current) {
  const changes = [];
  for (const key of [
    "url",
    "title",
    "srNumber",
    "statusCd",
    "watchTextPresent",
    "visibleTextHash",
  ]) {
    if (previous.public[key] !== current.public[key]) {
      changes.push({
        field: key,
        before: previous.public[key],
        after: current.public[key],
      });
    }
  }
  return changes;
}

function hashText(value) {
  const text = String(value || "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function clampInteger(value, min, max) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chromeCall(fn, ...args) {
  return new Promise((resolve, reject) => {
    fn.call(chrome.tabs, ...args, (result) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) reject(new Error(runtimeError.message));
      else resolve(result);
    });
  });
}

function waitForTabLoad(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Timed out waiting for tab load."));
    }, timeoutMs);
    const listener = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(tab);
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) return;
      if (tab?.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(tab);
      }
    });
  });
}

function workspaceUri(root = QIVRYN_WORKSPACE_ROOT) {
  return `file://${cleanWorkspaceRoot(root) || QIVRYN_WORKSPACE_ROOT}`;
}

function cleanWorkspaceRoot(value) {
  const text = String(value || "")
    .replace(/^file:\/\//, "")
    .trim();
  if (!text) return "";
  return text === "~" || text.startsWith("~/") || text.startsWith("/")
    ? text
    : "";
}

async function selectedWorkspaceRoot(preferredRoot) {
  const preferred = cleanWorkspaceRoot(preferredRoot);
  if (preferred) {
    await chrome.storage.local
      .set({ [QIVRYN_WORKSPACE_STORAGE_KEY]: preferred })
      .catch(() => undefined);
    return preferred;
  }
  const stored = await chrome.storage.local
    .get(QIVRYN_WORKSPACE_STORAGE_KEY)
    .catch(() => ({}));
  return (
    cleanWorkspaceRoot(stored?.[QIVRYN_WORKSPACE_STORAGE_KEY]) ||
    QIVRYN_WORKSPACE_ROOT
  );
}

async function chooseRepositoryRoot(preferredRoot) {
  const currentRoot = await selectedWorkspaceRoot(preferredRoot);
  const response = await sendNative({
    type: "select_folder",
    defaultPath: currentRoot,
    prompt: "Choose Qivryn repository folder",
  });
  if (!response?.ok) {
    throw new Error(response?.error || "Folder selection failed.");
  }
  if (response.canceled || !response.path) {
    return workspaceUri(currentRoot);
  }
  const selected = cleanWorkspaceRoot(response.path);
  if (!selected) {
    throw new Error("Folder picker returned an invalid path.");
  }
  await chrome.storage.local
    .set({ [QIVRYN_WORKSPACE_STORAGE_KEY]: selected })
    .catch(() => undefined);
  return workspaceUri(selected);
}

function qivrynEmptySession(id) {
  return {
    sessionId: id || crypto.randomUUID(),
    title: "MOSFS browser session",
    workspaceDirectory: workspaceUri(),
    history: [],
    mode: "agent",
    chatModelTitle: QIVRYN_DEFAULT_MODEL,
  };
}

function qivrynAgentRun(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: "qivryn-browser-session",
    revision: 0,
    title: "Qivryn browser session",
    prompt: "Use the current browser tab context.",
    status: "running",
    createdAt: overrides.createdAt || now,
    updatedAt: now,
    permissionMode: "autonomous",
    runtimeId: "chrome-extension",
    workspace: {
      id: "mosfs-automations",
      location: "local",
      repositoryPath: QIVRYN_WORKSPACE_ROOT,
      branch: "",
      retained: true,
    },
    ...overrides,
  };
}

function qivrynAgentRuns() {
  return [qivrynAgentRun()];
}

function normalizeAgentEvents(events, fallbackRunId) {
  if (!Array.isArray(events)) return [];
  const usedSequences = new Set();
  return events
    .flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      if (typeof item.kind !== "string" || !item.kind.trim()) return [];
      const runId =
        typeof item.runId === "string" && item.runId.trim()
          ? item.runId
          : fallbackRunId || "qivryn-browser-session";
      let sequence = Number(item.sequence);
      if (!Number.isFinite(sequence) || sequence <= 0) {
        sequence = index + 1;
      }
      while (usedSequences.has(sequence)) sequence += 1;
      usedSequences.add(sequence);
      return [
        {
          id:
            typeof item.id === "string" && item.id.trim()
              ? item.id
              : `${runId}-event-${sequence}`,
          runId,
          sequence,
          kind: item.kind,
          createdAt:
            typeof item.createdAt === "string" && item.createdAt.trim()
              ? item.createdAt
              : new Date().toISOString(),
          payload: item.payload ?? {},
        },
      ];
    })
    .sort((a, b) => a.sequence - b.sequence);
}

function qivrynAgentEvents(data) {
  const runId = data?.runId || "qivryn-browser-session";
  return normalizeAgentEvents(
    [
      {
        id: `${runId}-ready`,
        runId,
        sequence: 1,
        kind: "run.created",
        createdAt: new Date().toISOString(),
        payload: {
          title: "Qivryn browser session",
          source: "chrome-extension",
        },
      },
    ],
    runId,
  );
}

function qivrynAgentQueue() {
  return [];
}

function qivrynAgentCheckpoints(data) {
  const runId = data?.runId || "qivryn-browser-session";
  return [
    {
      id: `${runId}-current-tab`,
      runId,
      createdAt: new Date().toISOString(),
      label: "Current browser tab context",
      description: "Pinned to the web tab that opened the Qivryn popup.",
    },
  ];
}

function qivrynAgentPlans() {
  return [];
}

async function qivrynBrowserList(context = {}) {
  const tabContext = await activeTabContext(context.contextTabId).catch(
    (error) => ({
      error: error.message || String(error),
    }),
  );
  if (tabContext?.error) return [];
  return [
    {
      id: `tab-${tabContext.tabId}`,
      tabId: tabContext.tabId,
      windowId: tabContext.windowId,
      title: tabContext.title || "Current browser tab",
      url: tabContext.url || "",
      active: true,
      contextSource: tabContext.contextSource,
    },
  ];
}

async function qivrynAgentsControl(data) {
  if (data?.action === "queue.add") {
    return {
      id: `queue-${Date.now()}`,
      runId: data.runId || `mosfs-extension-${Date.now()}`,
      position: 1,
      behavior: data.behavior || "steer",
      createdAt: new Date().toISOString(),
    };
  }
  if (data?.action !== "run.create") {
    return undefined;
  }
  const request = data.request || {};
  const response = await sendAgentMessage({
    prompt: request.prompt || "Review the active MOSFS tab.",
    model: request.model || QIVRYN_DEFAULT_MODEL,
    reasoningEffort:
      request.metadata?.reasoningEffort || QIVRYN_DEFAULT_REASONING_EFFORT,
    activeRunId: request.id,
    contextTabId: data?.contextTabId || request.contextTabId,
    workspaceRoot: data?.workspaceRoot || request.workspaceRoot,
  });
  if (!response.ok) {
    throw new Error(response.error || "Qivryn agent run failed.");
  }
  return (
    response.run ||
    qivrynAgentRun({
      id: request.id || `qivryn-run-${Date.now()}`,
      title: request.title || "Qivryn browser task",
      prompt: request.prompt || "",
    })
  );
}

async function sendNativeWithTab(message) {
  const tabContext = await activeTabContext(message.contextTabId).catch(
    (error) => ({ error: error.message || String(error) }),
  );
  return sendNative({ ...message, tabContext });
}

async function sendNativeWithLiveSr(message) {
  const tabContext = await activeTabContext(message.contextTabId).catch(
    (error) => ({ error: error.message || String(error) }),
  );
  const srNumber = srNumberFromMessageAndContext(message, tabContext);
  let liveSrMarkdown = "";
  let liveSrError = "";
  if (srNumber && message.includeLiveSr !== false) {
    const live = await fetchSrFromActiveTab(srNumber, tabContext).catch(
      (error) => ({ ok: false, error: error.message || String(error) }),
    );
    if (live.ok) {
      liveSrMarkdown = renderLiveSrMarkdown(live);
    } else {
      liveSrError = live.error || "Active-tab live SR fetch failed.";
    }
  }
  return sendNative({
    ...message,
    srNumber: srNumber || message.srNumber,
    tabContext,
    liveSrMarkdown,
    liveSrError,
  });
}

async function sendAgentMessage(message) {
  const workspaceRoot = await selectedWorkspaceRoot(message.workspaceRoot);
  const tabContext = await activeTabContext(message.contextTabId).catch(
    (error) => ({ error: error.message || String(error) }),
  );
  const srNumber = srNumberFromMessageAndContext(message, tabContext);
  let liveSrMarkdown = "";
  let liveSrError = "";
  if (srNumber) {
    const live = await fetchSrFromActiveTab(srNumber, tabContext).catch(
      (error) => ({ ok: false, error: error.message || String(error) }),
    );
    if (live.ok) {
      liveSrMarkdown = renderLiveSrMarkdown(live);
    } else {
      liveSrError = live.error || "Active-tab live SR fetch failed.";
    }
  }
  return sendNative({
    type: "agent_message",
    prompt: message.prompt,
    sessionId: message.sessionId,
    workspaceRoot,
    srNumber,
    activeRunId: message.activeRunId,
    model: message.model,
    reasoningEffort: message.reasoningEffort,
    tabContext,
    liveSrMarkdown,
    liveSrError,
  });
}

async function fetchSrLiveFirst(message) {
  const tabContext = await activeTabContext(message.contextTabId).catch(
    (error) => ({ error: error.message || String(error) }),
  );
  const srNumber = srNumberFromMessageAndContext(message, tabContext);
  if (!srNumber) {
    return {
      ok: false,
      error: "No SR number was provided or detected from the active tab.",
      tabContext,
    };
  }

  const live = await fetchSrFromActiveTab(srNumber, tabContext).catch(
    (error) => ({ ok: false, error: error.message || String(error) }),
  );
  if (live.ok) {
    const liveSrMarkdown = renderLiveSrMarkdown(live);
    return {
      ok: true,
      source: "active-tab-live-session",
      srNumber,
      tabContext,
      liveSrMarkdown,
      stdout: liveSrMarkdown,
      stderr: "",
    };
  }

  const fallback = await sendNative({
    type: "fetch_sr",
    srNumber,
    tabContext,
    liveSrError: live.error || "Active-tab live SR fetch failed.",
  });
  return {
    ...fallback,
    source: fallback?.ok
      ? "native-mosfs-helper-fallback"
      : "active-tab-live-session-failed",
    liveSrError: live.error || "Active-tab live SR fetch failed.",
  };
}

async function sendNative(message) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({
        ok: false,
        error: "Native host request timed out before returning a response.",
        timedOut: true,
      });
    }, NATIVE_MESSAGE_TIMEOUT_MS);
    chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, message, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        resolve({
          ok: false,
          error: runtimeError.message,
          installHint:
            "Install the native host with npm run install:native-hosts -- --chrome-extension-id <extension-id>.",
        });
        return;
      }
      resolve(
        response || { ok: false, error: "Native host returned no response." },
      );
    });
  });
}

function isQivrynExtensionUrl(url) {
  const text = String(url || "");
  return (
    text.startsWith(chrome.runtime.getURL("qivryn/")) ||
    text === chrome.runtime.getURL("popup.html")
  );
}

function qivrynUiUrl(contextTabId) {
  const url = chrome.runtime.getURL(QIVRYN_UI_PATH);
  const tabId = normalizeTabId(contextTabId);
  return tabId
    ? `${url}?contextTabId=${encodeURIComponent(String(tabId))}`
    : url;
}

async function toggleQivrynOverlayFromAction(sourceTab, options = {}) {
  await rememberContextTab(sourceTab);
  if (!sourceTab?.id || isBrowserInternalUrl(sourceTab.url)) {
    return {
      ok: false,
      error: "Qivryn can only open on top of a normal web page tab.",
      url: sourceTab?.url || "",
    };
  }

  await chrome.scripting.insertCSS({
    target: { tabId: sourceTab.id },
    files: ["qivryn-overlay.css"],
  });
  if (options.mode) {
    await chrome.scripting.executeScript({
      target: { tabId: sourceTab.id },
      func: (mode) => {
        globalThis.__qivrynOverlayMode = mode;
      },
      args: [options.mode],
    });
  }
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: sourceTab.id },
    files: ["qivryn-overlay.js"],
  });
  return result?.result || { ok: true, visible: true };
}

async function openQivrynUiFromAction(sourceTab) {
  await rememberContextTab(sourceTab);

  const qivrynTabs = await chrome.tabs.query({
    url: chrome.runtime.getURL("qivryn/*"),
  });
  const existing =
    qivrynTabs.find((tab) => tab.windowId === sourceTab?.windowId) ||
    qivrynTabs[0];
  const targetUrl = qivrynUiUrl(sourceTab?.id);
  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true, url: targetUrl });
    if (existing.windowId) {
      await chrome.windows
        .update(existing.windowId, { focused: true })
        .catch(() => undefined);
    }
    return { ok: true, tabId: existing.id, reused: true, url: targetUrl };
  }

  const createProperties = {
    url: targetUrl,
    active: true,
  };
  if (sourceTab?.windowId) {
    createProperties.windowId = sourceTab.windowId;
  }
  if (typeof sourceTab?.index === "number") {
    createProperties.index = sourceTab.index + 1;
  }
  const created = await chrome.tabs.create(createProperties);
  return {
    ok: true,
    tabId: created.id,
    reused: false,
    url: created.url || targetUrl,
  };
}

async function openQivrynUiFromCurrentWindow(contextTabId) {
  const pinned = await getTabById(normalizeTabId(contextTabId));
  if (isContextCandidateTab(pinned)) {
    return openQivrynUiFromAction(pinned);
  }
  const { tab } = await activeContextCandidateTab();
  return openQivrynUiFromAction(tab);
}

async function toggleQivrynOverlayFromCurrentWindow(contextTabId) {
  const pinned = await getTabById(normalizeTabId(contextTabId));
  if (isContextCandidateTab(pinned)) {
    return toggleQivrynOverlayFromAction(pinned);
  }
  const { tab } = await activeContextCandidateTab();
  return toggleQivrynOverlayFromAction(tab);
}

async function minimizeQivrynUi(contextTabId, qivrynTabId) {
  const source = await getTabById(normalizeTabId(contextTabId));
  if (!isContextCandidateTab(source)) {
    return {
      ok: false,
      error: "The original tab for this Qivryn session is no longer available.",
    };
  }

  const overlay = await toggleQivrynOverlayFromAction(source, { mode: "show" });
  await chrome.tabs.update(source.id, { active: true });
  if (source.windowId) {
    await chrome.windows
      .update(source.windowId, { focused: true })
      .catch(() => undefined);
  }

  const qivrynTab = await getTabById(normalizeTabId(qivrynTabId));
  if (qivrynTab?.id && isQivrynExtensionUrl(qivrynTab.url)) {
    await chrome.tabs.remove(qivrynTab.id).catch(() => undefined);
  }

  return {
    ok: true,
    sourceTabId: source.id,
    closedTabId: qivrynTab?.id || null,
    overlay,
  };
}

function isBrowserInternalUrl(url) {
  const text = String(url || "");
  return (
    !text ||
    text.startsWith("chrome://") ||
    text.startsWith("edge://") ||
    text.startsWith("about:") ||
    text.startsWith("chrome-extension://")
  );
}

function isContextCandidateTab(tab) {
  return Boolean(
    tab?.id && !isBrowserInternalUrl(tab.url) && !isQivrynExtensionUrl(tab.url),
  );
}

async function activeContextCandidateTab() {
  const queries = [
    { active: true, lastFocusedWindow: true },
    { active: true, currentWindow: true },
  ];
  for (const query of queries) {
    try {
      const tabs = await chrome.tabs.query(query);
      const tab = Array.isArray(tabs) ? tabs.find(isContextCandidateTab) : null;
      if (tab) {
        await rememberContextTab(tab);
        return {
          tab,
          source: query.lastFocusedWindow
            ? "focused-window-active-tab"
            : "active-tab",
        };
      }
    } catch {
      // Fall through to the remembered non-Qivryn tab.
    }
  }
  return { tab: null, source: "" };
}

async function getTabById(tabId) {
  if (!tabId) return null;
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

function normalizeTabId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function senderContextTabId(sender) {
  return isContextCandidateTab(sender?.tab) ? sender.tab.id : undefined;
}

function messageContextTabId(message, sender) {
  return (
    normalizeTabId(message?.contextTabId) ||
    normalizeTabId(message?.args?.contextTabId) ||
    senderContextTabId(sender)
  );
}

async function rememberContextTabById(tabId) {
  const tab = await getTabById(tabId);
  await rememberContextTab(tab);
}

async function rememberContextTab(tab) {
  if (!isContextCandidateTab(tab)) return;
  await chrome.storage.local.set({
    [LAST_CONTEXT_TAB_KEY]: {
      tabId: tab.id,
      windowId: tab.windowId,
      url: tab.url || "",
      title: tab.title || "",
      savedAt: new Date().toISOString(),
    },
  });
}

function contextSnapshot(context) {
  if (!context || typeof context !== "object") return null;
  return {
    tabId: context.tabId,
    windowId: context.windowId,
    url: context.url || "",
    title: context.title || "",
    contextSource: context.contextSource || "saved-context",
    contextError: context.contextError || "",
    srNumber: context.srNumber || "",
    srMatches: Array.isArray(context.srMatches)
      ? context.srMatches.slice(0, 20)
      : [],
    visibleSrMatches: Array.isArray(context.visibleSrMatches)
      ? context.visibleSrMatches.slice(0, 20)
      : [],
    urlSrMatches: Array.isArray(context.urlSrMatches)
      ? context.urlSrMatches.slice(0, 20)
      : [],
    srNumberSource: context.srNumberSource || "",
    srNumberConflict: Boolean(context.srNumberConflict),
    urlSrNumber: context.urlSrNumber || "",
    srId: context.srId || "",
    statusCd: context.statusCd || "",
    crmRestBasePath: context.crmRestBasePath || "",
    resourcesVersion: context.resourcesVersion || "",
    urlParams:
      context.urlParams && typeof context.urlParams === "object"
        ? context.urlParams
        : {},
    visibleText: limitText(context.visibleText || "", 60000),
    savedAt: new Date().toISOString(),
  };
}

async function rememberContextSnapshot(context) {
  const snapshot = contextSnapshot(context);
  if (!snapshot) return;
  await chrome.storage.local.set({
    [LAST_CONTEXT_SNAPSHOT_KEY]: snapshot,
  });
}

async function rememberedContextTab() {
  const stored = await chrome.storage.local.get(LAST_CONTEXT_TAB_KEY);
  const saved = stored?.[LAST_CONTEXT_TAB_KEY];
  const tab = await getTabById(saved?.tabId);
  return isContextCandidateTab(tab) ? tab : null;
}

async function rememberedContextSnapshot() {
  const stored = await chrome.storage.local.get(LAST_CONTEXT_SNAPSHOT_KEY);
  const saved = stored?.[LAST_CONTEXT_SNAPSHOT_KEY];
  return saved && typeof saved === "object" ? saved : null;
}

async function resolveContextTab(preferredTabId) {
  const preferred = await getTabById(normalizeTabId(preferredTabId));
  if (isContextCandidateTab(preferred)) {
    await rememberContextTab(preferred);
    return { tab: preferred, source: "provided-context-tab" };
  }
  const active = await activeContextCandidateTab();
  if (active.tab) return active;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (isContextCandidateTab(tab)) {
    await rememberContextTab(tab);
    return { tab, source: "active-tab" };
  }
  const remembered = await rememberedContextTab();
  if (remembered) {
    return { tab: remembered, source: "last-non-qivryn-tab" };
  }
  if (tab?.id) {
    return {
      tab,
      source: isQivrynExtensionUrl(tab.url) ? "qivryn-ui-tab" : "active-tab",
    };
  }
  throw new Error("No active tab is available.");
}

async function activeTabContext(contextTabId) {
  let resolved;
  try {
    resolved = await resolveContextTab(contextTabId);
  } catch (error) {
    const snapshot = await rememberedContextSnapshot();
    if (snapshot) {
      return {
        ...snapshot,
        contextSource: "last-saved-context",
        contextError: error.message || String(error),
      };
    }
    throw error;
  }
  const { tab, source } = resolved;
  const base = {
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.url || "",
    title: tab.title || "",
    contextSource: source,
  };
  if (isBrowserInternalUrl(tab.url)) {
    await rememberContextSnapshot(base);
    return base;
  }
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: collectPageContext,
    });
    const context = mergePageContexts(
      base,
      results.map((result) => result?.result).filter(Boolean),
      tab.url || "",
    );
    await rememberContextSnapshot(context);
    return context;
  } catch (error) {
    const context = {
      ...base,
      contextError: error.message || String(error),
    };
    await rememberContextSnapshot(context);
    return context;
  }
}

function uniqueStringsFrom(...values) {
  const out = [];
  for (const value of values.flat(Infinity)) {
    const text = String(value || "").trim();
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}

function firstTextValue(contexts, key) {
  for (const context of contexts) {
    const value = String(context?.[key] || "").trim();
    if (value) return value;
  }
  return "";
}

function mergePageContexts(base, pageContexts, tabUrl = "") {
  const contexts = Array.isArray(pageContexts)
    ? pageContexts.filter((context) => context && typeof context === "object")
    : [];
  if (!contexts.length) return base;

  const main =
    contexts.find((context) => context.url === tabUrl) ||
    contexts.find((context) => context.url === base.url) ||
    contexts[0];
  const urlParams = {};
  for (const context of contexts) {
    if (context?.urlParams && typeof context.urlParams === "object") {
      Object.assign(urlParams, context.urlParams);
    }
  }

  const headings = uniqueStringsFrom(contexts.map((item) => item.headings));
  const selectedText = limitText(
    contexts
      .map((item) => item.selectedText || "")
      .filter(Boolean)
      .join("\n"),
    12000,
  );
  const visibleText = limitText(
    contexts
      .map((item) => item.visibleText || "")
      .filter(Boolean)
      .join("\n"),
    60000,
  );
  const visibleSrMatches = uniqueStringsFrom(
    contexts.map((item) => item.visibleSrMatches),
  );
  const urlSrMatches = uniqueStringsFrom(
    contexts.map((item) => item.urlSrMatches),
  );
  const srMatches = uniqueStringsFrom(
    visibleSrMatches,
    urlSrMatches,
    contexts.map((item) => item.srMatches),
  );
  const srNumber = visibleSrMatches[0] || urlSrMatches[0] || "";
  const urlSr = urlSrMatches[0] || "";
  const restSamples = uniqueStringsFrom(
    contexts.map((item) => item.restSamples),
  );

  return {
    ...base,
    ...main,
    tabId: base.tabId,
    windowId: base.windowId,
    url: main.url || base.url || "",
    title: main.title || base.title || "",
    contextSource: base.contextSource,
    selectedText,
    headings: headings.slice(0, 30),
    visibleText,
    srMatches: srMatches.slice(0, 30),
    visibleSrMatches: visibleSrMatches.slice(0, 30),
    urlSrMatches: urlSrMatches.slice(0, 30),
    urlParams,
    srNumber,
    srNumberSource: visibleSrMatches[0] ? "visible-page" : urlSr ? "url" : "",
    srNumberConflict: Boolean(srNumber && urlSr && srNumber !== urlSr),
    urlSrNumber: urlSr,
    srId:
      firstTextValue(contexts, "srId") ||
      urlParams.srId ||
      urlParams.SrId ||
      "",
    statusCd:
      firstTextValue(contexts, "statusCd") ||
      urlParams.StatusCd ||
      urlParams.statusCd ||
      "",
    crmRestOrigin: firstTextValue(contexts, "crmRestOrigin"),
    crmRestBasePath: firstTextValue(contexts, "crmRestBasePath"),
    crmRestBaseUrl: firstTextValue(contexts, "crmRestBaseUrl"),
    resourcesVersion: firstTextValue(contexts, "resourcesVersion"),
    restSamples: restSamples.slice(0, 30),
  };
}

async function fetchSrFromActiveTab(srNumber, tabContext) {
  let tab = null;
  let contextSource = tabContext?.contextSource || "";
  if (tabContext?.tabId && !isBrowserInternalUrl(tabContext?.url)) {
    tab = await getTabById(tabContext.tabId);
  }
  if (!isContextCandidateTab(tab)) {
    const resolved = await resolveContextTab();
    tab = resolved.tab;
    contextSource = resolved.source;
  }
  if (!tab?.id) throw new Error("No active tab is available.");
  if (isBrowserInternalUrl(tab.url)) {
    return {
      ok: false,
      error: "No MOSFS browser tab is available for live SR fetch.",
    };
  }
  const liveTabContext = {
    ...(tabContext || {}),
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.url || tabContext?.url || "",
    title: tab.title || tabContext?.title || "",
    contextSource,
  };
  const injection = {
    target: { tabId: tab.id },
    func: fetchSrFromPage,
    args: [srNumber, liveTabContext],
    world: "MAIN",
  };
  let result;
  try {
    [result] = await chrome.scripting.executeScript(injection);
  } catch (error) {
    [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: fetchSrFromPage,
      args: [srNumber, liveTabContext],
    });
  }
  return (
    result?.result || {
      ok: false,
      error: "Active-tab live SR fetch returned no result.",
    }
  );
}

function collectPageContext() {
  const cleanText = (value, limit = 16000) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, limit);
  const parseParams = () => {
    const out = {};
    try {
      const params = new URLSearchParams(location.search);
      for (const [key, value] of params.entries()) {
        if (key.toLowerCase() === "params") {
          try {
            const nested = JSON.parse(value);
            if (nested && typeof nested === "object") {
              for (const [nestedKey, nestedValue] of Object.entries(nested))
                out[nestedKey] = String(nestedValue || "");
            }
          } catch {
            out[key] = value;
          }
        } else {
          out[key] = value;
        }
      }
    } catch {
      return out;
    }
    return out;
  };
  const restInfo = () => {
    const candidates = [];
    try {
      candidates.push(location.href);
      for (const entry of performance
        .getEntriesByType("resource")
        .slice(-300)) {
        if (entry?.name) candidates.push(entry.name);
      }
    } catch {
      return {};
    }
    const restSamples = [];
    for (const value of candidates) {
      const text = String(value || "");
      const match = text.match(
        /^(https:\/\/[^/]+)\/(?:crmRestApi|fscmRestApi)\/rest\/([^/]+)\/([^/]+)\/([^/?#]+)/,
      );
      if (!match) continue;
      const [, origin, revision, language, version] = match;
      let sample = "";
      try {
        const url = new URL(text);
        sample = `${url.pathname}${url.search}`.slice(0, 900);
      } catch {
        sample = text.replace(origin, "").slice(0, 900);
      }
      if (sample && !restSamples.includes(sample)) restSamples.push(sample);
      return {
        crmRestOrigin: origin,
        crmRestBasePath: `/crmRestApi/rest/${revision}/${language}/${version}`,
        crmRestBaseUrl: `${origin}/crmRestApi/rest/${revision}/${language}/${version}`,
        resourcesVersion: version.split(":", 1)[0],
        restSamples: restSamples.slice(0, 20),
      };
    }
    return restSamples.length ? { restSamples: restSamples.slice(0, 20) } : {};
  };
  const urlParams = parseParams();
  const headings = Array.from(document.querySelectorAll("h1,h2,h3"))
    .slice(0, 12)
    .map((node) => cleanText(node.textContent, 300))
    .filter(Boolean);
  const collectVisibleDomText = () => {
    const out = [];
    let nodeCount = 0;
    let charCount = 0;
    const push = (value, limit = 300) => {
      if (charCount >= 24000) return;
      const text = cleanText(value, limit);
      if (!text) return;
      out.push(text);
      charCount += text.length + 1;
    };
    const isVisibleElement = (element) => {
      if (!element || element.nodeType !== 1) return false;
      if (element === document.body || element === document.documentElement)
        return true;
      try {
        const style = window.getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden")
          return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 || rect.height > 0;
      } catch {
        return true;
      }
    };
    const walkRoot = (root, depth = 0) => {
      if (!root || depth > 8 || nodeCount > 2500 || charCount >= 24000) return;
      let walker;
      try {
        walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      } catch {
        return;
      }
      let element = walker.currentNode;
      while (element && nodeCount <= 2500 && charCount < 24000) {
        nodeCount += 1;
        if (isVisibleElement(element)) {
          for (const attr of [
            "aria-label",
            "title",
            "alt",
            "placeholder",
            "data-testid",
          ]) {
            push(element.getAttribute?.(attr), 220);
          }
          if (
            "value" in element &&
            /^(input|textarea|select)$/i.test(element.tagName || "")
          ) {
            push(element.value, 220);
          }
          if (element.shadowRoot) {
            push(element.shadowRoot.textContent, 1800);
            walkRoot(element.shadowRoot, depth + 1);
          }
        }
        element = walker.nextNode();
      }
    };
    try {
      walkRoot(document.body || document.documentElement);
    } catch {
      return "";
    }
    return cleanText(out.join(" "), 24000);
  };
  const selectedText = cleanText(
    window.getSelection ? window.getSelection().toString() : "",
    12000,
  );
  const visibleText = cleanText(
    `${document.body ? document.body.innerText : ""} ${collectVisibleDomText()}`,
    24000,
  );
  const srPattern = /\b[34]-\d{10}\b/g;
  const uniqueSrMatches = (value) => [
    ...new Set(String(value || "").match(srPattern) || []),
  ];
  const urlSrNumber = String(urlParams.srNumber || urlParams.SrNumber || "");
  const urlSrMatches = [
    ...new Set([
      ...uniqueSrMatches(urlSrNumber),
      ...uniqueSrMatches(location.href),
    ]),
  ];
  const visibleSrMatches = uniqueSrMatches(
    `${visibleText} ${selectedText} ${headings.join(" ")} ${document.title}`,
  );
  const srMatches = [...new Set([...visibleSrMatches, ...urlSrMatches])];
  const srNumber = visibleSrMatches[0] || urlSrMatches[0] || "";
  const urlSr = urlSrMatches[0] || "";
  return {
    url: location.href,
    title: document.title,
    selectedText,
    headings,
    visibleText,
    srMatches,
    visibleSrMatches,
    urlSrMatches,
    urlParams,
    srNumber,
    srNumberSource: visibleSrMatches[0] ? "visible-page" : urlSr ? "url" : "",
    srNumberConflict: Boolean(srNumber && urlSr && srNumber !== urlSr),
    urlSrNumber: urlSr,
    srId: urlParams.srId || urlParams.SrId || "",
    statusCd: urlParams.StatusCd || urlParams.statusCd || "",
    ...restInfo(),
  };
}

async function fetchSrFromPage(srNumber, tabContext) {
  const maxJsonChars = 220000;
  const sr = String(srNumber || "").match(/\b[34]-\d{10}\b/)?.[0] || "";
  if (!sr) return { ok: false, error: "No valid SR number was provided." };

  const cleanText = (value, limit = 4000) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, limit);
  const sanitize = (value) =>
    String(value || "")
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
      .replace(
        /("?(?:access|refresh|id)_token"?\s*[:=]\s*")([^"]+)(")/gi,
        "$1[REDACTED]$3",
      )
      .replace(
        /((?:Cookie|Set-Cookie|X-XSRF-TOKEN|ECID|Authorization)\s*:\s*)([^\n\r]+)/gi,
        "$1[REDACTED]",
      )
      .replace(
        /([?&](?:access_token|id_token|refresh_token|xsrf|ecid)=)[^&\s]+/gi,
        "$1[REDACTED]",
      );
  const sanitizeObject = (value) => {
    if (typeof value === "string") return sanitize(value);
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map((item) => sanitizeObject(item));
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        if (/token|cookie|authorization|xsrf|ecid|credential|secret/i.test(key))
          return [key, "[REDACTED]"];
        return [key, sanitizeObject(item)];
      }),
    );
  };
  const publicUrl = (url) => {
    try {
      const parsed = new URL(url, location.origin);
      return `${parsed.pathname}${parsed.search}`.replace(
        /rv:[^/]+/g,
        "rv:<redacted>",
      );
    } catch {
      return sanitize(String(url || "")).replace(/rv:[^/]+/g, "rv:<redacted>");
    }
  };
  const discoverRest = () => {
    const candidates = [location.href];
    try {
      for (const entry of performance
        .getEntriesByType("resource")
        .slice(-500)) {
        if (entry?.name) candidates.push(entry.name);
      }
    } catch {
      // Ignore performance access issues and fall through to tabContext.
    }
    for (const value of candidates) {
      const match = String(value || "").match(
        /^(https:\/\/[^/]+)\/(?:crmRestApi|fscmRestApi)\/rest\/([^/]+)\/([^/]+)\/([^/?#]+)/,
      );
      if (!match) continue;
      const [, origin, revision, language, version] = match;
      return {
        origin,
        crmRestBasePath: `/crmRestApi/rest/${revision}/${language}/${version}`,
        resourcesVersion: version.split(":", 1)[0],
      };
    }
    return {
      origin: location.origin,
      crmRestBasePath: String(tabContext?.crmRestBasePath || ""),
      resourcesVersion: String(tabContext?.resourcesVersion || ""),
    };
  };
  const readUrlParams = () => {
    const out = {};
    try {
      const params = new URLSearchParams(location.search);
      for (const [key, value] of params.entries()) {
        if (key.toLowerCase() === "params") {
          try {
            Object.assign(out, JSON.parse(value));
          } catch {
            out[key] = value;
          }
        } else {
          out[key] = value;
        }
      }
    } catch {
      return out;
    }
    return out;
  };
  const rest = discoverRest();
  if (!rest.crmRestBasePath) {
    return {
      ok: false,
      error: "No CRM REST base path is visible in the active MOSFS tab yet.",
    };
  }
  const urlParams = { ...(tabContext?.urlParams || {}), ...readUrlParams() };
  const requestJson = async (label, path) => {
    const url = path.startsWith("/api/")
      ? `${rest.origin}${path}`
      : `${rest.origin}${rest.crmRestBasePath}${path}`;
    try {
      const response = await fetch(url, {
        method: "GET",
        credentials: "include",
        headers: {
          Accept: "application/json, text/plain, */*",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
      });
      const text = await response.text();
      let body = null;
      let parseError = "";
      try {
        body = text ? JSON.parse(text) : null;
      } catch (error) {
        parseError = error?.message || String(error);
        body = sanitize(text).slice(0, maxJsonChars);
      }
      const jsonText = JSON.stringify(body);
      const truncated = jsonText && jsonText.length > maxJsonChars;
      if (truncated) {
        body = {
          truncated: true,
          preview: sanitize(jsonText).slice(0, maxJsonChars),
        };
      }
      return {
        label,
        ok: response.ok,
        status: response.status,
        url: publicUrl(url),
        body: sanitizeObject(body),
        parseError,
        truncated,
      };
    } catch (error) {
      return {
        label,
        ok: false,
        status: 0,
        url: publicUrl(url),
        error: error?.message || String(error),
      };
    }
  };

  const encodedSr = encodeURIComponent(sr);
  const root = await requestJson(
    "serviceRequest",
    `/serviceRequests/${encodedSr}?onlyData=true`,
  );
  if (!root.ok) {
    return {
      ok: false,
      error: `Active-tab live SR fetch was rejected: ${root.status ? `HTTP ${root.status}` : root.error || "request failed"}.`,
      srNumber: sr,
      source: "active-tab-live-session",
      crmRestBasePath: rest.crmRestBasePath.replace(
        /rv:[^/]+/g,
        "rv:<redacted>",
      ),
      resourcesVersion: rest.resourcesVersion,
      root,
    };
  }

  const rootBody = root.body || {};
  const srId = String(
    rootBody.SrId ||
      rootBody.srId ||
      rootBody.ServiceRequestId ||
      urlParams.srId ||
      urlParams.SrId ||
      tabContext?.srId ||
      "",
  );
  const children = {};
  const childRequests = [
    [
      "messages",
      `/serviceRequests/${encodedSr}/child/messages?onlyData=true&orderBy=LastUpdateDate:desc&limit=50&offset=0`,
    ],
    [
      "activities",
      `/serviceRequests/${encodedSr}/child/activities?onlyData=true&orderBy=LastUpdateDate:desc&limit=30&offset=0`,
    ],
    [
      "contacts",
      `/serviceRequests/${encodedSr}/child/contacts?onlyData=true&limit=30&offset=0`,
    ],
    [
      "resourceMembers",
      `/serviceRequests/${encodedSr}/child/resourceMembers?onlyData=true&limit=30&offset=0`,
    ],
    [
      "attachments",
      `/serviceRequests/${encodedSr}/child/Attachment?onlyData=true&limit=30&offset=0`,
    ],
    [
      "references",
      `/serviceRequests/${encodedSr}/child/srReferences?onlyData=true&limit=30&offset=0`,
    ],
    [
      "milestones",
      `/serviceRequests/${encodedSr}/child/srMilestone?onlyData=true&limit=30&offset=0`,
    ],
    [
      "relatedUrls",
      `/serviceRequests/${encodedSr}/child/RelatedURLsCollection_c?onlyData=true&limit=30&offset=0`,
    ],
    [
      "defects",
      `/serviceRequests/${encodedSr}/child/DefectsToSRs_Tgt_ServiceRequestToDefectsToSRs_c_Tgt?onlyData=true&limit=30&offset=0`,
    ],
  ];
  for (const [label, path] of childRequests) {
    children[label] = await requestJson(label, path);
  }
  const history =
    srId && rest.resourcesVersion
      ? await requestJson(
          "history",
          `/api/sales-common/crmRestApi/resources/${encodeURIComponent(rest.resourcesVersion)}/feeds/ServiceRequest/${encodeURIComponent(srId)}/history?limit=20&offset=0&showPurge=true&sort=published%3Adesc`,
        )
      : null;

  return {
    ok: true,
    source: "active-tab-live-session",
    fetchedAt: new Date().toISOString(),
    srNumber: sr,
    srId,
    crmRestBasePath: rest.crmRestBasePath.replace(/rv:[^/]+/g, "rv:<redacted>"),
    resourcesVersion: rest.resourcesVersion,
    root,
    children,
    history,
    visibleContext: {
      title: cleanText(document.title, 300),
      url: publicUrl(location.href),
    },
  };
}

function renderLiveSrMarkdown(live) {
  const lines = [
    `# MOSFS Live SR Fetch: ${live.srNumber}`,
    "",
    `Source: ${live.source || "active-tab-live-session"}`,
    `Fetched at: ${live.fetchedAt || new Date().toISOString()}`,
    `SR ID: ${live.srId || "not visible"}`,
    `CRM REST base: ${live.crmRestBasePath || "not visible"}`,
    `Resources version: ${live.resourcesVersion || "not visible"}`,
    "",
    "This read used the active Chrome tab session. Auth headers, cookies, and token-like values are not returned by the extension.",
    "",
    "## Root Service Request",
    jsonBlock(live.root?.body || live.root || {}),
    "",
  ];
  const children = live.children || {};
  for (const [name, result] of Object.entries(children)) {
    lines.push(`## ${titleCase(name)}`);
    lines.push(
      `Status: ${result.status || 0}${result.ok ? "" : " (not available)"}`,
    );
    lines.push(
      jsonBlock(result.body || { error: result.error || "not available" }),
    );
    lines.push("");
  }
  if (live.history) {
    lines.push("## History");
    lines.push(
      `Status: ${live.history.status || 0}${live.history.ok ? "" : " (not available)"}`,
    );
    lines.push(
      jsonBlock(
        live.history.body || { error: live.history.error || "not available" },
      ),
    );
    lines.push("");
  }
  return limitText(lines.join("\n"), MAX_LIVE_JSON_CHARS);
}

function jsonBlock(value) {
  return `\`\`\`json\n${limitText(JSON.stringify(value, null, 2), MAX_LIVE_JSON_CHARS)}\n\`\`\``;
}

function extractSrNumber(value) {
  const match = String(value || "").match(/\b[34]-\d{10}\b/);
  return match ? match[0] : "";
}

function firstSrMatch(value) {
  return Array.isArray(value) ? extractSrNumber(value[0] || "") : "";
}

function srNumberFromMessageAndContext(message = {}, tabContext = {}) {
  return extractSrNumber(
    message.srNumber ||
      tabContext?.srNumber ||
      firstSrMatch(tabContext?.visibleSrMatches) ||
      firstSrMatch(tabContext?.srMatches) ||
      message.prompt ||
      tabContext?.url ||
      "",
  );
}

function titleCase(value) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function limitText(value, maxChars) {
  const text = String(value || "");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated ${text.length - maxChars} chars]`;
}
