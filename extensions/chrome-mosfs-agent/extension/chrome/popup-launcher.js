const QIVRYN_UI_PATH = "qivryn/index.html";
const POPUP_STATE_KEY = "qivryn.popupState.v1";
let activeContextTabId;
let activeTabContextSnapshot;
let lastFrameNonce = 0;

function setStatus(message) {
  const status = document.querySelector("#statusText");
  if (status) status.textContent = message;
}

function setContextBadge(tabContext) {
  const badge = document.querySelector("#contextBadge");
  if (!badge) return;
  const sr =
    tabContext?.srNumber ||
    (Array.isArray(tabContext?.srMatches) ? tabContext.srMatches[0] : "") ||
    "";
  if (sr) {
    const source = tabContext?.contextSource
      ? ` · ${tabContext.contextSource}`
      : "";
    badge.textContent = `${sr}${source}`;
    return;
  }
  const title = tabContext?.title || tabContext?.url || "";
  badge.textContent = title ? limitLabel(title, 84) : "Current tab context";
}

function popupStatusFromContext(tabContext) {
  const sr =
    tabContext?.srNumber ||
    (Array.isArray(tabContext?.srMatches) ? tabContext.srMatches[0] : "") ||
    "";
  const status = tabContext?.statusCd ? ` · ${tabContext.statusCd}` : "";
  const source = tabContext?.contextSource
    ? ` · ${tabContext.contextSource}`
    : "";
  if (sr) return `Current tab context: ${sr}${status}${source}`;
  const title = tabContext?.title || tabContext?.url || "";
  return title
    ? `Current tab context: ${limitLabel(title, 140)}${source}`
    : "Current tab context is ready.";
}

function chromeStorageGet(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (stored) => resolve(stored || {}));
  });
}

function chromeStorageSet(values) {
  return new Promise((resolve) => {
    chrome.storage.local.set(values, () => resolve());
  });
}

async function persistPopupState(tabContext = activeTabContextSnapshot) {
  const frame = document.querySelector("#qivrynPopupFrame");
  const status = document.querySelector("#statusText");
  await chromeStorageSet({
    [POPUP_STATE_KEY]: {
      contextTabId: activeContextTabId,
      tabContext: tabContext || null,
      frameUrl: frame?.src || "",
      statusText: status?.textContent || "",
      savedAt: new Date().toISOString(),
    },
  });
}

async function restorePopupState() {
  const stored = await chromeStorageGet(POPUP_STATE_KEY);
  const saved = stored?.[POPUP_STATE_KEY];
  if (!saved || typeof saved !== "object") return false;
  activeContextTabId =
    Number(saved.contextTabId) || saved.tabContext?.tabId || undefined;
  activeTabContextSnapshot = saved.tabContext || null;
  const frame = document.querySelector("#qivrynPopupFrame");
  if (frame && activeTabContextSnapshot) {
    frame.src = qivrynPopupUrl(activeTabContextSnapshot);
  } else if (frame && typeof saved.frameUrl === "string" && saved.frameUrl) {
    frame.src = saved.frameUrl;
  }
  setContextBadge(activeTabContextSnapshot);
  setStatus(
    saved.statusText || popupStatusFromContext(activeTabContextSnapshot),
  );
  return true;
}

async function openQivrynUi() {
  setStatus("Opening Qivryn in a full tab…");
  const response = await chrome.runtime.sendMessage({
    type: "open-qivryn-ui",
    contextTabId: activeContextTabId,
  });
  if (!response?.ok) {
    throw new Error(
      response?.error || "Qivryn did not return an open confirmation.",
    );
  }
  setStatus(
    response.reused
      ? "Switched to the existing Qivryn tab."
      : "Opened Qivryn in a full tab.",
  );
  window.setTimeout(() => window.close(), 200);
}

async function toggleOverlay() {
  setStatus("Opening Qivryn overlay on the current tab…");
  const response = await chrome.runtime.sendMessage({
    type: "toggle-qivryn-overlay",
    contextTabId: activeContextTabId,
  });
  if (!response?.ok) {
    throw new Error(
      response?.error || "Qivryn overlay did not return a confirmation.",
    );
  }
  setStatus(
    response.visible === false
      ? "Closed Qivryn overlay."
      : "Opened Qivryn overlay on the current tab.",
  );
}

function qivrynPopupUrl(tabContext, options = {}) {
  const url = new URL(chrome.runtime.getURL(QIVRYN_UI_PATH));
  url.searchParams.set("surface", "popup");
  if (tabContext?.tabId) {
    activeContextTabId = tabContext.tabId;
    url.searchParams.set("contextTabId", String(tabContext.tabId));
  }
  if (options.reload) {
    url.searchParams.set("reload", String(options.reload));
  }
  return url.href;
}

async function loadEmbeddedQivryn(options = {}) {
  const frame = document.querySelector("#qivrynPopupFrame");
  const restored = options.skipRestore ? false : await restorePopupState();
  if (!restored || options.force) {
    setStatus("Reading active tab context…");
  }
  try {
    const response = await chrome.runtime.sendMessage({ type: "active-tab" });
    const tabContext = response?.tabContext || activeTabContextSnapshot;
    activeTabContextSnapshot = tabContext || null;
    setContextBadge(tabContext);
    if (frame)
      frame.src = qivrynPopupUrl(
        tabContext,
        options.reload ? { reload: ++lastFrameNonce } : {},
      );
    setStatus(popupStatusFromContext(tabContext));
    await persistPopupState(tabContext);
  } catch (error) {
    setContextBadge(activeTabContextSnapshot);
    if (frame)
      frame.src = qivrynPopupUrl(
        activeTabContextSnapshot,
        options.reload ? { reload: ++lastFrameNonce } : {},
      );
    setStatus(
      `${error.message || String(error)} Compact Qivryn loaded with saved context.`,
    );
    await persistPopupState(activeTabContextSnapshot);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const link = document.querySelector("#openQivrynLink");
  const refreshContextButton = document.querySelector("#refreshContextButton");
  const toggleOverlayButton = document.querySelector("#toggleOverlayButton");
  const reloadFrameButton = document.querySelector("#reloadFrameButton");
  void loadEmbeddedQivryn();

  if (refreshContextButton) {
    refreshContextButton.addEventListener("click", () => {
      void loadEmbeddedQivryn({ force: true, skipRestore: true }).catch(
        (error) => {
          setStatus(
            `${error.message || String(error)} Try again or reload the extension.`,
          );
        },
      );
    });
  }

  if (toggleOverlayButton) {
    toggleOverlayButton.addEventListener("click", () => {
      void toggleOverlay().catch((error) => {
        setStatus(
          `${error.message || String(error)} Try the full tab instead.`,
        );
      });
    });
  }

  if (reloadFrameButton) {
    reloadFrameButton.addEventListener("click", () => {
      void loadEmbeddedQivryn({
        force: true,
        skipRestore: true,
        reload: true,
      }).catch((error) => {
        setStatus(`${error.message || String(error)} Try reopening the popup.`);
      });
    });
  }

  if (link) {
    link.href = "#";
    link.addEventListener("click", (event) => {
      event.preventDefault();
      void openQivrynUi().catch((error) => {
        setStatus(
          `${error.message || String(error)} Try again or reload the extension.`,
        );
      });
    });
  }
});

window.addEventListener("pagehide", () => {
  void persistPopupState();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    void persistPopupState();
  }
});

function limitLabel(value, maxChars) {
  const text = String(value || "");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}
