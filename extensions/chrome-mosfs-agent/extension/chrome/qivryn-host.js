(function () {
  const DEFAULT_WORKSPACE_ROOT = "/Users/amridha/Documents/MOS_Automations";
  const searchParams = new URLSearchParams(window.location.search);
  const requestedSurface = searchParams.get("surface");
  const requestedContextTabId = Number.parseInt(
    searchParams.get("contextTabId") || "",
    10,
  );
  const pinnedContextTabId =
    Number.isInteger(requestedContextTabId) && requestedContextTabId > 0
      ? requestedContextTabId
      : undefined;
  let isEmbeddedSurface = false;
  try {
    isEmbeddedSurface = window.self !== window.top;
  } catch {
    isEmbeddedSurface = true;
  }
  const qivrynSurface =
    requestedSurface || (isEmbeddedSurface ? "overlay" : "tab");
  const DEFAULT_MODEL = "gpt-5.5";
  const DEFAULT_REASONING_EFFORT = "medium";
  const REASONING_LEVELS = ["low", "medium", "high", "xhigh"];
  const LOCAL_PROTOCOL_MISS = Symbol("qivryn-local-protocol-miss");
  const SKILLS_CACHE_KEY = "qivryn.skills.catalog.v2";
  const MODELS_CACHE_KEY = "qivryn.models.catalog.v1";
  const HISTORY_CACHE_KEY = "qivryn.history.sessions.v1";
  const WORKSPACE_STORAGE_KEY = "qivryn.workspaceRoot.v1";
  const WORKSPACE_SELECTED_KEY = "qivryn.workspaceRoot.userSelected.v1";
  const LAST_AGENT_REPOSITORY_KEY = "qivryn.agents.lastRepository";
  const BROWSER_SESSION_KEY = "qivryn.browserSessionId.v1";
  const UI_SESSION_KEY = "qivryn.uiSessionId.v1";
  const UI_SESSION_SCOPE_FIELD = "qivrynContextScopeId";
  const REDUX_PERSIST_KEY = "persist:root";
  const VSCODE_STATE_KEY_PREFIX = "qivryn.vscodeState";
  const CHROME_MESSAGE_TIMEOUT_MS = 180000;
  const BACKGROUND_FIRST_MESSAGES = new Set([
    "agents/selectRepository",
    "config/getSerializedProfileInfo",
    "config/refreshProfiles",
    "models/fetch",
    "tools/evaluatePolicy",
    "tools/preprocessArgs",
    "tools/call",
  ]);
  const MODEL = {
    title: DEFAULT_MODEL,
    provider: "openai",
    underlyingProviderName: "openai",
    model: DEFAULT_MODEL,
    contextLength: 272000,
    completionOptions: {
      reasoning: true,
      reasoningBudgetTokens: 2048,
    },
    requestOptions: {
      extraBodyProperties: {
        _reasoningLevels: REASONING_LEVELS,
        reasoning_effort: DEFAULT_REASONING_EFFORT,
      },
    },
    capabilities: {
      tools: true,
    },
  };
  const MOSFS_SKILL = {
    name: "mosfs",
    description:
      "Fetch and analyze Oracle MOSFS Service Requests with guarded update workflows.",
    path: "/Users/amridha/.codex/skills/mosfs/SKILL.md",
    readOnly: true,
    provenance: "Codex",
    scope: "user",
    files: [],
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
            url: { type: "string" },
            selector: { type: "string" },
            text: { type: "string" },
            x: { type: "number" },
            y: { type: "number" },
            replace: { type: "boolean" },
            key: { type: "string" },
            deltaX: { type: "number" },
            deltaY: { type: "number" },
            milliseconds: { type: "number", minimum: 0, maximum: 30000 },
            bypassCache: { type: "boolean" },
            includeScreenshot: { type: "boolean" },
            value: { type: "string" },
            attribute: { type: "string" },
            event: { type: "string" },
            code: { type: "string" },
          },
        },
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
    },
  ];

  window.isFullScreen = qivrynSurface === "tab";
  document.documentElement.dataset.qivrynSurface = qivrynSurface;
  let workspaceRoot = readWorkspaceRoot();
  window.workspacePaths = [workspaceRoot];
  window.vscMachineId = "mosfs-chrome-extension";
  window.vscMediaUrl = chrome.runtime.getURL("");
  window.qivrynChromeExtension = {
    source: "mosfs-chrome-extension",
    workspaceRoot,
    contextTabId: pinnedContextTabId,
  };
  seedPersistedBrowserSession();
  seedQivrynStorage();
  installTabMinimizeButton();
  let vscodeState = readVscodeState();

  function dispatchToQivryn(messageId, messageType, data) {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { messageId, messageType, data },
        origin: window.location.origin,
      }),
    );
  }

  function success(content) {
    return { status: "success", content };
  }

  function errorResponse(error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  function writeJsonStorage(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Local storage is a startup cache only. The protocol response remains authoritative.
    }
  }

  function contextScopeId() {
    return pinnedContextTabId ? `tab.${pinnedContextTabId}` : "default";
  }

  function scopedStorageKey(baseKey) {
    return `${baseKey}.${contextScopeId()}`;
  }

  function safeSessionId(value) {
    return String(value || "")
      .trim()
      .replace(/[^A-Za-z0-9_.:-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120);
  }

  function decodePersistedSlice(value) {
    if (!value) return {};
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value || "{}");
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? parsed
          : {};
      } catch {
        return {};
      }
    }
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  }

  function readPersistedReduxRoot() {
    try {
      const parsed = JSON.parse(
        window.localStorage.getItem(REDUX_PERSIST_KEY) || "{}",
      );
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch {
      return {};
    }
  }

  function readPersistedReduxSession() {
    return decodePersistedSlice(readPersistedReduxRoot().session);
  }

  function writePersistedReduxSession(patch = {}) {
    try {
      const root = readPersistedReduxRoot();
      const previous = decodePersistedSlice(root.session);
      root.session = JSON.stringify({
        ...previous,
        ...patch,
      });
      if (!root._persist) {
        root._persist = JSON.stringify({ version: 1, rehydrated: true });
      }
      window.localStorage.setItem(REDUX_PERSIST_KEY, JSON.stringify(root));
    } catch {
      // Redux persistence is best effort. The extension history store remains authoritative.
    }
  }

  function rememberUiSessionId(value) {
    const sessionId = safeSessionId(value);
    if (!sessionId) return "";
    try {
      window.localStorage.setItem(scopedStorageKey(UI_SESSION_KEY), sessionId);
      window.localStorage.setItem(
        scopedStorageKey(BROWSER_SESSION_KEY),
        sessionId,
      );
    } catch {
      // Best effort only.
    }
    return sessionId;
  }

  function currentUiSessionId() {
    try {
      const stored = safeSessionId(
        window.localStorage.getItem(scopedStorageKey(UI_SESSION_KEY)),
      );
      if (stored) return stored;
    } catch {
      // Fall through to persisted Redux state or a stable fallback.
    }

    const persistedSession = readPersistedReduxSession();
    const persisted = safeSessionId(persistedSession.id);
    const persistedScope = String(
      persistedSession[UI_SESSION_SCOPE_FIELD] || "",
    );
    if (persisted && (!persistedScope || persistedScope === contextScopeId())) {
      return rememberUiSessionId(persisted);
    }

    return rememberUiSessionId(`browser-${contextScopeId()}`);
  }

  function seedPersistedBrowserSession() {
    const sessionId = currentUiSessionId();
    if (!sessionId) return;
    const previous = readPersistedReduxSession();
    writePersistedReduxSession({
      id: sessionId,
      lastSessionId: sessionId,
      title: previous.title || "MOSFS browser session",
      mode: previous.mode || "agent",
      chatModelTitle: previous.chatModelTitle || DEFAULT_MODEL,
      [UI_SESSION_SCOPE_FIELD]: contextScopeId(),
    });
  }

  function installTabMinimizeButton() {
    if (qivrynSurface !== "tab" || !pinnedContextTabId) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "qivryn-tab-minimize-button";
    button.title = "Minimize Qivryn back onto the source tab";
    button.setAttribute("aria-label", "Minimize Qivryn to source tab overlay");

    const icon = document.createElement("span");
    icon.className = "qivryn-tab-minimize-icon";
    icon.textContent = "▣";
    const label = document.createElement("span");
    label.textContent = "Minimize";
    button.append(icon, label);

    button.addEventListener("click", () => {
      button.disabled = true;
      label.textContent = "Minimizing…";
      void sendChromeMessage({
        type: "minimize-qivryn-ui",
        contextTabId: pinnedContextTabId,
      })
        .then((response) => {
          if (!response?.ok) {
            throw new Error(response?.error || "Unable to minimize Qivryn.");
          }
        })
        .catch((error) => {
          button.disabled = false;
          label.textContent = "Minimize";
          button.title = error.message || String(error);
        });
    });

    document.documentElement.append(button);
  }

  function vscodeStateKey() {
    return `${VSCODE_STATE_KEY_PREFIX}.${contextScopeId()}.v2`;
  }

  function readVscodeState() {
    try {
      const parsed = JSON.parse(
        window.localStorage.getItem(vscodeStateKey()) || "{}",
      );
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch {
      return {};
    }
  }

  function writeVscodeState(state) {
    try {
      window.localStorage.setItem(
        vscodeStateKey(),
        JSON.stringify(state || {}),
      );
    } catch {
      // Webview state is recoverable from history/local Redux when available.
    }
  }

  function seedQivrynStorage() {
    writeJsonStorage(SKILLS_CACHE_KEY, [
      { ...MOSFS_SKILL, content: "", files: [] },
    ]);
    writeJsonStorage(MODELS_CACHE_KEY, {
      options: [
        {
          title: MODEL.title,
          value: MODEL.title,
        },
      ],
      selected: MODEL.title,
    });
    try {
      window.localStorage.setItem(LAST_AGENT_REPOSITORY_KEY, workspaceRoot);
    } catch {
      // Best effort only; protocol responses remain authoritative.
    }
  }

  function skillsCatalog() {
    return {
      skills: [MOSFS_SKILL],
      errors: [],
    };
  }

  function qivrynConfig() {
    return {
      tools: BROWSER_CONTROL_TOOLS,
      slashCommands: [],
      contextProviders: [],
      mcpServerStatuses: [],
      modelsByRole: {
        chat: [MODEL],
        apply: [],
        edit: [MODEL],
        summarize: [],
        autocomplete: [],
        rerank: [],
        embed: [],
        subagent: [MODEL],
      },
      selectedModelByRole: {
        chat: MODEL,
        apply: null,
        edit: MODEL,
        summarize: null,
        autocomplete: null,
        rerank: null,
        embed: null,
        subagent: MODEL,
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

  function serializedProfileInfo() {
    return {
      profileId: "mosfs-extension",
      profiles: [],
      result: {
        config: qivrynConfig(),
        errors: [],
        configLoadInterrupted: false,
      },
    };
  }

  function qivrynEmptySession(id) {
    return {
      sessionId: id || currentUiSessionId(),
      title: "MOSFS browser session",
      workspaceDirectory: workspaceUri(),
      history: [],
      mode: "agent",
      chatModelTitle: DEFAULT_MODEL,
    };
  }

  function workspaceUri() {
    return `file://${workspaceRoot}`;
  }

  function normalizeWorkspace(value) {
    return String(value || "").replace(/^file:\/\//, "");
  }

  function cleanWorkspaceRoot(value) {
    const text = normalizeWorkspace(value).trim();
    if (!text) return "";
    if (text === "~" || text.startsWith("~/")) return text;
    return text.startsWith("/") ? text : "";
  }

  function readWorkspaceRoot() {
    try {
      const hasUserSelectedWorkspace =
        window.localStorage.getItem(WORKSPACE_SELECTED_KEY) === "true";
      if (!hasUserSelectedWorkspace) {
        return DEFAULT_WORKSPACE_ROOT;
      }
      return (
        cleanWorkspaceRoot(
          window.localStorage.getItem(WORKSPACE_STORAGE_KEY),
        ) ||
        cleanWorkspaceRoot(
          window.localStorage.getItem(LAST_AGENT_REPOSITORY_KEY),
        ) ||
        DEFAULT_WORKSPACE_ROOT
      );
    } catch {
      return DEFAULT_WORKSPACE_ROOT;
    }
  }

  function setWorkspaceRoot(value) {
    const next = cleanWorkspaceRoot(value) || DEFAULT_WORKSPACE_ROOT;
    workspaceRoot = next;
    window.workspacePaths = [next];
    if (window.qivrynChromeExtension) {
      window.qivrynChromeExtension.workspaceRoot = next;
    }
    try {
      window.localStorage.setItem(WORKSPACE_STORAGE_KEY, next);
      window.localStorage.setItem(LAST_AGENT_REPOSITORY_KEY, next);
      window.localStorage.setItem(WORKSPACE_SELECTED_KEY, "true");
    } catch {
      // Best effort only.
    }
    try {
      chrome.storage?.local?.set?.({ [WORKSPACE_STORAGE_KEY]: next });
    } catch {
      // Best effort only.
    }
    return workspaceUri();
  }

  function browserSessionId() {
    return currentUiSessionId();
  }

  function qivrynAgentRun(overrides = {}) {
    const now = new Date().toISOString();
    const runId = currentUiSessionId();
    return {
      id: runId,
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
        repositoryPath: workspaceRoot,
        branch: "",
        retained: true,
      },
      ...overrides,
    };
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
            : fallbackRunId || currentUiSessionId();
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
    const runId = data?.runId || currentUiSessionId();
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

  function readHistoryStore() {
    try {
      const parsed = JSON.parse(
        window.localStorage.getItem(HISTORY_CACHE_KEY) || "{}",
      );
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeHistoryStore(store) {
    window.localStorage.setItem(HISTORY_CACHE_KEY, JSON.stringify(store || {}));
  }

  function agentEventsContentLooksValid(content) {
    return (
      Array.isArray(content) &&
      content.every(
        (item) =>
          item &&
          typeof item === "object" &&
          typeof item.kind === "string" &&
          item.kind.trim(),
      )
    );
  }

  function historyMetadata(session) {
    return {
      sessionId: session.sessionId,
      title: session.title || "MOSFS browser session",
      dateCreated:
        session.dateCreated || session.dateUpdated || new Date().toISOString(),
      dateUpdated:
        session.dateUpdated || session.dateCreated || new Date().toISOString(),
      workspaceDirectory: session.workspaceDirectory || workspaceUri(),
      messageCount: Array.isArray(session.history) ? session.history.length : 0,
    };
  }

  function historyList(options) {
    const store = readHistoryStore();
    const workspaceDirectory = normalizeWorkspace(options?.workspaceDirectory);
    const sessions = Object.values(store)
      .filter(
        (session) =>
          !workspaceDirectory ||
          normalizeWorkspace(session.workspaceDirectory) === workspaceDirectory,
      )
      .sort((a, b) =>
        String(b.dateUpdated || b.dateCreated || "").localeCompare(
          String(a.dateUpdated || a.dateCreated || ""),
        ),
      )
      .map(historyMetadata);
    const offset = Math.max(0, Number(options?.offset || 0));
    const limit = Number(options?.limit || 0);
    return limit > 0
      ? sessions.slice(offset, offset + limit)
      : sessions.slice(offset);
  }

  function historyLoad(id) {
    if (id) rememberUiSessionId(id);
    const store = readHistoryStore();
    return store[id] || qivrynEmptySession(id);
  }

  function historySave(session) {
    if (!session || typeof session !== "object") return undefined;
    const now = new Date().toISOString();
    const id = rememberUiSessionId(session.sessionId || currentUiSessionId());
    const store = readHistoryStore();
    const previous = store[id] || {};
    store[id] = {
      ...session,
      sessionId: id,
      title: session.title || previous.title || "MOSFS browser session",
      workspaceDirectory:
        session.workspaceDirectory ||
        previous.workspaceDirectory ||
        workspaceUri(),
      dateCreated: previous.dateCreated || session.dateCreated || now,
      dateUpdated: now,
    };
    writeHistoryStore(store);
    writePersistedReduxSession({
      id,
      lastSessionId: id,
      title: store[id].title,
      mode: store[id].mode || "agent",
      chatModelTitle: store[id].chatModelTitle || DEFAULT_MODEL,
      [UI_SESSION_SCOPE_FIELD]: contextScopeId(),
    });
    return undefined;
  }

  function historyDelete(id) {
    const store = readHistoryStore();
    delete store[id];
    writeHistoryStore(store);
    return undefined;
  }

  function codexImportPreview() {
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
  }

  function compileQivrynChat(data) {
    const messages = Array.isArray(data?.messages) ? data.messages : [];
    const charCount = JSON.stringify(messages).length;
    const inputTokens = Math.max(1, Math.ceil(charCount / 4));
    const contextLength = MODEL.contextLength;
    return {
      compiledChatMessages: messages,
      didPrune: false,
      contextPercentage: Math.min(0.95, inputTokens / contextLength),
      inputTokens,
      contextLength,
      availableTokens: Math.max(0, contextLength - inputTokens),
    };
  }

  function localProtocolContent(messageType, data) {
    switch (messageType) {
      case "config/getSerializedProfileInfo":
      case "config/refreshProfiles":
        return serializedProfileInfo();
      case "models/fetch":
        return [MODEL];
      case "llm/compileChat":
        return compileQivrynChat(data);
      case "conversation/compact":
        return "Earlier MOSFS extension context was compacted.";
      case "chatDescriber/describe":
        return "MOSFS browser session";
      case "getWorkspaceDirs":
        return [workspaceUri()];
      case "getOpenFiles":
        return [];
      case "getCurrentFile":
        return {
          isUntitled: false,
          contents:
            "MOSFS Chrome extension active tab context is available through the extension bridge.",
          path: `${workspaceUri()}/README.md`,
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
        return {
          policy: data?.basePolicy || "allowedWithoutPermission",
          displayValue: undefined,
        };
      case "tools/preprocessArgs":
        return { preprocessedArgs: undefined };
      case "tools/call":
        return LOCAL_PROTOCOL_MISS;
      case "history/list":
        return historyList(data);
      case "history/load":
        return historyLoad(data?.id);
      case "history/save":
        return historySave(data);
      case "history/delete":
        return historyDelete(data?.id);
      case "history/clear":
        writeHistoryStore({});
        return undefined;
      case "session/openInMain":
        return false;
      case "session/share":
        return undefined;
      case "extensions/skills":
        return skillsCatalog();
      case "extensions/plugins":
        return [];
      case "extensions/codexImportPreview":
        return codexImportPreview();
      case "browser/list":
        return LOCAL_PROTOCOL_MISS;
      case "browser/events":
      case "browser/grants":
        return [];
      case "agents/list":
        return [qivrynAgentRun()];
      case "agents/automations":
        return [];
      case "agents/queue":
        return [];
      case "agents/checkpoints":
        return [
          {
            id: "qivryn-browser-session-current-tab",
            runId: data?.runId || currentUiSessionId(),
            createdAt: new Date().toISOString(),
            label: "Current browser tab context",
            description: "Pinned to the web tab that opened the Qivryn popup.",
          },
        ];
      case "agents/plans":
        return [];
      case "agents/events":
        return qivrynAgentEvents(data);
      case "terminal/jobs":
      case "docs/getIndexedPages":
      case "getFileResults":
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
      case "process/killTerminalProcess":
        return undefined;
      case "voice/captureStart":
        return { captureId: "mosfs-extension-capture", recorder: "browser" };
      case "voice/captureStop":
        return { audioBase64: "", mimeType: "audio/webm" };
      case "config/updateSharedConfig":
        return data || {};
      case "config/updateSelectedModel":
      case "config/addModel":
      case "config/openProfile":
      case "config/deleteRule":
      case "config/addLocalWorkspaceBlock":
      case "config/newAssistantFile":
      case "config/newPromptFile":
      case "mcp/startAuthentication":
      case "mcp/removeAuthentication":
      case "mcp/setServerEnabled":
      case "mcp/reloadServer":
      case "docs/initStatuses":
      case "devdata/log":
      case "showToast":
      case "abort":
      case "rejectDiff":
      case "copyText":
      case "voice/transcribeCancel":
      case "voice/captureCancel":
      case "slack/status":
      case "slack/revoke":
      case "runCommand":
        return undefined;
      default:
        return LOCAL_PROTOCOL_MISS;
    }
  }

  function responseContentLooksValid(messageType, content) {
    switch (messageType) {
      case "extensions/skills":
        return (
          content &&
          Array.isArray(content.skills) &&
          Array.isArray(content.errors)
        );
      case "config/getSerializedProfileInfo":
      case "config/refreshProfiles":
        return (
          content &&
          content.result &&
          content.result.config &&
          Array.isArray(content.result.errors)
        );
      case "models/fetch":
        return Array.isArray(content);
      case "agents/events":
        return agentEventsContentLooksValid(content);
      case "llm/compileChat":
        return content && Array.isArray(content.compiledChatMessages);
      default:
        return true;
    }
  }

  function normalizeProtocolResponse(messageType, data, response) {
    const localContent = localProtocolContent(messageType, data);
    const localResponse =
      localContent === LOCAL_PROTOCOL_MISS ? undefined : success(localContent);

    if (response?.status === "success") {
      if (
        messageType === "agents/selectRepository" &&
        typeof response.content === "string"
      ) {
        return success(setWorkspaceRoot(response.content));
      }
      if (messageType === "agents/events") {
        const normalizedEvents = normalizeAgentEvents(
          response.content,
          data?.runId || currentUiSessionId(),
        );
        if (Array.isArray(response.content)) {
          return success(normalizedEvents);
        }
        return localResponse || success(normalizedEvents);
      }
      if (responseContentLooksValid(messageType, response.content)) {
        return response;
      }
      return localResponse || success(response.content);
    }

    if (response?.status === "error") {
      return localResponse || response;
    }

    if (localResponse) {
      return localResponse;
    }

    if (response?.ok === false) {
      return errorResponse(response.error || "Qivryn bridge request failed.");
    }

    return response || success(undefined);
  }

  function stringifyContent(content) {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) return content.map(stringifyContent).join("");
    if (!content || typeof content !== "object") return "";
    if (typeof content.text === "string") return content.text;
    if (typeof content.content === "string") return content.content;
    if (Array.isArray(content.content))
      return content.content.map(stringifyContent).join("");
    return "";
  }

  function promptFromMessages(messages) {
    const parts = [];
    for (const message of Array.isArray(messages) ? messages : []) {
      const role = message?.role || "message";
      const text = stringifyContent(message?.content).trim();
      if (!text) continue;
      parts.push(`${role.toUpperCase()}:\n${text}`);
    }
    return parts.join("\n\n").trim() || "Review the active MOSFS tab.";
  }

  function assistantTextFromAgentResponse(response) {
    if (!response?.ok) {
      throw new Error(response?.error || "Qivryn agent request failed.");
    }
    const eventText = Array.isArray(response.events)
      ? response.events
          .map((event) => event?.payload?.text || event?.payload?.output || "")
          .filter(Boolean)
          .join("\n")
          .trim()
      : "";
    return (
      eventText ||
      response.answer ||
      response.analysis ||
      response.stdout ||
      "Qivryn agent completed without visible text."
    );
  }

  async function sendChromeMessage(message) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(
          new Error(
            "Qivryn bridge request timed out before the native agent returned a response.",
          ),
        );
      }, CHROME_MESSAGE_TIMEOUT_MS);
      const contextualMessage = {
        ...message,
        surface: qivrynSurface,
        workspaceRoot,
        ...(pinnedContextTabId ? { contextTabId: pinnedContextTabId } : {}),
      };
      chrome.runtime.sendMessage(contextualMessage, (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        resolve(response);
      });
    });
  }

  async function handleStreamChat(message) {
    const data = message.data || {};
    const prompt = promptFromMessages(data.messages);
    const model = String(data.title || DEFAULT_MODEL);
    const response = await sendChromeMessage({
      type: "agent-message",
      prompt,
      sessionId: browserSessionId(),
      model,
      reasoningEffort:
        data.completionOptions?.reasoningEffort || DEFAULT_REASONING_EFFORT,
      ...(pinnedContextTabId ? { contextTabId: pinnedContextTabId } : {}),
    });
    const text = assistantTextFromAgentResponse(response);
    dispatchToQivryn(message.messageId, message.messageType, {
      done: false,
      // The Qivryn webview stream adapter batches individual content events.
      // Sending an array here creates ChatMessage[][] and the reducer drops it.
      content: { role: "assistant", content: text },
    });
    dispatchToQivryn(message.messageId, message.messageType, {
      done: true,
      content: {
        prompt,
        completion: text,
        modelTitle: model,
      },
    });
  }

  async function handleQivrynMessage(message) {
    if (message.messageType === "llm/streamChat") {
      await handleStreamChat(message);
      return;
    }

    const localContent = BACKGROUND_FIRST_MESSAGES.has(message.messageType)
      ? LOCAL_PROTOCOL_MISS
      : localProtocolContent(message.messageType, message.data);
    if (localContent !== LOCAL_PROTOCOL_MISS) {
      dispatchToQivryn(
        message.messageId,
        message.messageType,
        success(localContent),
      );
      return;
    }

    let response;
    try {
      response = await sendChromeMessage({
        type: "qivryn-protocol",
        messageType: message.messageType,
        data: message.data,
        messageId: message.messageId,
      });
    } catch (error) {
      response = errorResponse(error);
    }
    dispatchToQivryn(
      message.messageId,
      message.messageType,
      normalizeProtocolResponse(message.messageType, message.data, response),
    );
  }

  window.vscode = {
    getState() {
      return vscodeState;
    },
    setState(state) {
      vscodeState = state && typeof state === "object" ? { ...state } : {};
      writeVscodeState(vscodeState);
      return vscodeState;
    },
    postMessage(message) {
      void handleQivrynMessage(message).catch((error) => {
        if (message?.messageType === "llm/streamChat") {
          dispatchToQivryn(message.messageId, message.messageType, {
            error: error instanceof Error ? error.message : String(error),
          });
          return;
        }
        dispatchToQivryn(
          message?.messageId || crypto.randomUUID(),
          message?.messageType || "unknown",
          errorResponse(error),
        );
      });
      return window.vscode;
    },
  };
})();
