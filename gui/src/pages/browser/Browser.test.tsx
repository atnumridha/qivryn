import type { BrowserSession } from "@qivryn/agent-runtime";
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MockIdeMessenger } from "../../context/MockIdeMessenger";
import { renderWithProviders } from "../../util/test/render";
import BrowserWorkspace from ".";

function session(overrides: Partial<BrowserSession> = {}): BrowserSession {
  return {
    id: "browser-1",
    createdAt: "2026-06-29T00:00:00.000Z",
    updatedAt: "2026-06-29T00:00:01.000Z",
    url: "http://localhost:3000",
    title: "Local app",
    visible: false,
    locked: false,
    recording: "events",
    viewport: { width: 1280, height: 720 },
    ...overrides,
  };
}

describe("Browser workspace", () => {
  it("creates sessions and provides responsive navigation controls", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["browser/list"] = [];
    messenger.responseHandlers["browser/create"] = async (request) =>
      session({ visible: request.visible ?? false });
    const { user, container } = await renderWithProviders(
      <BrowserWorkspace />,
      {
        mockIdeMessenger: messenger,
      },
    );
    expect(
      await screen.findByText(/Create a headless or visible/),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "New browser session" }),
    );
    expect(
      await screen.findByRole("textbox", { name: "Browser URL" }),
    ).toHaveValue("http://localhost:3000");
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass(
      "min-w-0",
      "overflow-hidden",
    );
  });

  it("navigates, captures a screenshot, inspects DOM, and takes over", async () => {
    const messenger = new MockIdeMessenger();
    let current = session({ locked: true, lockOwner: "agent" });
    messenger.responses["browser/list"] = [current];
    const actions: string[] = [];
    messenger.responseHandlers["browser/action"] = async (request) => {
      actions.push(request.action);
      if (request.action === "screenshot") {
        return {
          event: {
            id: "event-shot",
            sessionId: current.id,
            sequence: 1,
            createdAt: "2026-06-29T00:00:02.000Z",
            kind: "screenshot",
            payload: {},
          },
          data: "cG5n",
          mediaType: "image/png",
        };
      }
      if (request.action === "dom") {
        return {
          event: {
            id: "event-dom",
            sessionId: current.id,
            sequence: 2,
            createdAt: "2026-06-29T00:00:03.000Z",
            kind: "dom",
            payload: {},
          },
          content: "<main>Ready</main>",
        };
      }
      if (request.action === "takeover") {
        current = session({ locked: true, lockOwner: "user" });
        messenger.responses["browser/list"] = [current];
      }
      return current;
    };
    const { user } = await renderWithProviders(<BrowserWorkspace />, {
      mockIdeMessenger: messenger,
    });
    await screen.findByText("Local app");
    await user.click(screen.getByRole("button", { name: "Screenshot" }));
    expect(
      await screen.findByRole("img", { name: "Browser screenshot" }),
    ).toHaveAttribute("src", "data:image/png;base64,cG5n");
    await user.click(screen.getByRole("button", { name: "DOM" }));
    expect(await screen.findByText("<main>Ready</main>")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Take over" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Release" }),
      ).toBeInTheDocument(),
    );
    expect(actions).toEqual(
      expect.arrayContaining(["screenshot", "dom", "takeover"]),
    );
  });
});
