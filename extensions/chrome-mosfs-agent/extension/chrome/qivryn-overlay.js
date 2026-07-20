(() => {
  const ROOT_ID = "qivryn-extension-overlay-root";
  const FRAME_URL = chrome.runtime.getURL("qivryn/index.html?surface=overlay");

  const existing = document.getElementById(ROOT_ID);
  if (existing) {
    existing.remove();
    return { ok: true, visible: false };
  }

  const root = document.createElement("section");
  root.id = ROOT_ID;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Qivryn");

  const header = document.createElement("header");
  header.className = "qivryn-extension-overlay-header";

  const title = document.createElement("div");
  title.className = "qivryn-extension-overlay-title";
  title.textContent = "Qivryn";

  const actions = document.createElement("div");
  actions.className = "qivryn-extension-overlay-actions";

  const fullScreenButton = document.createElement("button");
  fullScreenButton.type = "button";
  fullScreenButton.className = "qivryn-extension-overlay-button";
  fullScreenButton.textContent = "Open full screen";
  fullScreenButton.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "open-qivryn-ui" });
  });

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "qivryn-extension-overlay-button";
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", () => root.remove());

  const frame = document.createElement("iframe");
  frame.className = "qivryn-extension-overlay-frame";
  frame.title = "Qivryn";
  frame.src = FRAME_URL;
  frame.allow = "clipboard-read; clipboard-write";

  actions.append(fullScreenButton, closeButton);
  header.append(title, actions);
  root.append(header, frame);
  document.documentElement.append(root);

  return { ok: true, visible: true };
})();
