import type { ReviewActionRequest, ReviewReport } from "@qivryn/review-engine";
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MockIdeMessenger } from "../../context/MockIdeMessenger";
import { renderWithProviders } from "../../util/test/render";
import Review from ".";

function report(overrides: Partial<ReviewReport> = {}): ReviewReport {
  return {
    id: "review-1",
    repositoryPath: "/Users/user/workspace1",
    request: {
      id: "review-1",
      mode: "standard",
      target: { type: "working-tree" },
    },
    status: "completed",
    createdAt: "2026-06-29T00:00:00.000Z",
    updatedAt: "2026-06-29T00:00:01.000Z",
    analyzerIds: ["builtin.diff-safety"],
    revision: 2,
    summary: "1 finding",
    findings: [
      {
        id: "finding-1",
        requestId: "review-1",
        severity: "error",
        title: "Possible hard-coded credential",
        body: "Load the value from the configured secret provider.",
        filepath: "src/auth.ts",
        startLine: 12,
        evidence: "const token = 'abcdefgh';",
        originalText: "const token = 'abcdefgh';",
        fingerprint: "credential",
        status: "open",
      },
    ],
    ...overrides,
  };
}

describe("Agent Review pane", () => {
  it("renders the compact review workflow and runs the selected target", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["reviews/list"] = [report()];
    let runRequest:
      | Parameters<
          NonNullable<(typeof messenger.responseHandlers)["reviews/run"]>
        >[0]
      | undefined;
    messenger.responseHandlers["reviews/run"] = async (request) => {
      runRequest = request;
      return report({ id: request.request.id, request: request.request });
    };
    const { user, container } = await renderWithProviders(<Review />, {
      mockIdeMessenger: messenger,
    });

    expect(await screen.findByText("Agent Review")).toBeInTheDocument();
    expect(
      screen.getByText("Possible hard-coded credential"),
    ).toBeInTheDocument();
    expect(screen.getByText("const token = 'abcdefgh';")).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass(
      "min-w-0",
      "overflow-hidden",
    );

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Review target" }),
      "staged",
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Review depth" }),
      "deep",
    );
    await user.click(screen.getByRole("button", { name: "Run review" }));
    await waitFor(() =>
      expect(runRequest).toMatchObject({
        repositoryPath: "/Users/user/workspace1",
        request: { mode: "deep", target: { type: "staged" } },
      }),
    );
  });

  it("selects a new running report instead of showing an older failure", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["reviews/list"] = [
      report({
        id: "old-failure",
        status: "failed",
        findings: [],
        summary: undefined,
        error: "Old provider failure",
      }),
    ];
    let finishReview: (() => void) | undefined;
    messenger.responseHandlers["reviews/run"] = (request) =>
      new Promise<ReviewReport>((resolve) => {
        finishReview = () =>
          resolve(
            report({
              id: request.request.id,
              request: request.request,
              status: "completed",
              findings: [],
              summary: "No findings",
            }),
          );
      });
    const { user } = await renderWithProviders(<Review />, {
      mockIdeMessenger: messenger,
    });
    await screen.findByText("Old provider failure");

    await user.click(screen.getByRole("button", { name: "Run review" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Review in progress",
    );
    expect(screen.queryByText("Old provider failure")).not.toBeInTheDocument();

    finishReview?.();
    await waitFor(() =>
      expect(
        screen.getByText("No findings for this change set."),
      ).toBeInTheDocument(),
    );
  });

  it("supports comments, feedback, dismissal, and Add to Chat", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["reviews/list"] = [report()];
    const actions: ReviewActionRequest[] = [];
    messenger.responseHandlers["reviews/action"] = async (request) => {
      actions.push(request);
      if (request.action === "comment") {
        return {
          id: "comment-1",
          findingId: request.findingId,
          body: request.body,
          author: "user",
          createdAt: "2026-06-29T00:00:02.000Z",
        };
      }
      if (request.action === "feedback") {
        return {
          findingId: request.findingId,
          value: request.value,
          createdAt: "2026-06-29T00:00:02.000Z",
        };
      }
      return report();
    };
    messenger.responses["reviews/comments"] = [];
    const { user, store } = await renderWithProviders(<Review />, {
      mockIdeMessenger: messenger,
    });
    await screen.findByText("Possible hard-coded credential");

    await user.click(screen.getByRole("button", { name: "Helpful finding" }));
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    const reply = screen.getByRole("textbox", { name: /Reply to Possible/ });
    await user.type(reply, "Use the environment provider");
    await user.click(screen.getByRole("button", { name: "Reply" }));
    await waitFor(() =>
      expect(actions).toEqual(
        expect.arrayContaining([
          { action: "feedback", findingId: "finding-1", value: "up" },
          {
            action: "status",
            reportId: "review-1",
            findingId: "finding-1",
            status: "dismissed",
          },
          {
            action: "comment",
            findingId: "finding-1",
            body: "Use the environment provider",
          },
        ]),
      ),
    );

    await user.click(screen.getByRole("button", { name: "Add to Chat" }));
    expect(store.getState().session.mainEditorContentTrigger).toMatchObject({
      type: "doc",
      content: expect.arrayContaining([
        expect.objectContaining({
          content: [{ type: "text", text: "Possible hard-coded credential" }],
        }),
      ]),
    });
  });

  it("opens a stable review deep link", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["reviews/list"] = [
      report({ id: "older", summary: "Older review" }),
      report({ id: "linked", summary: "Linked review" }),
    ];
    await renderWithProviders(<Review />, {
      mockIdeMessenger: messenger,
      routerProps: { initialEntries: ["/review?reviewId=linked"] },
    });
    expect(await screen.findByText("Linked review")).toBeInTheDocument();
  });

  it("does not present a failed analyzer as a clean review", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["reviews/list"] = [
      report({
        status: "failed",
        findings: [],
        summary: undefined,
        error:
          "ChatGPT Codex: 400 Bad Request\nURL: https://chatgpt.com/backend-api/codex/responses\nResponse: Unsupported parameter",
      }),
    ];
    await renderWithProviders(<Review />, { mockIdeMessenger: messenger });

    expect(await screen.findByRole("alert")).toHaveTextContent("Review failed");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "ChatGPT Codex: 400 Bad Request",
    );
    expect(screen.getByText("Technical details")).toBeInTheDocument();
    expect(screen.getByText(/Historical result from/)).toBeInTheDocument();
    expect(
      screen.queryByText("No findings for this change set."),
    ).not.toBeInTheDocument();
  });
});
