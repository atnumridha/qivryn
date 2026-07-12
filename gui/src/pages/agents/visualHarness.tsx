import type { AgentEvent, AgentRun } from "@qivryn/agent-runtime";
import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { MainEditorProvider } from "../../components/mainInput/TipTapEditor";
import { AuthProvider } from "../../context/Auth";
import { IdeMessengerProvider } from "../../context/IdeMessenger";
import { MockIdeMessenger } from "../../context/MockIdeMessenger";
import { setupStore } from "../../redux/store";
import { EMPTY_CONFIG, updateConfig } from "../../redux/slices/configSlice";
import "../../index.css";
import Agents from ".";

const messenger = new MockIdeMessenger();
const visualParams = new URLSearchParams(window.location.search);
const showEmptyState = visualParams.get("empty") === "1";
const selectedRun: AgentRun = {
  id: "visual-run",
  revision: 1,
  title: "Make sure our application has all core business logic implemented",
  prompt: `${"Make sure our application matches the reference agent workspace exactly. ".repeat(8)}\n\nCore business logic\nReview the runtime, context handling, and UI behavior.`,
  status: "completed",
  createdAt: "2026-06-30T20:00:00.000Z",
  updatedAt: "2026-06-30T21:00:00.000Z",
  permissionMode: "autonomous",
  model: "Codex: GPT-5.6-Sol",
  workspace: {
    id: "workspace-1",
    location: "local",
    repositoryPath: "/Users/user/qivryn",
    worktreePath: "/Users/user/.qivryn/agents/worktrees/visual-run",
    branch: "qivryn/agent-visual-run",
  },
};

const earlierEvents: AgentEvent[] = Array.from({ length: 42 }, (_, index) => ({
  id: `old-${index}`,
  runId: selectedRun.id,
  sequence: index + 1,
  kind: "runtime.notice",
  createdAt: `2026-06-30T20:${String(index).padStart(2, "0")}:00.000Z`,
  payload: { text: `Earlier recovery activity ${index + 1}` },
}));
const recentEvents: AgentEvent[] = [
  {
    id: "compacted",
    runId: selectedRun.id,
    sequence: 43,
    kind: "runtime.notice",
    createdAt: "2026-06-30T21:00:00.000Z",
    payload: { text: "Chat history auto-compacted successfully." },
  },
  ...Array.from({ length: 7 }, (_, index): AgentEvent[] => [
    {
      id: `tool-${index}`,
      runId: selectedRun.id,
      sequence: 44 + index * 2,
      kind: "tool.started",
      createdAt: `2026-06-30T21:0${index}:00.000Z`,
      payload: {
        toolName: index % 2 ? "search" : "read",
        args: { filepath: `src/feature-${index}.ts` },
        text: `Inspecting feature ${index}`,
      },
    },
    {
      id: `tool-${index}-complete`,
      runId: selectedRun.id,
      sequence: 45 + index * 2,
      kind: "tool.completed",
      createdAt: `2026-06-30T21:0${index}:01.000Z`,
      payload: {
        toolName: index % 2 ? "search" : "read",
        text: `Feature ${index} checked`,
      },
    },
  ]).flat(),
  {
    id: "answer",
    runId: selectedRun.id,
    sequence: 58,
    kind: "message.assistant",
    createdAt: "2026-06-30T21:08:00.000Z",
    payload: {
      text: "## Completed\n\nThe implementation and focused verification are complete.",
    },
  },
];

messenger.responses["agents/list"] = showEmptyState
  ? []
  : [
      selectedRun,
      {
        ...selectedRun,
        id: "recent-run",
        title: "Review the codebase",
        prompt: "Review the codebase",
      },
    ];
messenger.responses["agents/events"] = [...earlierEvents, ...recentEvents];
messenger.responses["agents/checkpoints"] = Array.from(
  { length: 6 },
  (_, index) => ({
    id: `checkpoint-${index}`,
    runId: selectedRun.id,
    createdAt: `2026-06-30T20:${String(index).padStart(2, "0")}:00.000Z`,
    label: "Before agent changes",
  }),
);
messenger.responses.getFileResults = Array.from(
  { length: 20 },
  (_, index) => `/Users/user/qivryn/src/feature-${index}.ts`,
);
messenger.responseHandlers["agents/control"] = async (request) => {
  (window as Window & { __lastAgentControl?: unknown }).__lastAgentControl =
    request;
  return undefined;
};

const store = setupStore({ ideMessenger: messenger });
store.dispatch(
  updateConfig({
    ...EMPTY_CONFIG,
    contextProviders: [
      {
        title: "web",
        displayTitle: "Web",
        description: "Web context",
        type: "query",
      },
    ],
    mcpServerStatuses: [],
  }),
);
(window as Window & { isFullScreen?: boolean }).isFullScreen = true;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MemoryRouter
      initialEntries={[showEmptyState ? "/agents" : "/agents?runId=visual-run"]}
    >
      <IdeMessengerProvider messenger={messenger}>
        <Provider store={store}>
          <AuthProvider>
            <MainEditorProvider>
              <Agents />
            </MainEditorProvider>
          </AuthProvider>
        </Provider>
      </IdeMessengerProvider>
    </MemoryRouter>
  </React.StrictMode>,
);
