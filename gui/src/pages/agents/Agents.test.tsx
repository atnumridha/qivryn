import type {
  AgentControlRequest,
  AgentEvent,
  AgentRun,
} from "@qivryn/agent-runtime";
import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route, Routes } from "react-router-dom";
import { MockIdeMessenger } from "../../context/MockIdeMessenger";
import { renderWithProviders } from "../../util/test/render";
import {
  addAndSelectChatModel,
  triggerConfigUpdate,
} from "../../util/test/config";
import Agents, { fileUriFromPath, normalizeFilePath } from ".";

afterEach(() => {
  delete (window as any).isFullScreen;
  delete (window as any).workspacePaths;
  window.localStorage.removeItem("qivryn.skills.catalog.v2");
  window.localStorage.removeItem("qivryn.models.catalog.v1");
  window.localStorage.removeItem("qivryn.agents.lastRepository");
});

function run(overrides: Partial<AgentRun>): AgentRun {
  return {
    id: "run-1",
    revision: 0,
    title: "Inspect authentication",
    prompt: "Review the authentication flow",
    status: "running",
    createdAt: "2026-06-29T00:00:00.000Z",
    updatedAt: "2026-06-29T00:00:01.000Z",
    permissionMode: "autonomous",
    workspace: {
      id: "workspace-1",
      location: "local",
      repositoryPath: "/workspace/app",
      branch: "codex/auth-review",
    },
    ...overrides,
  };
}

describe("Agents workspace", () => {
  it("normalizes POSIX, Windows, and UNC workspace URIs", () => {
    expect(normalizeFilePath("file:///Users/dev/My%20Project")).toBe(
      "/Users/dev/My Project",
    );
    expect(normalizeFilePath("file:///C:/Users/dev/My%20Project")).toBe(
      "C:/Users/dev/My Project",
    );
    expect(normalizeFilePath("file://server/share/My%20Project")).toBe(
      "//server/share/My Project",
    );
    expect(fileUriFromPath("C:\\Users\\dev\\My Project#1")).toBe(
      "file:///C:/Users/dev/My%20Project%231",
    );
    expect(fileUriFromPath("//server/share/My Project")).toBe(
      "file://server/share/My%20Project",
    );
  });

  it("closes the standalone Agents window when returning to chat", async () => {
    (window as any).isFullScreen = true;
    const messenger = new MockIdeMessenger();
    const post = vi.spyOn(messenger, "post");
    const { user } = await renderWithProviders(<Agents />, {
      mockIdeMessenger: messenger,
    });

    await user.click(
      await screen.findByRole("button", { name: "Back to chat" }),
    );
    expect(post).toHaveBeenCalledWith("closeAgentWindow", undefined);
  });

  it("routes explicit new-agent entries to the unified composer", async () => {
    await renderWithProviders(
      <Routes>
        <Route path="/agents" element={<Agents />} />
        <Route path="/" element={<div>Chat screen</div>} />
      </Routes>,
      { routerProps: { initialEntries: ["/agents?new=1"] } },
    );

    expect(await screen.findByText("Chat screen")).toBeVisible();
  });

  it("routes bare agent workspace entries to the unified composer", async () => {
    await renderWithProviders(
      <Routes>
        <Route path="/agents" element={<Agents />} />
        <Route path="/" element={<div>Chat screen</div>} />
      </Routes>,
      { routerProps: { initialEntries: ["/agents"] } },
    );

    expect(await screen.findByText("Chat screen")).toBeVisible();
  });

  it("opens the agents and chats panel from an explicit route", async () => {
    await renderWithProviders(<Agents />, {
      routerProps: { initialEntries: ["/agents?panel=1"] },
    });

    expect(await screen.findByLabelText("Agents and chats")).toBeVisible();
    expect(
      await screen.findByText(
        "Select an agent or chat from the session panel.",
      ),
    ).toBeVisible();
    expect(screen.getByLabelText("Hide agents and chats")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("keeps the wide task navigator collapsed until requested", async () => {
    await renderWithProviders(<Agents />);

    const workspace = await screen.findByTestId("agents-workspace");
    const shell = workspace.querySelector(".cursor-agent-shell-grid");
    expect(shell).toHaveAttribute("data-wide-navigation-open", "false");

    const showNavigation = screen.getByLabelText("Show agents and chats");
    await act(async () => showNavigation.click());
    expect(shell).toHaveAttribute("data-wide-navigation-open", "true");

    const hideNavigation = screen.getByLabelText("Hide agents and chats");
    await act(async () => hideNavigation.click());
    expect(shell).toHaveAttribute("data-wide-navigation-open", "false");
  });

  it("keeps active runs running when selecting another task", async () => {
    const messenger = new MockIdeMessenger();
    const controlRequests: AgentControlRequest[] = [];
    messenger.responses["agents/list"] = [
      run({ id: "task-one", title: "First background task" }),
      run({ id: "task-two", title: "Second background task" }),
    ];
    messenger.responseHandlers["agents/control"] = async (request) => {
      controlRequests.push(request);
      return undefined;
    };
    const { user } = await renderWithProviders(<Agents />, {
      mockIdeMessenger: messenger,
    });

    await user.click(
      await screen.findByRole("button", { name: /First background task/ }),
    );
    expect(screen.getByTitle("Rename agent")).toHaveTextContent(
      "First background task",
    );

    await user.click(
      screen.getByRole("button", { name: /Second background task/ }),
    );
    await waitFor(() =>
      expect(screen.getByTitle("Rename agent")).toHaveTextContent(
        "Second background task",
      ),
    );

    expect(
      controlRequests.some((request) => request.action === "run.cancel"),
    ).toBe(false);
    expect(
      screen.getByRole("button", { name: /First background task/ }),
    ).toBeVisible();
    expect(
      screen.getAllByRole("button", { name: /Second background task/ })[0],
    ).toBeVisible();
  });

  it("provides an in-webview reload control in the standalone window", async () => {
    (window as any).isFullScreen = true;
    const messenger = new MockIdeMessenger();
    const post = vi.spyOn(messenger, "post");
    const { user } = await renderWithProviders(<Agents />, {
      mockIdeMessenger: messenger,
    });

    await user.click(
      await screen.findByRole("button", { name: "Reload Agents window" }),
    );
    expect(post).toHaveBeenCalledWith("reloadAgentWindow", { path: "/agents" });
  });

  it("does not render a separate create-agent screen from the route", async () => {
    await renderWithProviders(
      <Routes>
        <Route path="/agents" element={<Agents />} />
        <Route path="/" element={<div>Chat screen</div>} />
      </Routes>,
      { routerProps: { initialEntries: ["/agents?new=1"] } },
    );

    expect(await screen.findByText("Chat screen")).toBeVisible();
    expect(
      screen.queryByRole("form", { name: "Create agent" }),
    ).not.toBeInTheDocument();
  });

  it("groups runs, searches, and loads selected run events", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["agents/list"] = [
      run({ id: "active", title: "Inspect authentication" }),
      run({
        id: "child",
        title: "Validate tokens",
        parentRunId: "active",
        unread: true,
      }),
      run({
        id: "recent",
        title: "Update documentation",
        status: "completed",
        diffAdded: 12,
        diffRemoved: 3,
      }),
    ];
    messenger.responses["agents/events"] = [
      {
        id: "event-1",
        runId: "active",
        sequence: 1,
        kind: "run.created",
        createdAt: "2026-06-29T00:00:00.000Z",
        payload: {},
      },
    ];
    messenger.responses["agents/queue"] = [
      {
        id: "queue-1",
        runId: "active",
        prompt: "Run the focused tests",
        position: 0,
        createdAt: "2026-06-29T00:00:02.000Z",
        behavior: "run-next",
      },
    ];
    messenger.responses["agents/checkpoints"] = [
      {
        id: "checkpoint-1",
        runId: "active",
        createdAt: "2026-06-29T00:00:03.000Z",
        label: "Before tests",
      },
    ];
    messenger.responses["agents/plans"] = [
      {
        id: "plan-1",
        runId: "active",
        revision: 0,
        title: "Build feature",
        status: "draft",
        createdAt: "2026-06-29T00:00:04.000Z",
        updatedAt: "2026-06-29T00:00:04.000Z",
        items: [{ id: "step-1", text: "Implement", status: "pending" }],
      },
    ];
    let controlRequest: AgentControlRequest | undefined;
    messenger.responseHandlers["agents/control"] = async (request) => {
      controlRequest = request;
      if (request.action === "run.create") {
        return run({ id: "new-agent", title: "New task", status: "queued" });
      }
      if (request.action === "run.duplicate") {
        return run({ id: "copy", title: "Inspect authentication copy" });
      }
      return undefined;
    };
    const { user } = await renderWithProviders(<Agents />, {
      mockIdeMessenger: messenger,
    });

    expect(await screen.findByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Recent")).toBeInTheDocument();
    expect(screen.getByText("subagent")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Validate tokens/ })).toHaveStyle(
      { paddingLeft: "20px" },
    );
    await user.click(
      screen.getByRole("button", { name: /Inspect authentication/ }),
    );
    expect(screen.getByRole("region", { name: "Subagents" })).toHaveTextContent(
      "1 active · 1 total",
    );
    await user.click(
      screen.getByRole("button", { name: "Open subagent Validate tokens" }),
    );
    expect(screen.getByTitle("Rename agent")).toHaveTextContent(
      "Validate tokens",
    );
    await user.click(
      screen.getByRole("button", { name: /Inspect authentication/ }),
    );
    await waitFor(() =>
      expect(
        screen.getByLabelText("Agent actions").parentElement,
      ).toHaveTextContent("1 events"),
    );
    expect(
      screen.getByLabelText("Agent actions").parentElement,
    ).toHaveTextContent("1 checkpoints");
    expect(screen.getByText("Build feature")).toBeInTheDocument();
    expect(screen.getByText("0/1 · draft")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() =>
      expect(controlRequest).toMatchObject({
        action: "plan.status",
        planId: "plan-1",
        status: "approved",
      }),
    );
    expect(screen.getByText("Run the focused tests")).toBeInTheDocument();
    const queuedFollowUps = screen.getByLabelText("Queued follow-ups");
    const followUpComposer = screen
      .getByRole("textbox", {
        name: /Steer active agent|Queue follow-up/,
      })
      .closest("form")!;
    expect(
      queuedFollowUps.compareDocumentPosition(followUpComposer) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Edit Run the focused tests" }),
    );
    const queueEditor = screen.getByRole("textbox", {
      name: "Edit Run the focused tests",
    });
    await user.clear(queueEditor);
    await user.type(queueEditor, "Run all tests{enter}");
    await waitFor(() =>
      expect(controlRequest).toMatchObject({
        action: "queue.update",
        itemId: "queue-1",
        prompt: "Run all tests",
      }),
    );
    await user.click(screen.getByRole("button", { name: "New subagent" }));
    expect(
      screen.getByText(
        "Continue from Inspect authentication with inherited context.",
      ),
    ).toBeInTheDocument();
    await user.type(
      screen.getByRole("textbox", { name: "Agent task" }),
      "Validate refresh tokens",
    );
    await user.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() =>
      expect(controlRequest).toMatchObject({
        action: "run.create",
        request: {
          prompt: "Validate refresh tokens",
          parentRunId: "active",
          workspace: {
            repositoryPath: "/workspace/app",
          },
        },
      }),
    );
    await user.click(
      screen.getByRole("button", { name: /Inspect authentication/ }),
    );
    await screen.findByRole("button", { name: "Duplicate agent" });
    await user.click(screen.getByRole("button", { name: "Duplicate agent" }));
    await waitFor(() =>
      expect(controlRequest).toMatchObject({
        action: "run.duplicate",
        runId: "active",
      }),
    );

    await user.type(
      screen.getByRole("textbox", { name: "Search agents" }),
      "doc",
    );
    expect(
      screen.queryByText("Inspect authentication"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Update documentation")).toBeInTheDocument();
  });

  it("normalizes malformed agent events before rendering", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["agents/list"] = [
      run({ id: "active", title: "Inspect authentication" }),
    ];
    messenger.responses["agents/events"] = [
      undefined,
      {
        id: "event-1",
        runId: "active",
        kind: "message.assistant",
        createdAt: "2026-06-29T00:00:00.000Z",
        payload: { text: "Recovered assistant message" },
      },
    ] as unknown as AgentEvent[];

    const { user } = await renderWithProviders(<Agents />, {
      mockIdeMessenger: messenger,
    });

    await user.click(
      await screen.findByRole("button", { name: /Inspect authentication/ }),
    );

    expect(
      await screen.findByText("Recovered assistant message"),
    ).toBeVisible();
  });

  it("changes a durable run permission from the shared access menu", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["agents/list"] = [
      run({ id: "permissions", status: "completed" }),
    ];
    let controlRequest: AgentControlRequest | undefined;
    messenger.responseHandlers["agents/control"] = async (request) => {
      controlRequest = request;
      return run({
        id: "permissions",
        status: "completed",
        permissionMode:
          request.action === "permission.set"
            ? request.permissionMode
            : "autonomous",
      });
    };
    const { user } = await renderWithProviders(<Agents />, {
      mockIdeMessenger: messenger,
    });

    await user.click(
      await screen.findByRole("button", { name: /Inspect authentication/ }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Agents mode dropdown" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Autonomous dropdown" }),
    );
    await user.click(
      await screen.findByRole("button", { name: /Full access/ }),
    );

    await waitFor(() =>
      expect(controlRequest).toMatchObject({
        action: "permission.set",
        runId: "permissions",
        permissionMode: "fullAccess",
      }),
    );
  });

  it("resolves tool approvals from the agent conversation", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["agents/list"] = [
      run({ id: "approval-run", status: "waiting" }),
    ];
    messenger.responses["agents/events"] = [
      {
        id: "approval-event",
        runId: "approval-run",
        sequence: 1,
        kind: "approval.requested" as const,
        createdAt: "2026-06-30T00:00:00.000Z",
        payload: {
          id: "approval-1",
          title: "Run tests?",
          detail: "The agent wants to run the focused test suite.",
          command: "npm test -- auth",
        },
      },
    ];
    let controlRequest: AgentControlRequest | undefined;
    messenger.responseHandlers["agents/control"] = async (request) => {
      controlRequest = request;
      return undefined;
    };
    const { user } = await renderWithProviders(<Agents />, {
      mockIdeMessenger: messenger,
      routerProps: { initialEntries: ["/agents?runId=approval-run"] },
    });

    expect(await screen.findByText("Run tests?")).toBeVisible();
    expect(screen.getByText("npm test -- auth")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Allow once" }));

    await waitFor(() =>
      expect(controlRequest).toEqual({
        action: "approval.resolve",
        runId: "approval-run",
        approvalId: "approval-1",
        decision: "approve",
      }),
    );
  });

  it("shows CLI-launched subagents in the integrated agent summary", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["agents/list"] = [
      run({ id: "subagent-run", status: "running" }),
    ];
    messenger.responses["agents/events"] = [
      {
        id: "subagent-created",
        runId: "subagent-run",
        sequence: 1,
        kind: "subagent.created" as const,
        createdAt: "2026-06-30T00:00:00.000Z",
        payload: {
          name: "security-reviewer",
          status: "running",
          text: "Reviewing authentication changes",
        },
      },
      {
        id: "subagent-updated",
        runId: "subagent-run",
        sequence: 2,
        kind: "subagent.updated" as const,
        createdAt: "2026-06-30T00:00:01.000Z",
        payload: {
          name: "security-reviewer",
          status: "completed",
          text: "Authentication review complete",
        },
      },
    ];
    await renderWithProviders(<Agents />, {
      mockIdeMessenger: messenger,
      routerProps: { initialEntries: ["/agents?runId=subagent-run"] },
    });

    const summary = await screen.findByRole("region", { name: "Subagents" });
    expect(summary).toHaveTextContent("0 active · 1 total");
    expect(within(summary).getByText("security-reviewer")).toBeVisible();
    expect(
      within(summary).getByText("Authentication review complete"),
    ).toBeVisible();
  });

  it("attaches typed file and snapshot context to durable agent follow-ups", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["agents/list"] = [
      run({ id: "context-run", status: "completed" }),
    ];
    messenger.responses.getCurrentFile = {
      isUntitled: false,
      path: "file:///workspace/app/src/auth/session.ts",
      contents: "export const session = true;",
    };
    messenger.responses.getTerminalContents = "npm test\n2 tests failed";
    messenger.responses.getBranch = "feature/session-expiry";
    messenger.responses.getDiff = [
      "diff --git a/src/auth/session.ts b/src/auth/session.ts",
      "+export const expiresAt = 42;",
    ];
    messenger.responses["context/getSymbolsForFiles"] = {
      "file:///workspace/app/src/auth/session.ts": [
        {
          name: "session",
          type: "variable_declaration",
          content: "export const session = true;",
          filepath: "/workspace/app/src/auth/session.ts",
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 28 },
          },
        },
      ],
    };
    messenger.responseHandlers["context/getContextItems"] = async (request) =>
      request.name === "web"
        ? [
            {
              id: { providerTitle: "web", itemId: request.query },
              name: "Session guide",
              description: "Web result",
              content: "Sessions expire after 30 minutes.",
              uri: { type: "url", value: request.query },
            },
          ]
        : [
            {
              id: { providerTitle: request.name, itemId: request.query },
              name: "API docs",
              description: "MCP resource",
              content: "Use rotateSessionToken().",
            },
          ];
    messenger.responses["context/loadSubmenuItems"] = [
      {
        id: '{"mcpId":"docs","uri":"docs://sessions"}',
        title: "API docs",
        description: "Session API reference",
      },
    ];
    messenger.responses["mcp/getPrompt"] = {
      prompt: "Review the session implementation against the API contract.",
      description: "Review prompt",
    };
    const controlRequests: AgentControlRequest[] = [];
    messenger.responseHandlers["agents/control"] = async (request) => {
      controlRequests.push(request);
      return undefined;
    };
    const { user, store } = await renderWithProviders(<Agents />, {
      mockIdeMessenger: messenger,
    });
    triggerConfigUpdate({
      store,
      ideMessenger: messenger,
      editConfig(config) {
        config.contextProviders = [
          {
            title: "web",
            displayTitle: "Web",
            description: "Web context",
            type: "query",
          },
          {
            title: "mcp-docs" as any,
            displayTitle: "Docs resources",
            description: "MCP resources",
            type: "submenu",
          },
        ];
        config.mcpServerStatuses = [
          {
            id: "docs",
            name: "docs",
            command: "docs-server",
            status: "connected",
            errors: [],
            infos: [],
            isProtectedResource: false,
            prompts: [{ name: "review", description: "Review prompt" }],
            tools: [],
            resources: [],
            resourceTemplates: [],
          },
        ];
        return config;
      },
    });

    await user.click(
      await screen.findByRole("button", { name: /Inspect authentication/ }),
    );
    expect(screen.queryByText("Active file")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add agent context" }));
    expect(screen.getByRole("dialog", { name: "Agent context" })).toBeVisible();
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("dialog", { name: "Agent context" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add agent context" }),
    ).toHaveAttribute("aria-expanded", "false");
    await user.click(screen.getByRole("button", { name: "Add agent context" }));
    await user.click(screen.getByRole("button", { name: "Active file" }));
    expect(screen.getByText("src/auth/session.ts")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add agent context" }));
    await user.click(screen.getByRole("button", { name: "Terminal" }));
    expect(screen.getByText("Terminal snapshot")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add agent context" }));
    await user.click(screen.getByRole("button", { name: "Git changes" }));
    expect(
      screen.getByText("Git snapshot · feature/session-expiry"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add agent context" }));
    await user.click(screen.getByRole("button", { name: "File symbols" }));
    expect(
      screen.getByText("Symbols · src/auth/session.ts"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add agent context" }));
    await user.click(screen.getByText("More context sources"));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Agent context source" }),
      "web",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Agent context query" }),
      "https://docs.example.test/sessions",
    );
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(
      screen.getByText("Web · https://docs.example.test/sessions"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add agent context" }));
    await user.click(screen.getByText("More context sources"));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Agent context source" }),
      "mcp-docs",
    );
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(await screen.findByRole("button", { name: "API docs" }));
    expect(screen.getByText(/^API docs ·/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add agent context" }));
    await user.click(screen.getByText("MCP prompts"));
    await user.click(screen.getByRole("button", { name: "docs / review" }));
    expect(screen.getByText("MCP prompt · docs/review")).toBeInTheDocument();

    await user.type(
      screen.getByRole("textbox", { name: "Queue follow-up" }),
      "Inspect session expiry",
    );
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(controlRequests).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: "queue.add",
            runId: "context-run",
          }),
          expect.objectContaining({
            action: "run.resume",
            runId: "context-run",
          }),
        ]),
      ),
    );
    const controlRequest = controlRequests.find(
      (request) => request.action === "queue.add",
    );
    expect(controlRequest).toMatchObject({
      action: "queue.add",
      runId: "context-run",
    });
    if (controlRequest?.action !== "queue.add") {
      throw new Error("Expected a queue.add request");
    }
    expect(controlRequest.prompt).toContain(
      '<context_files>\nRead these repository-relative files as relevant before responding:\n- "src/auth/session.ts"\n</context_files>',
    );
    expect(controlRequest.prompt).toContain(
      '<context_snapshot type="terminal">\nnpm test\n2 tests failed\n</context_snapshot>',
    );
    expect(controlRequest.prompt).toContain(
      '<context_snapshot type="git" branch="feature/session-expiry">\ndiff --git a/src/auth/session.ts b/src/auth/session.ts\n+export const expiresAt = 42;\n</context_snapshot>',
    );
    expect(controlRequest.prompt).toContain(
      '<context_snapshot type="symbols" source="src/auth/session.ts">',
    );
    expect(controlRequest.prompt).toContain(
      '<context_snapshot type="provider" provider="web" label="Web" query="https://docs.example.test/sessions">',
    );
    expect(controlRequest.prompt).toContain(
      '<context_snapshot type="provider" provider="mcp-docs" label="API docs"',
    );
    expect(controlRequest.prompt).toContain(
      '<context_snapshot type="mcp-prompt" server="docs" name="review">',
    );
  });

  it("steers a running agent through the same follow-up composer", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["agents/list"] = [
      run({ id: "running-agent", status: "running" }),
    ];
    const controlRequests: AgentControlRequest[] = [];
    messenger.responseHandlers["agents/control"] = async (request) => {
      controlRequests.push(request);
      return undefined;
    };
    const { user } = await renderWithProviders(<Agents />, {
      mockIdeMessenger: messenger,
    });

    await user.click(
      await screen.findByRole("button", { name: /Inspect authentication/ }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Steer active agent" }),
      "Prioritize the failing test",
    );
    expect(screen.getByRole("button", { name: "Steer now" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Steer" }));

    await waitFor(() =>
      expect(controlRequests).toContainEqual(
        expect.objectContaining({
          action: "queue.add",
          runId: "running-agent",
          prompt: "Prioritize the failing test",
          behavior: "steer",
        }),
      ),
    );
    expect(controlRequests).not.toContainEqual(
      expect.objectContaining({ action: "run.resume" }),
    );
    expect(
      screen.getByRole("textbox", { name: "Steer active agent" }),
    ).toHaveValue("");
  });

  it("keeps a steering message in the composer when delivery fails", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["agents/list"] = [
      run({ id: "running-agent", status: "running" }),
    ];
    const request = messenger.request.bind(messenger);
    vi.spyOn(messenger, "request").mockImplementation(
      async (messageType, data) => {
        if (messageType === "agents/control") {
          return {
            status: "error",
            error: "Agent runtime unavailable",
            done: true,
          } as any;
        }
        return request(messageType, data as never) as any;
      },
    );
    const { user } = await renderWithProviders(<Agents />, {
      mockIdeMessenger: messenger,
    });

    await user.click(
      await screen.findByRole("button", { name: /Inspect authentication/ }),
    );
    const composer = screen.getByRole("textbox", {
      name: "Steer active agent",
    });
    await user.type(composer, "Prioritize the failing test");
    await user.click(screen.getByRole("button", { name: "Steer" }));

    expect(
      await screen.findByText("Follow-up was not sent. Try again."),
    ).toBeVisible();
    expect(composer).toHaveValue("Prioritize the failing test");
  });

  it("keeps follow-up drafts isolated to their agent", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["agents/list"] = [
      run({ id: "agent-one", title: "First agent", status: "running" }),
      run({ id: "agent-two", title: "Second agent", status: "running" }),
    ];
    const { user } = await renderWithProviders(<Agents />, {
      mockIdeMessenger: messenger,
    });

    await user.click(
      await screen.findByRole("button", { name: /First agent/ }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Steer active agent" }),
      "Draft for the first agent",
    );

    await user.click(screen.getByRole("button", { name: /Second agent/ }));

    expect(
      screen.getByRole("textbox", { name: "Steer active agent" }),
    ).toHaveValue("");
  });

  it("queues the next turn from an active agent with Cmd+Enter", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["agents/list"] = [
      run({ id: "running-agent", status: "running" }),
    ];
    const controlRequests: AgentControlRequest[] = [];
    messenger.responseHandlers["agents/control"] = async (request) => {
      controlRequests.push(request);
      return undefined;
    };
    const { user } = await renderWithProviders(<Agents />, {
      mockIdeMessenger: messenger,
    });

    await user.click(
      await screen.findByRole("button", { name: /Inspect authentication/ }),
    );
    const composer = screen.getByRole("textbox", {
      name: "Steer active agent",
    });
    await user.type(composer, "Run validation after this turn");
    await user.keyboard("{Meta>}{Enter}{/Meta}");

    await waitFor(() =>
      expect(controlRequests).toContainEqual(
        expect.objectContaining({
          action: "queue.add",
          runId: "running-agent",
          prompt: "Run validation after this turn",
          behavior: "run-next",
        }),
      ),
    );
  });

  it("exposes queue-next delivery without requiring a keyboard shortcut", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["agents/list"] = [
      run({ id: "running-agent", status: "running" }),
    ];
    const controlRequests: AgentControlRequest[] = [];
    messenger.responseHandlers["agents/control"] = async (request) => {
      controlRequests.push(request);
      return undefined;
    };
    const { user } = await renderWithProviders(<Agents />, {
      mockIdeMessenger: messenger,
    });

    await user.click(
      await screen.findByRole("button", { name: /Inspect authentication/ }),
    );
    await user.click(screen.getByRole("button", { name: "Use queue next" }));
    await user.type(
      screen.getByRole("textbox", { name: "Steer active agent" }),
      "Run validation after this turn",
    );
    await user.click(screen.getByRole("button", { name: "Queue next" }));

    await waitFor(() =>
      expect(controlRequests).toContainEqual(
        expect.objectContaining({
          action: "queue.add",
          runId: "running-agent",
          prompt: "Run validation after this turn",
          behavior: "run-next",
        }),
      ),
    );
  });

  it("edits an earlier prompt and resends it as an immutable agent branch", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["agents/list"] = [
      run({ id: "source", status: "completed" }),
    ];
    let controlRequest: AgentControlRequest | undefined;
    messenger.responseHandlers["agents/control"] = async (request) => {
      controlRequest = request;
      if (request.action === "run.create") {
        return run({
          id: "revised",
          prompt: request.request.prompt,
          status: "queued",
        });
      }
      return undefined;
    };
    const { user } = await renderWithProviders(<Agents />, {
      mockIdeMessenger: messenger,
    });

    await user.click(
      await screen.findByRole("button", { name: /Inspect authentication/ }),
    );
    await user.click(
      await screen.findByRole("button", {
        name: "Edit and resend initial message",
      }),
    );
    const editor = screen.getByRole("textbox", { name: "Queue follow-up" });
    expect(editor).toHaveValue("Review the authentication flow");
    await user.clear(editor);
    await user.type(editor, "Review authentication and fix every issue");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(controlRequest).toMatchObject({
        action: "run.create",
        request: {
          prompt: "Review authentication and fix every issue",
          metadata: { branchedFromRunId: "source" },
        },
      }),
    );
  });

  it("shows a useful empty state", async () => {
    const { user } = await renderWithProviders(<Agents />);
    expect(
      await screen.findByText("No agent runs or chat sessions yet."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start an agent" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open chat" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start an agent" }));
    expect(
      screen.queryByRole("form", { name: "Create agent" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Agent task" }),
    ).not.toBeInTheDocument();
  });

  it("shows existing chat sessions alongside durable agent runs", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["history/list"] = [
      {
        sessionId: "legacy-chat",
        title: "Review TV playback",
        dateCreated: "2026-06-29T10:00:00.000Z",
        workspaceDirectory: "/workspace/TVTunnerApp",
        messageCount: 177,
      },
    ];
    await renderWithProviders(<Agents />, { mockIdeMessenger: messenger });
    expect(await screen.findByText("Chats")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Review TV playback/ }),
    ).toHaveTextContent("TVTunnerApp");
    expect(
      screen.getByRole("button", { name: /Review TV playback/ }),
    ).toHaveTextContent("177 messages");
  });

  it("opens a saved chat with one click through the shared session runtime", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["history/list"] = [
      {
        sessionId: "legacy-chat",
        title: "Review TV playback",
        dateCreated: "2026-06-29T10:00:00.000Z",
        workspaceDirectory: "/workspace/TVTunnerApp",
        messageCount: 177,
      },
    ];
    let loadedSessionId: string | undefined;
    messenger.responseHandlers["history/load"] = async ({ id }) => {
      loadedSessionId = id;
      return {
        sessionId: id,
        title: "Review TV playback",
        workspaceDirectory: "/workspace/TVTunnerApp",
        history: [],
      };
    };

    const { user } = await renderWithProviders(<Agents />, {
      mockIdeMessenger: messenger,
    });
    const row = await screen.findByRole("button", {
      name: /Review TV playback/,
    });
    await user.click(row);
    await waitFor(() => expect(loadedSessionId).toBe("legacy-chat"));
  });

  it("restores a clickable retry action when a saved chat cannot be opened", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["history/list"] = [
      {
        sessionId: "unavailable-chat",
        title: "Unavailable session",
        dateCreated: "2026-06-29T10:00:00.000Z",
        workspaceDirectory: "/workspace/app",
        messageCount: 12,
      },
    ];
    messenger.responseHandlers["history/load"] = async () => {
      throw new Error("Session storage is unavailable");
    };

    const { user } = await renderWithProviders(<Agents />, {
      mockIdeMessenger: messenger,
    });
    await user.click(
      await screen.findByRole("button", { name: /Unavailable session/ }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Session storage is unavailable",
    );
    expect(screen.getByRole("button", { name: "Retry opening" })).toBeEnabled();
  });

  it("opens large chats in-place instead of handing them to the broken stock chat surface", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["history/list"] = [
      {
        sessionId: "large-chat",
        title: "Large implementation session",
        dateCreated: "2026-06-29T10:00:00.000Z",
        workspaceDirectory: "/workspace/app",
        messageCount: 452,
      },
    ];
    let loadedSessionId: string | undefined;
    messenger.responseHandlers["session/openInMain"] = async () => {
      throw new Error("stock chat handoff must not be used");
    };
    messenger.responseHandlers["history/load"] = async ({ id }) => {
      loadedSessionId = id;
      return {
        sessionId: id,
        title: "Large implementation session",
        workspaceDirectory: "/workspace/app",
        history: [],
      };
    };

    const { user } = await renderWithProviders(<Agents />, {
      mockIdeMessenger: messenger,
    });
    await user.click(
      await screen.findByRole("button", {
        name: /Large implementation session/,
      }),
    );

    await waitFor(() => expect(loadedSessionId).toBe("large-chat"));
  });

  it("supports keyboard-first multi-repository monitoring", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["agents/list"] = [
      run({
        id: "repo-a",
        title: "Repository A",
        workspace: {
          id: "workspace-a",
          location: "local",
          repositoryPath: "/workspace/app",
          branch: "main",
        },
      }),
      run({
        id: "repo-b",
        title: "Repository B",
        workspace: {
          id: "workspace-b",
          location: "local",
          repositoryPath: "/workspace/service",
          branch: "feature",
        },
      }),
    ];
    const { user } = await renderWithProviders(<Agents />, {
      mockIdeMessenger: messenger,
    });
    const workspace = await screen.findByRole("generic", {
      name: "Agents workspace",
    });
    workspace.focus();
    await user.keyboard("{ArrowDown}");
    expect(
      screen
        .getAllByRole("button", { name: /Repository A/ })
        .find((element) => element.classList.contains("bg-list-active")),
    ).toBeDefined();
    await user.keyboard("{ArrowDown}");
    expect(
      screen
        .getAllByRole("button", { name: /Repository B/ })
        .find((element) => element.classList.contains("bg-list-active")),
    ).toBeDefined();
    await user.keyboard("/");
    expect(
      screen.getByRole("textbox", { name: "Search agents" }),
    ).toHaveFocus();
    workspace.focus();
    await user.keyboard("n");
    expect(
      screen.queryByRole("textbox", { name: "Agent task" }),
    ).not.toBeInTheDocument();
    workspace.focus();
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("form", { name: "Create agent" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("app")).toBeInTheDocument();
    expect(screen.getByText("service")).toBeInTheDocument();
  });

  it("keeps top-level agent launch on the unified composer", async () => {
    await renderWithProviders(
      <Routes>
        <Route path="/agents" element={<Agents />} />
        <Route path="/" element={<div>Chat composer</div>} />
      </Routes>,
      {
        routerProps: { initialEntries: ["/agents"] },
      },
    );

    expect(await screen.findByText("Chat composer")).toBeVisible();
    expect(
      screen.queryByRole("form", { name: "Create agent" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Agent task" }),
    ).not.toBeInTheDocument();
  });

  it("batches a ten-thousand-event transcript without a nested scroll owner", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["agents/list"] = [
      run({ id: "large", title: "Large transcript", status: "completed" }),
    ];
    messenger.responses["agents/events"] = Array.from(
      { length: 10_000 },
      (_, index) => ({
        id: `event-${index + 1}`,
        runId: "large",
        sequence: index + 1,
        kind:
          index % 2 === 0
            ? ("tool.output" as const)
            : ("message.assistant" as const),
        createdAt: "2026-06-29T00:00:00.000Z",
        payload: { text: `Output ${index + 1}` },
      }),
    );
    await renderWithProviders(<Agents />, {
      mockIdeMessenger: messenger,
      routerProps: { initialEntries: ["/agents?runId=large"] },
    });
    expect(
      (await screen.findByLabelText("Agent actions")).parentElement,
    ).toHaveTextContent("10000 events");
    expect(screen.getAllByTestId("agent-event-row").length).toBeLessThanOrEqual(
      200,
    );
    expect(screen.queryByText("Output 1")).not.toBeInTheDocument();
    expect(screen.getByText("Output 10000")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show 200 earlier events" }),
    ).toBeInTheDocument();
  });

  it("renders one collapsed disclosure per tool call", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["agents/list"] = [
      run({ id: "tool-run", title: "Tool activity", status: "completed" }),
    ];
    messenger.responses["agents/events"] = [
      {
        id: "read-start",
        runId: "tool-run",
        sequence: 1,
        kind: "tool.started" as const,
        createdAt: "2026-06-30T00:00:00.000Z",
        payload: {
          toolName: "read_file",
          args: { filepath: "/src/app.ts" },
          text: "Using read_file",
        },
      },
      {
        id: "read-complete",
        runId: "tool-run",
        sequence: 2,
        kind: "tool.completed" as const,
        createdAt: "2026-06-30T00:00:01.200Z",
        payload: { toolName: "read_file", text: "file contents" },
      },
      {
        id: "list-start",
        runId: "tool-run",
        sequence: 3,
        kind: "tool.started" as const,
        createdAt: "2026-06-30T00:00:02.000Z",
        payload: { toolName: "list", text: "Using list" },
      },
      {
        id: "list-failed",
        runId: "tool-run",
        sequence: 4,
        kind: "tool.failed" as const,
        createdAt: "2026-06-30T00:00:02.100Z",
        payload: { toolName: "list", text: "Directory does not exist" },
      },
    ];

    const { user } = await renderWithProviders(<Agents />, {
      mockIdeMessenger: messenger,
      routerProps: { initialEntries: ["/agents?runId=tool-run"] },
    });

    const activityDrawer = await screen.findByTestId("agent-activity-drawer");
    expect(await screen.findByText("Read file")).toBeVisible();
    expect(screen.getAllByText("/src/app.ts")[0]).toBeVisible();
    const readCard = screen.getByText("Read file").closest("details");
    expect(readCard).not.toHaveAttribute("open");
    expect(
      within(readCard!).getAllByText("file contents")[1],
    ).not.toBeVisible();
    await user.click(within(readCard!).getByText("Read file"));
    expect(within(readCard!).getAllByText("file contents")[1]).toBeVisible();
    const failedCard = screen.getByText("List").closest("details");
    expect(failedCard).not.toHaveAttribute("open");
    expect(screen.getAllByTestId("agent-event-row")).toHaveLength(2);
  });

  it("matches concurrent same-name tool results by tool call id", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["agents/list"] = [
      run({ id: "tool-ids", title: "Concurrent tools", status: "completed" }),
    ];
    messenger.responses["agents/events"] = [
      {
        id: "start-a",
        runId: "tool-ids",
        sequence: 1,
        kind: "tool.started" as const,
        createdAt: "2026-06-30T00:00:00.000Z",
        payload: {
          toolName: "read_file",
          toolCallId: "call-a",
          args: { filepath: "/src/a.ts" },
        },
      },
      {
        id: "start-b",
        runId: "tool-ids",
        sequence: 2,
        kind: "tool.started" as const,
        createdAt: "2026-06-30T00:00:00.100Z",
        payload: {
          toolName: "read_file",
          toolCallId: "call-b",
          args: { filepath: "/src/b.ts" },
        },
      },
      {
        id: "finish-b",
        runId: "tool-ids",
        sequence: 3,
        kind: "tool.completed" as const,
        createdAt: "2026-06-30T00:00:01.000Z",
        payload: {
          toolName: "read_file",
          toolCallId: "call-b",
          text: "contents-b",
        },
      },
      {
        id: "finish-a",
        runId: "tool-ids",
        sequence: 4,
        kind: "tool.completed" as const,
        createdAt: "2026-06-30T00:00:01.100Z",
        payload: {
          toolName: "read_file",
          toolCallId: "call-a",
          text: "contents-a",
        },
      },
    ];

    const { user } = await renderWithProviders(<Agents />, {
      mockIdeMessenger: messenger,
      routerProps: { initialEntries: ["/agents?runId=tool-ids"] },
    });

    const cardA = (await screen.findByText("/src/a.ts")).closest("details")!;
    const cardB = screen.getByText("/src/b.ts").closest("details")!;
    await user.click(within(cardA).getByText("Read file"));
    await user.click(within(cardB).getByText("Read file"));
    expect(within(cardA).getAllByText("contents-a")[1]).toBeVisible();
    expect(within(cardA).queryByText("contents-b")).not.toBeInTheDocument();
    expect(within(cardB).getAllByText("contents-b")[1]).toBeVisible();
    expect(within(cardB).queryByText("contents-a")).not.toBeInTheDocument();
  });

  it("appends live agent events before the run completes", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["agents/list"] = [
      run({ id: "live-run", title: "Live task", status: "running" }),
    ];
    messenger.responses["agents/events"] = [];
    messenger.streamChunks["agents/stream"] = [
      [
        {
          id: "assistant-1",
          runId: "live-run",
          sequence: 1,
          kind: "message.assistant" as const,
          createdAt: "2026-06-30T00:00:00.000Z",
          payload: { text: "Working ", delta: true },
        },
        {
          id: "assistant-2",
          runId: "live-run",
          sequence: 2,
          kind: "message.assistant" as const,
          createdAt: "2026-06-30T00:00:00.100Z",
          payload: { text: "now", delta: true },
        },
        {
          id: "tool-1",
          runId: "live-run",
          sequence: 3,
          kind: "tool.started" as const,
          createdAt: "2026-06-30T00:00:00.200Z",
          payload: { text: "Using read_file", toolName: "read_file" },
        },
      ],
    ];

    await renderWithProviders(<Agents />, {
      mockIdeMessenger: messenger,
      routerProps: { initialEntries: ["/agents?runId=live-run"] },
    });

    expect(await screen.findByText("● Live")).toBeVisible();
    expect(await screen.findByText("Working now")).toBeVisible();
    const activityDrawer = await screen.findByTestId("agent-activity-drawer");
    expect(activityDrawer.querySelector("summary")).toHaveTextContent(
      "Read file",
    );
    expect(await screen.findByText("Using read_file")).toBeVisible();
    expect(
      (await screen.findByLabelText("Agent actions")).parentElement,
    ).toHaveTextContent("3 events");
  });

  it("derives one working state without rendering persisted heartbeats", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["agents/list"] = [
      run({ id: "progress-run", title: "Progress task", status: "running" }),
    ];
    messenger.responses["agents/events"] = [
      {
        id: "progress-1",
        runId: "progress-run",
        sequence: 1,
        kind: "run.progress" as const,
        createdAt: "2026-06-30T00:00:00.000Z",
        payload: { text: "Agent is working…" },
      },
      {
        id: "tool-1",
        runId: "progress-run",
        sequence: 2,
        kind: "tool.started" as const,
        createdAt: "2026-06-30T00:00:01.000Z",
        payload: { text: "Using read_file", toolName: "read_file" },
      },
      {
        id: "progress-2",
        runId: "progress-run",
        sequence: 3,
        kind: "run.progress" as const,
        createdAt: "2026-06-30T00:00:02.000Z",
        payload: { text: "Agent is working…" },
      },
      {
        id: "assistant-1",
        runId: "progress-run",
        sequence: 4,
        kind: "message.assistant" as const,
        createdAt: "2026-06-30T00:00:03.000Z",
        payload: { text: "Still inspecting the repository." },
      },
      {
        id: "progress-3",
        runId: "progress-run",
        sequence: 5,
        kind: "run.progress" as const,
        createdAt: "2026-06-30T00:00:04.000Z",
        payload: { text: "Agent is working…" },
      },
    ];

    await renderWithProviders(<Agents />, {
      mockIdeMessenger: messenger,
      routerProps: { initialEntries: ["/agents?runId=progress-run"] },
    });

    expect(
      await screen.findByText("Still inspecting the repository."),
    ).toBeVisible();
    expect(screen.queryByText("Agent is working…")).not.toBeInTheDocument();
    expect(screen.getByText("Working")).toBeVisible();
    expect(screen.getByTestId("agent-activity-drawer")).not.toHaveAttribute(
      "open",
    );
  });

  it("keeps hook and compaction bookkeeping out of the conversation", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["agents/list"] = [
      run({ id: "quiet-runtime", title: "Quiet runtime", status: "completed" }),
    ];
    messenger.responses["agents/events"] = [
      {
        id: "hook-result",
        runId: "quiet-runtime",
        sequence: 1,
        kind: "runtime.notice" as const,
        createdAt: "2026-06-30T00:00:00.000Z",
        payload: { type: "hook.result", result: { ok: true } },
      },
      {
        id: "compaction-start",
        runId: "quiet-runtime",
        sequence: 2,
        kind: "runtime.notice" as const,
        createdAt: "2026-06-30T00:00:01.000Z",
        payload: {
          text: "Approaching context limit. Auto-compacting chat history...",
        },
      },
      {
        id: "compaction-finish",
        runId: "quiet-runtime",
        sequence: 3,
        kind: "runtime.notice" as const,
        createdAt: "2026-06-30T00:00:02.000Z",
        payload: { text: "Chat history auto-compacted successfully." },
      },
      {
        id: "answer",
        runId: "quiet-runtime",
        sequence: 4,
        kind: "message.assistant" as const,
        createdAt: "2026-06-30T00:00:03.000Z",
        payload: { text: "The task is complete." },
      },
    ];

    await renderWithProviders(<Agents />, {
      mockIdeMessenger: messenger,
      routerProps: { initialEntries: ["/agents?runId=quiet-runtime"] },
    });

    expect(await screen.findByText("The task is complete.")).toBeVisible();
    expect(
      screen.queryByText(/Approaching context limit/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/auto-compacted/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Event 1/)).not.toBeInTheDocument();
  });

  it("focuses a recovered completed run while preserving its full history", async () => {
    const messenger = new MockIdeMessenger();
    const longPrompt = `${"Review the authentication flow carefully. ".repeat(12)}FULL_TASK_END`;
    messenger.responses["agents/list"] = [
      run({
        id: "recovered-run",
        title: "Recovered task",
        prompt: longPrompt,
        status: "completed",
      }),
    ];
    messenger.responses["agents/events"] = [
      {
        id: "old-notice",
        runId: "recovered-run",
        sequence: 1,
        kind: "runtime.notice" as const,
        createdAt: "2026-06-30T00:00:00.000Z",
        payload: { text: "Earlier recovery attempt failed noisily" },
      },
      {
        id: "old-tool",
        runId: "recovered-run",
        sequence: 2,
        kind: "tool.started" as const,
        createdAt: "2026-06-30T00:00:01.000Z",
        payload: { toolName: "read", args: { filepath: "large.ts" } },
      },
      {
        id: "old-failure",
        runId: "recovered-run",
        sequence: 3,
        kind: "tool.failed" as const,
        createdAt: "2026-06-30T00:00:02.000Z",
        payload: { toolName: "read", error: "File was too large" },
      },
      {
        id: "compacted",
        runId: "recovered-run",
        sequence: 4,
        kind: "runtime.notice" as const,
        createdAt: "2026-06-30T00:00:03.000Z",
        payload: { text: "Chat history auto-compacted successfully." },
      },
      {
        id: "final-answer",
        runId: "recovered-run",
        sequence: 5,
        kind: "message.assistant" as const,
        createdAt: "2026-06-30T00:00:04.000Z",
        payload: { text: "The authentication fix is complete." },
      },
    ];
    messenger.responses["agents/checkpoints"] = [
      {
        id: "checkpoint-1",
        runId: "recovered-run",
        createdAt: "2026-06-30T00:00:01.000Z",
        label: "Before agent changes",
      },
      {
        id: "checkpoint-2",
        runId: "recovered-run",
        createdAt: "2026-06-30T00:00:02.000Z",
        label: "Before agent changes",
      },
    ];

    const { user } = await renderWithProviders(<Agents />, {
      mockIdeMessenger: messenger,
      routerProps: { initialEntries: ["/agents?runId=recovered-run"] },
    });

    expect(
      await screen.findByText("The authentication fix is complete."),
    ).toBeVisible();
    expect(
      screen
        .getByText("Earlier recovery attempt failed noisily")
        .closest("details"),
    ).not.toHaveAttribute("open");
    expect(screen.queryByText("FULL_TASK_END")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show full task" }));
    expect(screen.getByText(/FULL_TASK_END/)).toBeVisible();

    await user.click(screen.getByText("Checkpoints"));
    expect(screen.getAllByText("Before agent changes")).toHaveLength(1);
    expect(screen.getByText("×2")).toBeVisible();

    expect(
      screen.queryByRole("button", { name: /Show earlier activity/ }),
    ).not.toBeInTheDocument();
    const activityDrawer = screen.getByTestId("agent-activity-drawer");
    const activitySummary = activityDrawer.querySelector(
      ".cursor-agent-runtime-drawer > summary",
    );
    if (!activitySummary) throw new Error("Expected activity summary");
    await user.click(activitySummary);
    expect(
      screen.getByText("Earlier recovery attempt failed noisily"),
    ).toBeVisible();
    expect(
      screen.getAllByText("File was too large")[0].closest("details"),
    ).not.toHaveAttribute("open");
  });

  it("resolves attribution links to the originating event and checkpoint", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["agents/list"] = [
      run({ id: "origin-run", title: "Generated parser" }),
    ];
    await renderWithProviders(<Agents />, {
      mockIdeMessenger: messenger,
      routerProps: {
        initialEntries: [
          "/agents?runId=origin-run&eventSequence=42&checkpointId=checkpoint-before-edit",
        ],
      },
    });
    expect(
      await screen.findByLabelText("AI attribution origin"),
    ).toHaveTextContent("event #42 · checkpoint checkpoint-before-edit");
  });

  it("creates and runs a persisted local automation", async () => {
    const messenger = new MockIdeMessenger();
    const requests: unknown[] = [];
    messenger.responseHandlers["agents/automationControl"] = async (value) => {
      requests.push(value);
      if (value.action === "run") {
        const createdRun = run({
          id: "automated-run",
          title: "Scheduled run output",
        });
        messenger.responses["agents/list"] = [createdRun];
        return createdRun;
      }
      if (value.action === "create") {
        messenger.responses["agents/automations"] = [
          {
            id: "automation-1",
            revision: 1,
            name: value.request.name,
            prompt: value.request.prompt,
            repositoryPath: value.request.repositoryPath,
            enabled: true,
            trigger: value.request.trigger,
            permissionMode: value.request.permissionMode ?? "autonomous",
            runtimeId: "local",
            createdAt: "2026-06-30T00:00:00.000Z",
            updatedAt: "2026-06-30T00:00:00.000Z",
          },
        ];
        return messenger.responses["agents/automations"][0];
      }
      if (value.action === "update") {
        const current = (messenger.responses["agents/automations"] as any[])[0];
        messenger.responses["agents/automations"] = [
          {
            ...current,
            ...value.request,
            revision: current.revision + 1,
          },
        ];
        return messenger.responses["agents/automations"][0];
      }
      return undefined;
    };
    const { user, store } = await renderWithProviders(<Agents />, {
      mockIdeMessenger: messenger,
    });
    await act(async () => {
      addAndSelectChatModel(store, messenger, {
        model: "schedule-model",
        provider: "mock",
        title: "Scheduled Reasoner",
        underlyingProviderName: "mock",
        requestOptions: {
          extraBodyProperties: {
            _reasoningLevels: ["low", "medium", "high", "xhigh"],
          },
        },
      });
    });
    await user.click(
      await screen.findByRole("button", { name: "Scheduled agent tasks" }),
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Automation schedule type" }),
      "daily",
    );
    expect(
      screen.getByRole("combobox", { name: "Automation model" }),
    ).toHaveValue("Scheduled Reasoner");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Automation reasoning" }),
      "high",
    );
    const scheduleTime = screen.getByLabelText("Automation local time");
    await user.clear(scheduleTime);
    await user.type(scheduleTime, "10:30");
    await user.type(
      screen.getByRole("textbox", { name: "Scheduled task name" }),
      "Review nightly",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Scheduled task prompt" }),
      "Review the working tree",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Scheduled task repository" }),
      "/workspace/app",
    );
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(
      await screen.findByRole("button", { name: "Run Review nightly" }),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Edit Review nightly" }),
    );
    const taskName = screen.getByRole("textbox", {
      name: "Scheduled task name",
    });
    await user.clear(taskName);
    await user.type(taskName, "Review mornings");
    await user.click(
      screen.getByRole("button", { name: "Save scheduled task" }),
    );
    expect(
      await screen.findByRole("button", { name: "Run Review mornings" }),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Run Review mornings" }),
    );
    await waitFor(() => {
      expect(
        screen
          .getAllByRole("button", { name: /Scheduled run output/ })
          .some((button) => button.className.includes("cursor-agent-row")),
      ).toBe(true);
    });
    expect(screen.getByLabelText("Hide agents and chats")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await waitFor(() =>
      expect(requests).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: "create",
            request: expect.objectContaining({
              trigger: { type: "daily", at: "10:30" },
              model: "Scheduled Reasoner",
              reasoningEffort: "high",
            }),
          }),
          expect.objectContaining({
            action: "update",
            automationId: "automation-1",
            request: expect.objectContaining({ name: "Review mornings" }),
          }),
          { action: "run", automationId: "automation-1" },
        ]),
      ),
    );
  });

  it("opens scheduled tasks from a first-class route", async () => {
    await renderWithProviders(<Agents />, {
      routerProps: { initialEntries: ["/agents?scheduled=1"] },
    });
    expect(
      await screen.findByRole("dialog", { name: "Scheduled agent tasks" }),
    ).toBeVisible();
  });

  it("opens the durable run created by a scheduled task", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["agents/list"] = [
      run({ id: "last-run", title: "Scheduled review output" }),
    ];
    messenger.responses["agents/automations"] = [
      {
        id: "automation-1",
        revision: 2,
        name: "Daily review",
        prompt: "Review the repository",
        repositoryPath: "/workspace/app",
        enabled: true,
        trigger: { type: "daily", at: "09:30" },
        permissionMode: "ask",
        runtimeId: "local",
        createdAt: "2026-06-30T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
        lastRunAt: "2026-07-01T09:30:00.000Z",
        lastRunId: "last-run",
      },
    ];
    const { user } = await renderWithProviders(<Agents />, {
      mockIdeMessenger: messenger,
    });
    await user.click(
      await screen.findByRole("button", { name: "Scheduled agent tasks" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Open last run" }),
    );
    expect(
      await screen.findByRole("button", { name: "Scheduled review output" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("dialog", { name: "Scheduled agent tasks" }),
    ).not.toBeInTheDocument();
  });

  it("keeps archived agents behind an explicit filter and can restore them", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["agents/list"] = [
      run({ id: "archived-run", title: "Archived audit", status: "archived" }),
    ];
    let request: unknown;
    messenger.responseHandlers["agents/control"] = async (value) => {
      request = value;
      return run({ id: "archived-run", status: "completed" });
    };
    const { user } = await renderWithProviders(<Agents />, {
      mockIdeMessenger: messenger,
    });
    expect(screen.queryByText("Archived audit")).not.toBeInTheDocument();
    await user.click(
      await screen.findByRole("button", { name: "Show archived agents" }),
    );
    await user.click(
      await screen.findByRole("button", { name: /Archived audit/ }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Unarchive agent" }),
    );
    expect(request).toEqual({ action: "unarchive", runId: "archived-run" });
  });

  it("opens real agent capability surfaces from the compact menu", async () => {
    const { user } = await renderWithProviders(<Agents />);
    await user.click(
      await screen.findByRole("button", { name: "Agent capabilities" }),
    );
    const menu = screen.getByRole("menu", {
      name: "Agent capabilities menu",
    });
    expect(menu).toHaveTextContent("Browser & computer use");
    expect(menu).toHaveTextContent("Tools & MCP");
    expect(menu).toHaveTextContent("Skills & plugins");
    expect(menu).not.toHaveTextContent("New agent");
    expect(menu).not.toHaveTextContent("New subagent");
    expect(menu).not.toHaveTextContent("Multitask");
    await user.click(screen.getByRole("menuitem", { name: "Scheduled tasks" }));
    expect(
      await screen.findByRole("dialog", { name: "Scheduled agent tasks" }),
    ).toBeVisible();
  });
});
