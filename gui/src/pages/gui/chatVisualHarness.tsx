import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { MainEditorProvider } from "../../components/mainInput/TipTapEditor";
import { AuthProvider } from "../../context/Auth";
import { IdeMessengerProvider } from "../../context/IdeMessenger";
import { MockIdeMessenger } from "../../context/MockIdeMessenger";
import { EMPTY_CONFIG, updateConfig } from "../../redux/slices/configSlice";
import { newSession } from "../../redux/slices/sessionSlice";
import { setupStore } from "../../redux/store";
import "../../index.css";
import GUI from ".";

const messenger = new MockIdeMessenger();
messenger.responses["extensions/skills"] = {
  skills: [
    {
      name: "ui-ux-pro-max",
      description: "Production UI and UX guidance",
      path: "/Users/user/.codex/skills/ui-ux-pro-max/SKILL.md",
      sourceFile: "file:///Users/user/.codex/skills/ui-ux-pro-max/SKILL.md",
      source: "codex",
      basePath: "/Users/user/.codex/skills/ui-ux-pro-max",
    },
    {
      name: "frontend-design",
      description: "Build polished frontend interfaces",
      path: "/Users/user/.codex/skills/frontend-design/SKILL.md",
      sourceFile: "file:///Users/user/.codex/skills/frontend-design/SKILL.md",
      source: "codex",
      basePath: "/Users/user/.codex/skills/frontend-design",
    },
  ],
  errors: [],
} as any;
const store = setupStore({ ideMessenger: messenger });
const empty = new URLSearchParams(window.location.search).has("empty");

store.dispatch(
  updateConfig({
    ...EMPTY_CONFIG,
    ui: {
      showSessionTabs: false,
      showChatScrollbar: true,
    },
    modelsByRole: {
      ...EMPTY_CONFIG.modelsByRole,
      chat: [
        {
          model: "gpt-5.6-sol",
          provider: "openai",
          title: "GPT-5.6 Sol",
          underlyingProviderName: "openai",
          contextLength: 258_000,
          requestOptions: {
            extraBodyProperties: {
              _reasoningLevels: ["low", "medium", "high", "xhigh", "max"],
              reasoning_effort: "xhigh",
            },
          },
        },
      ],
    },
    selectedModelByRole: {
      ...EMPTY_CONFIG.selectedModelByRole,
      chat: {
        model: "gpt-5.6-sol",
        provider: "openai",
        title: "GPT-5.6 Sol",
        underlyingProviderName: "openai",
        contextLength: 258_000,
        requestOptions: {
          extraBodyProperties: {
            _reasoningLevels: ["low", "medium", "high", "xhigh", "max"],
            reasoning_effort: "xhigh",
          },
        },
      },
    },
  }),
);

if (!empty) {
  store.dispatch(
    newSession({
      sessionId: "codex-parity-visual",
      title: "Review Qivryn desktop parity",
      workspaceDirectory: "/Users/user/qivryn",
      mode: "agent",
      history: [
        {
          contextItems: [],
          message: {
            id: "user-1",
            role: "user",
            content:
              "Review the Qivryn chat experience against the standalone Codex desktop app.",
          },
        },
        {
          contextItems: [],
          message: {
            id: "assistant-1",
            role: "assistant",
            content:
              "I’ll compare the conversation rhythm, tool disclosures, responsive layout, and composer behavior against the desktop reference.",
          },
        },
        {
          contextItems: [],
          message: {
            id: "assistant-tools",
            role: "assistant",
            content: "",
            toolCalls: [
              {
                id: "read-reference",
                type: "function",
                function: {
                  name: "read_file",
                  arguments:
                    '{"path":"codex-src/webview/assets/app-C_Uac7Z9.css"}',
                },
              },
            ],
          },
          toolCallStates: [
            {
              toolCallId: "read-reference",
              toolCall: {
                id: "read-reference",
                type: "function",
                function: {
                  name: "read_file",
                  arguments:
                    '{"path":"codex-src/webview/assets/app-C_Uac7Z9.css"}',
                },
              },
              parsedArgs: {
                path: "codex-src/webview/assets/app-C_Uac7Z9.css",
              },
              status: "done",
              output: [
                {
                  name: "codex-src/webview/assets/app-C_Uac7Z9.css",
                  description:
                    "Read the desktop typography, spacing, and surface tokens.",
                  content: "",
                },
              ],
            },
          ],
        },
        {
          contextItems: [],
          message: {
            id: "assistant-final",
            role: "assistant",
            content:
              "The desktop app uses a 48rem reading measure, unframed assistant prose, quiet activity rows, and one compact composer surface. Qivryn now follows those same layout contracts while retaining VS Code theme tokens and extension-specific actions.",
          },
        },
      ] as any,
    }),
  );
}

(window as Window & { isFullScreen?: boolean }).isFullScreen =
  window.innerWidth >= 720;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MemoryRouter>
      <IdeMessengerProvider messenger={messenger}>
        <Provider store={store}>
          <AuthProvider>
            <MainEditorProvider>
              <GUI />
            </MainEditorProvider>
          </AuthProvider>
        </Provider>
      </IdeMessengerProvider>
    </MemoryRouter>
  </React.StrictMode>,
);
