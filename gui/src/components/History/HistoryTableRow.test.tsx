import { screen, waitFor } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MockIdeMessenger } from "../../context/MockIdeMessenger";
import { renderWithProviders } from "../../util/test/render";
import { HistoryTableRow } from "./HistoryTableRow";

const metadata = {
  title: "Hello World Assistance",
  sessionId: "hello-session",
  dateCreated: "2026-07-02T00:00:00.000Z",
  workspaceDirectory: "/workspace/app",
  messageCount: 1,
};

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current route">{location.pathname}</output>;
}

afterEach(() => {
  delete (window as any).isFullScreen;
});

describe("HistoryTableRow", () => {
  it("opens a saved chat from the history list", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responseHandlers["history/load"] = async ({ id }) => ({
      sessionId: id,
      title: metadata.title,
      workspaceDirectory: metadata.workspaceDirectory,
      history: [],
    });
    const { user, store } = await renderWithProviders(
      <>
        <table>
          <tbody>
            <HistoryTableRow sessionMetadata={metadata} index={0} />
          </tbody>
        </table>
        <LocationProbe />
      </>,
      {
        mockIdeMessenger: messenger,
        routerProps: { initialEntries: ["/history"] },
      },
    );

    await user.click(
      screen.getByRole("button", { name: "Open chat Hello World Assistance" }),
    );

    expect(screen.getByLabelText("Current route")).toHaveTextContent("/");
    await waitFor(() =>
      expect(store.getState().session.id).toBe("hello-session"),
    );
  });

  it("hands a standalone-window selection back to the original chat", async () => {
    (window as any).isFullScreen = true;
    const messenger = new MockIdeMessenger();
    const post = vi.spyOn(messenger, "post");
    const { user } = await renderWithProviders(
      <table>
        <tbody>
          <HistoryTableRow sessionMetadata={metadata} index={0} />
        </tbody>
      </table>,
      { mockIdeMessenger: messenger },
    );

    await user.click(
      screen.getByRole("button", { name: "Open chat Hello World Assistance" }),
    );
    expect(post).toHaveBeenCalledWith("session/openInMain", {
      sessionId: "hello-session",
    });
  });
});
