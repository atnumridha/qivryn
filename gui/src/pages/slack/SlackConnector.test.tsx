import type { SlackAuthorization } from "@qivryn/slack-connector";
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MockIdeMessenger } from "../../context/MockIdeMessenger";
import { renderWithProviders } from "../../util/test/render";
import SlackConnector from ".";

const authorization: SlackAuthorization = {
  workspaceId: "T1",
  workspaceName: "Qivryn",
  channelIds: ["C1"],
  allowRead: true,
  allowWrite: false,
  createdAt: "2026-06-29T00:00:00.000Z",
  updatedAt: "2026-06-29T00:00:00.000Z",
};

describe("Slack connector UI", () => {
  it("defaults to read-only explicit authorization", async () => {
    const messenger = new MockIdeMessenger();
    let authorizeRequest: unknown;
    messenger.responseHandlers["slack/authorize"] = async (request) => {
      authorizeRequest = request;
      return authorization;
    };
    const { user, container } = await renderWithProviders(<SlackConnector />, {
      mockIdeMessenger: messenger,
    });
    await user.type(
      await screen.findByLabelText("Slack bot token"),
      "xoxb-secret",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Allowed Slack channels" }),
      "C1",
    );
    expect(
      screen.getByRole("checkbox", { name: "Allow reading" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Allow posting messages" }),
    ).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Authorize Slack" }));
    await waitFor(() =>
      expect(authorizeRequest).toEqual({
        token: "xoxb-secret",
        channelIds: ["C1"],
        allowRead: true,
        allowWrite: false,
      }),
    );
    expect(await screen.findByText("Authorized")).toBeInTheDocument();
    expect(screen.getByLabelText("Slack bot token")).toHaveValue("");
    expect(container.firstElementChild).toHaveClass(
      "min-w-0",
      "overflow-hidden",
    );
  });

  it("reads allowlisted messages and gates posting until write is authorized", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["slack/status"] = authorization;
    messenger.responses["slack/channels"] = [{ id: "C1", name: "engineering" }];
    messenger.responses["slack/messages"] = [
      { channelId: "C1", timestamp: "1.0", text: "Build passed", userId: "U1" },
    ];
    const { user } = await renderWithProviders(<SlackConnector />, {
      mockIdeMessenger: messenger,
    });
    await screen.findByText("Authorized");
    expect(
      screen.getByRole("textbox", { name: "Slack message" }),
    ).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: "Read Slack messages" }),
    );
    expect(await screen.findByText("Build passed")).toBeInTheDocument();
  });
});
