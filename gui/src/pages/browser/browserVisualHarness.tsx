import type { BrowserSession } from "@qivryn/agent-runtime";
import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { MainEditorProvider } from "../../components/mainInput/TipTapEditor";
import { AuthProvider } from "../../context/Auth";
import { IdeMessengerProvider } from "../../context/IdeMessenger";
import { MockIdeMessenger } from "../../context/MockIdeMessenger";
import { setupStore } from "../../redux/store";
import "../../index.css";
import BrowserWorkspace from ".";

const messenger = new MockIdeMessenger();
const browserSession: BrowserSession = {
  id: "browser-visual",
  createdAt: "2026-07-12T01:00:00.000Z",
  updatedAt: "2026-07-12T01:04:00.000Z",
  url: "http://localhost:4173/dashboard",
  title: "Qivryn dashboard",
  visible: true,
  locked: true,
  lockOwner: "agent",
  recording: "events",
  viewport: { width: 1280, height: 720 },
};

const previewSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
    <rect width="1280" height="720" fill="#111315"/>
    <rect x="32" y="28" width="1216" height="56" rx="12" fill="#202326"/>
    <rect x="32" y="108" width="260" height="580" rx="14" fill="#1b1e20"/>
    <rect x="316" y="108" width="932" height="236" rx="14" fill="#1b1e20"/>
    <rect x="316" y="368" width="450" height="320" rx="14" fill="#1b1e20"/>
    <rect x="790" y="368" width="458" height="320" rx="14" fill="#1b1e20"/>
    <circle cx="68" cy="56" r="11" fill="#4ea3ff"/>
    <text x="92" y="64" fill="#f2f2f2" font-family="Arial" font-size="24">Qivryn runtime dashboard</text>
    <text x="348" y="160" fill="#aeb4ba" font-family="Arial" font-size="18">Browser session health</text>
    <text x="348" y="226" fill="#f2f2f2" font-family="Arial" font-size="52">98.7%</text>
    <text x="348" y="414" fill="#aeb4ba" font-family="Arial" font-size="18">Recent agent runs</text>
    <text x="822" y="414" fill="#aeb4ba" font-family="Arial" font-size="18">Audit events</text>
  </svg>
`;

async function renderPreviewPng(): Promise<string> {
  const image = new Image();
  image.src = `data:image/svg+xml;base64,${window.btoa(previewSvg)}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  canvas.getContext("2d")?.drawImage(image, 0, 0);
  return canvas.toDataURL("image/png").split(",")[1] ?? "";
}

const screenshotEvent = {
  id: "browser-event-3",
  sessionId: browserSession.id,
  sequence: 3,
  createdAt: "2026-07-12T01:04:00.000Z",
  kind: "screenshot" as const,
  payload: {},
};

messenger.responses["browser/list"] = [browserSession];
messenger.responses["browser/events"] = [
  screenshotEvent,
  {
    id: "browser-event-2",
    sessionId: browserSession.id,
    sequence: 2,
    createdAt: "2026-07-12T01:03:00.000Z",
    kind: "navigation",
    payload: { url: browserSession.url },
  },
];
messenger.responses["browser/grants"] = [
  {
    id: "grant-interaction",
    sessionId: browserSession.id,
    actor: "agent",
    action: "interaction",
    origin: "http://localhost:4173",
    createdAt: "2026-07-12T01:02:00.000Z",
  },
];
messenger.responseHandlers["browser/action"] = async (request) => {
  if (request.action === "screenshot") {
    return {
      event: screenshotEvent,
      data: await renderPreviewPng(),
      mediaType: "image/png",
    };
  }
  if (request.action === "dom") {
    return {
      event: screenshotEvent,
      content: "<main><h1>Qivryn runtime dashboard</h1></main>",
    };
  }
  return browserSession;
};

const store = setupStore({ ideMessenger: messenger });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MemoryRouter initialEntries={["/browser?runId=visual-run"]}>
      <IdeMessengerProvider messenger={messenger}>
        <Provider store={store}>
          <AuthProvider>
            <MainEditorProvider>
              <BrowserWorkspace />
            </MainEditorProvider>
          </AuthProvider>
        </Provider>
      </IdeMessengerProvider>
    </MemoryRouter>
  </React.StrictMode>,
);
