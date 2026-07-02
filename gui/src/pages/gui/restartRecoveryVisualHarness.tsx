import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../../context/Auth";
import { IdeMessengerProvider } from "../../context/IdeMessenger";
import { MockIdeMessenger } from "../../context/MockIdeMessenger";
import "../../index.css";
import { EMPTY_CONFIG, updateConfig } from "../../redux/slices/configSlice";
import { newSession } from "../../redux/slices/sessionSlice";
import { setupStore } from "../../redux/store";
import { MainEditorProvider } from "../../components/mainInput/TipTapEditor";
import StepContainer from "../../components/StepContainer/StepContainer";

const messenger = new MockIdeMessenger();
const store = setupStore({ ideMessenger: messenger });
store.dispatch(updateConfig(EMPTY_CONFIG));
store.dispatch(
  newSession({
    sessionId: "restart-recovery-session",
    title: "Recovered session",
    history: [
      {
        message: {
          id: "interrupted-assistant",
          role: "assistant",
          content: "I was updating the selected file when the IDE restarted.",
          toolCalls: [
            {
              id: "edit-1",
              type: "function",
              function: {
                name: "edit_file",
                arguments: '{"path":"src/example.ts"}',
              },
            },
          ],
        },
        contextItems: [],
        isGatheringContext: true,
        toolCallStates: [
          {
            toolCallId: "edit-1",
            toolCall: {
              id: "edit-1",
              type: "function",
              function: {
                name: "edit_file",
                arguments: '{"path":"src/example.ts"}',
              },
            },
            parsedArgs: { path: "src/example.ts" },
            status: "calling",
          },
        ],
      },
    ],
    mode: "agent",
  } as any),
);

const recoveredItem = store.getState().session.history[0];

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MemoryRouter>
      <IdeMessengerProvider messenger={messenger}>
        <Provider store={store}>
          <AuthProvider>
            <MainEditorProvider>
              <div className="bg-vsc-editor-background text-foreground min-h-full p-6">
                <main className="mx-auto max-w-3xl">
                  <h1 className="mb-1 text-base font-medium">
                    Session recovered after IDE restart
                  </h1>
                  <p className="text-description mb-6 text-xs">
                    Interrupted work is canceled; the conversation remains
                    available.
                  </p>
                  <section className="border-border rounded-lg border border-solid p-3">
                    <StepContainer item={recoveredItem} index={0} isLast />
                  </section>
                  <textarea
                    aria-label="Ask a follow-up"
                    className="border-border bg-vsc-input-background text-foreground mt-5 box-border w-full rounded-lg border border-solid p-3"
                    placeholder="Ask a follow-up"
                    rows={3}
                  />
                  <div className="text-description mt-2 text-xs">
                    Recovery status: {recoveredItem.toolCallStates?.[0].status}
                  </div>
                </main>
              </div>
            </MainEditorProvider>
          </AuthProvider>
        </Provider>
      </IdeMessengerProvider>
    </MemoryRouter>
  </React.StrictMode>,
);
