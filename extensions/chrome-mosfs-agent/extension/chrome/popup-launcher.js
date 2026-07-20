const QIVRYN_UI_PATH = "qivryn/index.html";
const POPUP_STATE_KEY = "qivryn.popupState.v1";
let activeContextTabId;
let activeTabContextSnapshot;

function setStatus(message) {
  const status = document.querySelector("#statusText");
  if (status) status.textContent = message;
}

function popupStatusFromContext(tabContext) {
  const sr =
    tabContext?.srNumber ||
    (Array.isArray(tabContext?.srMatches) ? tabContext.srMatches[0] : "") ||
    "";
  const status = tabContext?.statusCd ? ` · ${tabContext.statusCd}` : "";
  if (sr) return `Compact Qivryn popup restored current tab context: ${sr}${status}`;
  const title = tabContext?.title || tabContext?.url || "";
  return title
    ? `Compact Qivryn popup restored current tab context: ${title}`
    : "Compact Qivryn popup loaded with current tab context.";
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
  activeContextTabId = Number(saved.contextTabId) || saved.tabContext?.tabId || undefined;
  activeTabContextSnapshot = saved.tabContext || null;
  const frame = document.querySelector("#qivrynPopupFrame");
  if (frame && activeTabContextSnapshot) {
    frame.src = qivrynPopupUrl(activeTabContextSnapshot);
  } else if (frame && typeof saved.frameUrl === "string" && saved.frameUrl) {
    frame.src = saved.frameUrl;
  }
  setStatus(saved.statusText || popupStatusFromContext(activeTabContextSnapshot));
  return true;
}

async function openQivrynUi() {
  setStatus("Opening Qivryn in a full tab…");
  const response = await chrome.runtime.sendMessage({
    type: "open-qivryn-ui",
    contextTabId: activeContextTabId,
  });
  if (!response?.ok) {
    throw new Error(response?.error || "Qivryn did not return an open confirmation.");
  }
  setStatus(response.reused ? "Switched to the existing Qivryn tab." : "Opened Qivryn in a full tab.");
  window.setTimeout(() => window.close(), 200);
}

function qivrynPopupUrl(tabContext) {
  const url = new URL(chrome.runtime.getURL(QIVRYN_UI_PATH));
  url.searchParams.set("surface", "popup");
  if (tabContext?.tabId) {
    activeContextTabId = tabContext.tabId;
    url.searchParams.set("contextTabId", String(tabContext.tabId));
  }
  return url.href;
}

async function loadEmbeddedQivryn() {
  const frame = document.querySelector("#qivrynPopupFrame");
  const restored = await restorePopupState();
  if (!restored) {
    setStatus("Reading active tab context…");
  }
  try {
    const response = await chrome.runtime.sendMessage({ type: "active-tab" });
    const tabContext = response?.tabContext || activeTabContextSnapshot;
    activeTabContextSnapshot = tabContext || null;
    if (frame) frame.src = qivrynPopupUrl(tabContext);
    setStatus(popupStatusFromContext(tabContext));
    await persistPopupState(tabContext);
  } catch (error) {
    if (frame) frame.src = qivrynPopupUrl(activeTabContextSnapshot);
    setStatus(`${error.message || String(error)} Compact Qivryn loaded with saved context.`);
    await persistPopupState(activeTabContextSnapshot);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const link = document.querySelector("#openQivrynLink");
  void loadEmbeddedQivryn();
  if (!link) return;

  link.href = "#";
  link.addEventListener("click", (event) => {
    event.preventDefault();
    void openQivrynUi().catch((error) => {
      setStatus(`${error.message || String(error)} Try again or reload the extension.`);
    });
  });
});

window.addEventListener("pagehide", () => {
  void persistPopupState();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    void persistPopupState();
  }
});
