import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../../context/Auth";
import { IdeMessengerProvider } from "../../context/IdeMessenger";
import { MockIdeMessenger } from "../../context/MockIdeMessenger";
import "../../index.css";
import { EMPTY_CONFIG, updateConfig } from "../../redux/slices/configSlice";
import {
  newSession,
  setCompactionLoading,
  setContextUsage,
} from "../../redux/slices/sessionSlice";
import { setupStore } from "../../redux/store";
import ConversationSummary from "../StepContainer/ConversationSummary";
import { MainEditorProvider } from "./TipTapEditor";
import InputToolbar from "./InputToolbar";

const messenger = new MockIdeMessenger();
const store = setupStore({ ideMessenger: messenger });
const visualParams = new URLSearchParams(window.location.search);
const historyItem = {
  message: {
    id: "visual-message",
    role: "user" as const,
    content: "Review the implementation and run all focused checks.",
  },
  contextItems: [],
};
const visualModel = {
  model: "gpt-5.6-sol",
  provider: "openai",
  title: "Codex: GPT-5.6-Sol",
  underlyingProviderName: "openai",
  contextLength: 200_000,
  requestOptions: {
    extraBodyProperties: {
      _reasoningLevels: ["low", "medium", "high", "xhigh", "ultra"],
      reasoning_effort: "medium",
    },
  },
};

store.dispatch(
  updateConfig({
    ...EMPTY_CONFIG,
    modelsByRole: { ...EMPTY_CONFIG.modelsByRole, chat: [visualModel] },
    selectedModelByRole: {
      ...EMPTY_CONFIG.selectedModelByRole,
      chat: visualModel,
    },
  } as any),
);
store.dispatch(
  newSession({
    sessionId: "context-visual-session",
    title: "Context visual session",
    history: [historyItem],
    mode: "agent",
  } as any),
);
store.dispatch(
  setContextUsage({
    inputTokens: 161_906,
    contextLength: 200_000,
    availableTokens: 180_000,
    model: visualModel.model,
  }),
);
if (visualParams.get("compacting") !== "false") {
  store.dispatch(setCompactionLoading({ index: 0, loading: true }));
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MemoryRouter>
      <IdeMessengerProvider messenger={messenger}>
        <Provider store={store}>
          <AuthProvider>
            <MainEditorProvider>
              <div className="bg-vsc-editor-background flex h-full items-center justify-center p-4">
                <main className="w-full max-w-4xl">
                  <div className="text-description mb-3 text-xs">
                    Completed response content
                  </div>
                  <ConversationSummary item={historyItem as any} index={0} />
                  <section className="qivryn-main-editor-input border-border bg-vsc-input-background rounded-lg border border-solid p-2 shadow-lg">
                    <textarea
                      aria-label="Ask a follow-up"
                      placeholder="Ask a follow-up"
                      rows={3}
                      className="bg-vsc-input-background text-foreground box-border w-full resize-none border-none px-1 py-1 text-sm outline-none"
                    />
                    <InputToolbar
                      activeKey={null}
                      isMainInput
                      agentAccessMode="autonomous"
                    />
                  </section>
                </main>
              </div>
            </MainEditorProvider>
          </AuthProvider>
        </Provider>
      </IdeMessengerProvider>
    </MemoryRouter>
  </React.StrictMode>,
);

if (visualParams.get("modelOpen") === "true") {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="model-select-button"]')
        ?.click();
    });
  });
}

if (visualParams.get("attachOpen") === "true") {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(
          '[aria-label="Attach file, image, or context"]',
        )
        ?.click();
    });
  });
}
