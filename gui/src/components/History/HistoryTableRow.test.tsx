import { screen, waitFor } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MockIdeMessenger } from "../../context/MockIdeMessenger";
import { newSession } from "../../redux/slices/sessionSlice";
import { setupStore } from "../../redux/store";
import { renderWithProviders } from "../../util/test/render";
import { HistoryTableRow } from "./HistoryTableRow";

const metadata = {
  title: "Hello World Assistance",
  sessionId: "hello-session",
  dateCreated: "2026-07-02T00:00:00.000Z",
  dateUpdated: "2026-07-02T00:05:00.000Z",
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
        <div role="list">
          <HistoryTableRow sessionMetadata={metadata} index={0} />
        </div>
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

  it("opens a saved chat inside a standalone window", async () => {
    (window as any).isFullScreen = true;
    const messenger = new MockIdeMessenger();
    messenger.responseHandlers["history/load"] = async ({ id }) => ({
      sessionId: id,
      title: metadata.title,
      workspaceDirectory: metadata.workspaceDirectory,
      history: [],
    });
    const post = vi.spyOn(messenger, "post");
    const { user, store } = await renderWithProviders(
      <>
        <div role="list">
          <HistoryTableRow sessionMetadata={metadata} index={0} />
        </div>
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
    expect(post).not.toHaveBeenCalledWith("session/openInMain", {
      sessionId: "hello-session",
    });
  });

  it("rehydrates a persisted current-session tab without overwriting it", async () => {
    const messenger = new MockIdeMessenger();
    const loadSession = vi.fn(async ({ id }) => ({
      sessionId: id,
      title: metadata.title,
      workspaceDirectory: metadata.workspaceDirectory,
      history: [],
    }));
    messenger.responseHandlers["history/load"] = loadSession;
    const store = setupStore({ ideMessenger: messenger });
    store.dispatch(
      newSession({
        sessionId: metadata.sessionId,
        title: metadata.title,
        workspaceDirectory: metadata.workspaceDirectory,
        history: [],
      }),
    );

    const { user } = await renderWithProviders(
      <div role="list">
        <HistoryTableRow sessionMetadata={metadata} index={0} />
      </div>,
      {
        mockIdeMessenger: messenger,
        routerProps: { initialEntries: ["/history"] },
        store,
      },
    );

    await user.click(
      screen.getByRole("button", { name: "Open chat Hello World Assistance" }),
    );

    await waitFor(() =>
      expect(loadSession).toHaveBeenCalledWith({ id: "hello-session" }),
    );
  });

  it("shows an in-progress icon and compact last-activity time", async () => {
    const now = new Date("2026-07-02T00:10:00.000Z").getTime();
    await renderWithProviders(
      <div role="list">
        <HistoryTableRow
          sessionMetadata={metadata}
          index={0}
          isRunning
          now={now}
        />
      </div>,
    );

    expect(
      screen.getByRole("button", {
        name: "Open chat Hello World Assistance, running",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("5m")).toHaveAttribute(
      "aria-label",
      "Last active 5m ago",
    );
    expect(
      document.querySelector(".qivryn-session-running-indicator"),
    ).toBeInTheDocument();
  });
});
