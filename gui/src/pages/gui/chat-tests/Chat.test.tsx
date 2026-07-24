import { act, screen, waitFor } from "@testing-library/react";
import type { AgentControlRequest, AgentRun } from "@qivryn/agent-runtime";
import { useLocation } from "react-router-dom";
import { MockIdeMessenger } from "../../../context/MockIdeMessenger";
import {
  newSession,
  setActive,
  setMode,
  setToolCallCalling,
} from "../../../redux/slices/sessionSlice";
import { addAndSelectMockLlm } from "../../../util/test/config";
import { renderWithProviders } from "../../../util/test/render";
import {
  getElementByTestId,
  getElementByText,
  getMainEditor,
  sendInputWithMockedResponse,
} from "../../../util/test/utils";
import { Chat, measureScrollbarInset } from "../Chat";

const LAST_AGENT_REPOSITORY_KEY = "qivryn.agents.lastRepository";

function LocationProbe() {
  const location = useLocation();
  return (
    <output aria-label="current route">
      {location.pathname}
      {location.search}
    </output>
  );
}

beforeEach(() => {
  window.localStorage.removeItem(LAST_AGENT_REPOSITORY_KEY);
});

afterEach(() => {
  window.localStorage.removeItem(LAST_AGENT_REPOSITORY_KEY);
  delete (window as any).workspacePaths;
});

test("measures the scroll gutter used to align the composer rail", () => {
  expect(
    measureScrollbarInset({
      clientWidth: 409,
      offsetWidth: 420,
    }),
  ).toBe(11);
  expect(
    measureScrollbarInset({
      clientWidth: 420,
      offsetWidth: 420,
    }),
  ).toBe(0);
});

test("should render input box", async () => {
  await renderWithProviders(<Chat />);
  await getElementByTestId("qivryn-input-box-main-editor-input");
});

test("main composer exposes workspace selection and scheduled tasks", async () => {
  (window as any).workspacePaths = [
    "file:///Users/amridha/Documents/current-workspace",
  ];
  const { ideMessenger, user } = await renderWithProviders(
    <>
      <Chat />
      <LocationProbe />
    </>,
  );
  ideMessenger.responses["agents/selectRepository"] =
    "/Users/amridha/Documents/qivryn";
  const selectedRepositoryUpdates: string[] = [];
  ideMessenger.responseHandlers["agents/setSelectedRepository"] = async (
    payload,
  ) => {
    selectedRepositoryUpdates.push(payload?.path ?? "");
    return undefined;
  };

  expect(
    await screen.findByRole("button", {
      name: /Current workspace: current-workspace/,
    }),
  ).toBeInTheDocument();

  await user.click(
    await screen.findByRole("button", {
      name: /Choose workspace for agent tasks/,
    }),
  );

  expect(
    await screen.findByRole("button", { name: /Current workspace: qivryn/ }),
  ).toBeInTheDocument();
  await waitFor(() => {
    expect(selectedRepositoryUpdates).toContain(
      "/Users/amridha/Documents/qivryn",
    );
  });

  await user.click(
    screen.getByRole("button", { name: "Clear selected workspace" }),
  );

  expect(
    screen.getByRole("button", {
      name: /Current workspace: current-workspace/,
    }),
  ).toBeInTheDocument();
  expect(window.localStorage.getItem(LAST_AGENT_REPOSITORY_KEY)).toBe("");
  await waitFor(() => {
    expect(selectedRepositoryUpdates).toContain(
      "/Users/amridha/Documents/current-workspace",
    );
  });

  await user.click(
    screen.getByRole("button", { name: "Show agents and chats" }),
  );
  expect(screen.getByLabelText("current route")).toHaveTextContent(
    "/agents?panel=1",
  );

  await user.click(
    screen.getByRole("button", { name: "Open scheduled tasks" }),
  );

  expect(screen.getByLabelText("current route")).toHaveTextContent(
    "/agents?scheduled=1",
  );
});

test("main composer shows workspace detected from VS Code when none is injected", async () => {
  const ideMessenger = new MockIdeMessenger();
  ideMessenger.responses.getWorkspaceDirs = ["file:///workspace/detected-app"];
  await renderWithProviders(<Chat />, { mockIdeMessenger: ideMessenger });

  expect(
    await screen.findByRole("button", {
      name: /Current workspace: detected-app/,
    }),
  ).toBeInTheDocument();
  expect(window.localStorage.getItem(LAST_AGENT_REPOSITORY_KEY)).toBeNull();
});

test("shows only stop while keeping the main composer editable during streaming", async () => {
  const { store, user } = await renderWithProviders(<Chat />);

  await act(async () => {
    store.dispatch(setActive());
  });

  const stopButton = await screen.findByRole("button", { name: "Stop" });
  expect(stopButton).toHaveAttribute("data-streaming", "true");
  expect(screen.queryByTestId("submit-input-button")).toBeNull();

  await user.click(stopButton);

  await waitFor(() => {
    expect(store.getState().session.isStreaming).toBe(false);
    expect(
      screen.getByRole("button", { name: /Send message/ }),
    ).toHaveAttribute("data-streaming", "false");
  });
});

test("renders historical user prompts read-only until edit is clicked", async () => {
  const { ideMessenger, store, user } = await renderWithProviders(<Chat />);

  await act(async () => {
    addAndSelectMockLlm(store, ideMessenger);
  });

  await sendInputWithMockedResponse(ideMessenger, "Hello World", [
    { role: "assistant", content: "Expected response" },
  ]);

  const userMessage = await screen.findByText("Hello World");
  const historicalPrompt = userMessage.closest(
    "[data-testid^='qivryn-input-box-']",
  );

  await waitFor(() => {
    expect(historicalPrompt).not.toBeNull();
  });
  if (!historicalPrompt) {
    throw new Error("Historical user prompt was not rendered");
  }

  expect(historicalPrompt).toHaveClass("qivryn-transcript-input-box");
  expect(
    historicalPrompt.querySelector(".qivryn-transcript-input-frame"),
  ).not.toBeNull();
  expect(historicalPrompt.querySelector(".qivryn-main-input-frame")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Edit message" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", {
      name: "Restart conversation from this message",
    }),
  ).not.toBeInTheDocument();

  const historicalEditor = historicalPrompt.querySelector(".ProseMirror");
  expect(historicalEditor).toHaveAttribute("contenteditable", "false");

  await user.click(screen.getByRole("button", { name: "Edit message" }));

  await waitFor(() => {
    expect(historicalEditor).toHaveAttribute("contenteditable", "true");
  });

  const mainComposer = await getElementByTestId(
    "qivryn-input-box-main-editor-input",
  );
  expect(mainComposer).toHaveClass("qivryn-main-input-box");
  expect(mainComposer.querySelector(".qivryn-main-input-frame")).not.toBeNull();
});

test("renders user message content when the saved editor state is empty", async () => {
  const { store } = await renderWithProviders(<Chat />);

  await act(async () => {
    store.dispatch(
      newSession({
        sessionId: "empty-editor-state-session",
        title: "Empty editor state",
        workspaceDirectory: "/workspace/app",
        history: [
          {
            contextItems: [],
            editorState: {
              type: "doc",
              content: [{ type: "paragraph" }],
            },
            message: {
              id: "user-empty-editor-state",
              role: "user",
              content: "Visible sent message",
            },
          },
        ] as any,
      }),
    );
  });

  expect(await screen.findByText("Visible sent message")).toBeVisible();
});

test("continues an explicitly incomplete assistant response", async () => {
  const { ideMessenger, store, user } = await renderWithProviders(<Chat />);
  const seededHistory = [
    {
      contextItems: [],
      message: {
        id: "user-incomplete",
        role: "user",
        content: "Review the codebase",
      },
    },
    {
      contextItems: [],
      message: {
        id: "assistant-incomplete",
        role: "assistant",
        content: "I found this is a multi-",
        metadata: {
          completionStatus: "incomplete",
          completionReason: "length",
        },
      },
    },
  ] as any;

  await act(async () => {
    addAndSelectMockLlm(store, ideMessenger);
    store.dispatch(
      newSession({
        sessionId: "incomplete-session",
        title: "Incomplete response",
        workspaceDirectory: "/workspace/app",
        history: seededHistory,
      }),
    );
  });

  expect(
    await screen.findByText("Response stopped at the output limit."),
  ).toBeVisible();

  ideMessenger.chatResponse = [
    { role: "assistant", content: "Continued response." },
  ];

  await user.click(screen.getByRole("button", { name: "Continue response" }));

  await waitFor(() => {
    expect(
      screen.queryByText("Response stopped at the output limit."),
    ).toBeNull();
    expect(
      store.getState().session.history[1].message.metadata?.completionStatus,
    ).toBe("continued");
  });

  await getElementByText("Continued response.");

  await waitFor(() => {
    const history = store.getState().session.history;
    expect(history).toHaveLength(4);
    expect(history[2].message.role).toBe("user");
    expect(history[2].message.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: "Continue your previous response exactly from where it stopped. Do not repeat completed content.",
          type: "text",
        }),
      ]),
    );
  });
});

test("does not guess that a response is incomplete from punctuation", async () => {
  const { store } = await renderWithProviders(<Chat />);

  await act(async () => {
    store.dispatch(
      newSession({
        sessionId: "complete-without-punctuation",
        title: "Complete response",
        workspaceDirectory: "/workspace/app",
        history: [
          {
            contextItems: [],
            message: {
              id: "assistant-complete",
              role: "assistant",
              content: "Validation commands and success criteria",
            },
          },
        ] as any,
      }),
    );
  });

  expect(
    await screen.findByText("Validation commands and success criteria"),
  ).toBeVisible();
  expect(screen.queryByText("Response may be incomplete.")).toBeNull();
  expect(screen.queryByText("Response did not finish.")).toBeNull();
});

test("should be able to toggle modes", async () => {
  const { store } = await renderWithProviders(<Chat />);
  await getElementByText("Agent");

  // Simulate cmd+. keyboard shortcut to toggle modes
  await act(async () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: ".",
        metaKey: true, // cmd key on Mac
      }),
    );
    await Promise.resolve();
  });

  expect(store.getState().session.mode).toBe("chat");
});

test("should send a message and receive a response", async () => {
  const { ideMessenger, store } = await renderWithProviders(<Chat />);

  // First add and select the mock LLM
  await act(async () => {
    addAndSelectMockLlm(store, ideMessenger);
  });

  const CONTENT = "Expected response";
  const INPUT = "User input";

  await sendInputWithMockedResponse(ideMessenger, INPUT, [
    { role: "assistant", content: CONTENT },
  ]);

  await getElementByText(CONTENT);
});

test("starts durable agent work from the main composer transcript", async () => {
  const { ideMessenger, store } = await renderWithProviders(<Chat />);
  const requests: AgentControlRequest[] = [];
  ideMessenger.responses.getWorkspaceDirs = ["file:///workspace/app"];
  ideMessenger.responseHandlers["agents/control"] = async (request) => {
    requests.push(request);
    return {
      id: "composer-run",
      revision: 0,
      title: "Review workspace",
      prompt:
        request.action === "run.create" ? request.request.prompt : "Review",
      status: "running",
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:01.000Z",
      permissionMode: "autonomous",
      workspace: {
        id: "workspace-1",
        location: "local",
        repositoryPath: "/workspace/app",
      },
    } satisfies AgentRun;
  };

  await act(async () => {
    addAndSelectMockLlm(store, ideMessenger);
    store.dispatch(setMode("agent"));
  });

  const editor = await getMainEditor();
  const sendButton = await getElementByTestId("submit-input-button");

  await act(async () => {
    editor.commands.insertContent("Agent task:\nReview the workspace");
  });

  await act(async () => {
    sendButton.click();
  });

  await waitFor(() => {
    expect(requests).toHaveLength(1);
    expect(store.getState().session.isStreaming).toBe(false);
  });
  expect(requests[0]).toMatchObject({
    action: "run.create",
    request: {
      model: "Mock LLM",
      workspace: {
        location: "local",
        repositoryPath: "/workspace/app",
      },
    },
  });
  expect(
    await screen.findByText(/Started a durable agent task from this composer/),
  ).toBeVisible();
  expect(screen.getByText(/Task: Review the workspace/)).toBeVisible();
});

test("starts durable agent work in the selected composer workspace", async () => {
  const { ideMessenger, store, user } = await renderWithProviders(<Chat />);
  const requests: AgentControlRequest[] = [];
  const selectedRepositoryUpdates: string[] = [];
  ideMessenger.responses.getWorkspaceDirs = ["file:///workspace/default"];
  ideMessenger.responses["agents/selectRepository"] = "/workspace/chosen";
  ideMessenger.responseHandlers["agents/setSelectedRepository"] = async (
    payload,
  ) => {
    selectedRepositoryUpdates.push(payload?.path ?? "");
    return undefined;
  };
  ideMessenger.responseHandlers["agents/control"] = async (request) => {
    requests.push(request);
    return {
      id: "composer-run",
      revision: 0,
      title: "Review selected workspace",
      prompt: request.action === "run.create" ? request.request.prompt : "",
      status: "running",
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:01.000Z",
      permissionMode: "autonomous",
      workspace: {
        id: "workspace-1",
        location: "local",
        repositoryPath: "/workspace/chosen",
      },
    } satisfies AgentRun;
  };

  await act(async () => {
    addAndSelectMockLlm(store, ideMessenger);
    store.dispatch(setMode("agent"));
  });

  await user.click(
    await screen.findByRole("button", {
      name: /Choose workspace for agent tasks/,
    }),
  );

  const editor = await getMainEditor();
  const sendButton = await getElementByTestId("submit-input-button");

  await act(async () => {
    editor.commands.insertContent("Agent task:\nReview selected workspace");
  });
  await act(async () => {
    sendButton.click();
  });

  await waitFor(() => {
    expect(requests).toHaveLength(1);
  });
  expect(requests[0]).toMatchObject({
    action: "run.create",
    request: {
      workspace: {
        location: "local",
        repositoryPath: "/workspace/chosen",
      },
    },
  });
  expect(selectedRepositoryUpdates).toContain("/workspace/chosen");
});

test("queues agent-mode follow-ups as steering messages from the same composer", async () => {
  const { ideMessenger, store } = await renderWithProviders(<Chat />);
  const requests: AgentControlRequest[] = [];
  ideMessenger.responses.getWorkspaceDirs = ["file:///workspace/app"];
  ideMessenger.responseHandlers["agents/control"] = async (request) => {
    requests.push(request);
    if (request.action === "queue.add") {
      return {
        id: "queue-1",
        runId: request.runId,
        prompt: request.prompt,
        position: 0,
        createdAt: "2026-07-13T00:00:02.000Z",
        behavior: request.behavior ?? "run-next",
      };
    }
    return {
      id: "composer-run",
      revision: 0,
      title: "Review workspace",
      prompt: request.action === "run.create" ? request.request.prompt : "",
      status: "running",
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:01.000Z",
      permissionMode: "autonomous",
      workspace: {
        id: "workspace-1",
        location: "local",
        repositoryPath: "/workspace/app",
      },
    } satisfies AgentRun;
  };

  await act(async () => {
    addAndSelectMockLlm(store, ideMessenger);
    store.dispatch(setMode("agent"));
  });

  const editor = await getMainEditor();
  const sendButton = await getElementByTestId("submit-input-button");

  await act(async () => {
    editor.commands.insertContent("Agent task:\nReview the workspace");
  });
  await act(async () => {
    sendButton.click();
  });
  await waitFor(() => {
    expect(requests).toHaveLength(1);
  });

  await act(async () => {
    editor.commands.insertContent("Focus on the changed files");
  });
  await act(async () => {
    sendButton.click();
  });

  await waitFor(() => {
    expect(requests).toHaveLength(2);
    expect(store.getState().session.isStreaming).toBe(false);
  });
  expect(requests[1]).toMatchObject({
    action: "queue.add",
    runId: "composer-run",
    behavior: "steer",
  });
  expect(
    await screen.findByText(
      /Queued a steering message for the active durable agent/,
    ),
  ).toBeVisible();
});

test("sends steering context while a model response is already running", async () => {
  const { ideMessenger, store, user } = await renderWithProviders(<Chat />);
  let releaseFirstResponse!: () => void;
  const firstResponseGate = new Promise<void>((resolve) => {
    releaseFirstResponse = resolve;
  });
  let streamCallCount = 0;

  ideMessenger.responseHandlers["llm/compileChat"] = async () => {
    const history = store.getState().session.history;
    return {
      compiledChatMessages: history.map((item) => item.message),
      didPrune: false,
      contextPercentage: 0.5,
    };
  };
  ideMessenger.llmStreamChat = async function* (_message, signal) {
    streamCallCount += 1;
    if (streamCallCount === 1) {
      yield [{ role: "assistant", content: "Initial partial answer" }];
      await firstResponseGate;
      if (signal.aborted) return undefined;
      yield [{ role: "assistant", content: " stale tail" }];
      return undefined;
    }
    yield [{ role: "assistant", content: "Updated with your guidance" }];
    return undefined;
  };

  await act(async () => {
    addAndSelectMockLlm(store, ideMessenger);
  });

  const editor = await getMainEditor();
  await act(async () => {
    editor.commands.insertContent("Start the review");
  });
  await act(async () => {
    screen.getByTestId("submit-input-button").click();
  });
  await screen.findByText("Initial partial answer");

  await act(async () => {
    editor.commands.insertContent("Prioritize the failing tests");
  });
  await user.click(await getElementByTestId("editor-input-main"));
  await user.keyboard("{Enter}");

  expect(editor.getText()).toBe("");
  await screen.findByText("Prioritize the failing tests");
  releaseFirstResponse();

  await screen.findByText("Updated with your guidance");
  await waitFor(() => {
    expect(streamCallCount).toBe(2);
    expect(store.getState().session.isStreaming).toBe(false);
  });
  expect(screen.getByText("Initial partial answer")).toBeVisible();
  expect(screen.queryByText(/stale tail/)).toBeNull();
});

test("steers an active tool even when model token streaming is idle", async () => {
  const { ideMessenger, store, user } = await renderWithProviders(<Chat />);
  ideMessenger.responseHandlers["llm/compileChat"] = async () => {
    const history = store.getState().session.history;
    return {
      compiledChatMessages: history.map((item) => item.message),
      didPrune: false,
      contextPercentage: 0.5,
    };
  };
  ideMessenger.setChatResponseText("Continued after tool guidance");

  await act(async () => {
    addAndSelectMockLlm(store, ideMessenger);
    store.dispatch(
      newSession({
        sessionId: "active-tool-session",
        title: "Active tool",
        workspaceDirectory: "/workspace/app",
        mode: "agent",
        history: [
          {
            message: {
              role: "assistant",
              content: "Working with a tool",
              toolCalls: [
                {
                  id: "active-tool",
                  type: "function",
                  function: { name: "read_file", arguments: "{}" },
                },
              ],
            },
            contextItems: [],
            toolCallStates: [
              {
                toolCallId: "active-tool",
                toolCall: {
                  id: "active-tool",
                  type: "function",
                  function: { name: "read_file", arguments: "{}" },
                },
                parsedArgs: {},
                status: "generated",
              },
            ],
          },
        ],
      }),
    );
    store.dispatch(setToolCallCalling({ toolCallId: "active-tool" }));
    store.dispatch({ type: "session/setInactive" });
  });

  expect(store.getState().session.isStreaming).toBe(false);
  expect(
    store.getState().session.history.at(-1)?.toolCallStates?.[0].status,
  ).toBe("calling");
  expect(screen.getByRole("button", { name: "Stop" })).toBeVisible();
  const editor = await getMainEditor();
  await act(async () => {
    editor.commands.insertContent("Use the configuration file instead");
  });
  expect(screen.queryByTestId("submit-input-button")).toBeNull();
  await user.click(await getElementByTestId("editor-input-main"));
  await user.keyboard("{Enter}");

  await screen.findByText("Use the configuration file instead");
  await screen.findByText("Continued after tool guidance");
  expect(store.getState().session.history[0].toolCallStates?.[0].status).toBe(
    "canceled",
  );
});

test("surfaces a recoverable error instead of ignoring submit while chat model is loading", async () => {
  const { store } = await renderWithProviders(<Chat />);
  const editor = await getMainEditor();
  const sendButton = await getElementByTestId("submit-input-button");

  await act(async () => {
    editor.commands.insertContent("Hello World");
  });

  await act(async () => {
    sendButton.click();
  });

  await waitFor(() => {
    expect(store.getState().ui.showDialog).toBe(true);
    expect((store.getState().ui.dialogMessage as any)?.props?.error).toEqual(
      expect.objectContaining({
        message: "No chat model selected",
      }),
    );
  });
});

test("keyboard enter also submits into the recoverable error path while chat model is loading", async () => {
  const { store, user } = await renderWithProviders(<Chat />);
  const editor = await getMainEditor();
  const editorElement = await getElementByTestId("editor-input-main");

  await act(async () => {
    editor.commands.insertContent("Hello from keyboard");
  });

  await user.click(editorElement);
  await user.keyboard("{Enter}");

  await waitFor(() => {
    expect(store.getState().ui.showDialog).toBe(true);
    expect((store.getState().ui.dialogMessage as any)?.props?.error).toEqual(
      expect.objectContaining({
        message: "No chat model selected",
      }),
    );
  });
});

test("bounds initial rendering for large sessions and loads older items on demand", async () => {
  const { store, user } = await renderWithProviders(<Chat />);
  const history = Array.from({ length: 120 }, (_, index) => ({
    contextItems: [],
    message: {
      id: `assistant-${index + 1}`,
      role: "assistant" as const,
      content: `Large session message ${index + 1}`,
    },
  }));

  await act(async () => {
    store.dispatch(
      newSession({
        sessionId: "large-session",
        title: "Large session",
        workspaceDirectory: "/workspace/app",
        history,
      }),
    );
  });

  expect(screen.queryByText("Large session message 1")).not.toBeInTheDocument();
  expect(screen.getByText("Large session message 120")).toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Show 60 earlier items" }),
  );
  expect(screen.getByText("Large session message 1")).toBeInTheDocument();
});

test("starter prompts fill the main composer", async () => {
  const { user } = await renderWithProviders(<Chat />);
  const editor = await getMainEditor();

  await user.click(
    await screen.findByRole("button", { name: /Review Current File/ }),
  );

  await waitFor(() => {
    expect(editor.getText()).toBe(
      "Review the current file for bugs, edge cases, and risky changes.",
    );
  });
});

test("parallel actions stay in the main composer", async () => {
  const { user } = await renderWithProviders(<Chat />);
  const editor = await getMainEditor();

  await user.click(
    await screen.findByRole("button", { name: /Run in parallel/ }),
  );

  await waitFor(() => {
    expect(editor.getText()).toContain("Run in parallel:");
    expect(editor.getText()).toContain("Review the current workspace changes");
    expect(editor.getText()).toContain("Run the relevant validation checks");
    expect(editor.getText()).toContain(
      "Audit the UI for alignment, spacing, and overflow issues",
    );
  });
});

test("exposes voice input from the shipped main composer", async () => {
  await renderWithProviders(<Chat />);
  expect(
    await screen.findByRole("button", { name: "Start voice input" }),
  ).toBeInTheDocument();
});
