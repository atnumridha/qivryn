import { screen } from "@testing-library/dom";
import { act } from "@testing-library/react";
import { MockIdeMessenger } from "../../context/MockIdeMessenger";
import { setupStore } from "../../redux/store";
import {
  newSession,
  setActive,
  setAllSessionMetadata,
} from "../../redux/slices/sessionSlice";
import { renderWithProviders } from "../../util/test/render";
import HistoryPage from "./index";

const mockIdeMessenger = new MockIdeMessenger();
mockIdeMessenger.responses["history/list"] = [
  {
    title: "Session 1",
    sessionId: "session-1",
    dateCreated: new Date().toString(),
    workspaceDirectory: "/tmp",
  },
  {
    title: "Remote Agent",
    sessionId: "remote-agent-123",
    dateCreated: new Date().toString(),
    workspaceDirectory: "",
  },
];
describe("history Page test", () => {
  it("History text is existed after render", async () => {
    await renderWithProviders(<HistoryPage />, {
      mockIdeMessenger,
    });
    expect(screen.getByTestId("history-sessions-note")).toBeInTheDocument();
  });

  it("History shows the first item in the list", async () => {
    await renderWithProviders(<HistoryPage />, {
      mockIdeMessenger,
    });
    const sessionElement = await screen.findByText(
      "Session 1",
      {},
      {
        timeout: 3000, // There is a 2000ms timeout before the first call to refreshSessionMetadata is called
      },
    );
    expect(sessionElement).toBeInTheDocument();
  });

  it("keeps a running chat above a more recently completed chat", async () => {
    const messenger = new MockIdeMessenger();
    const store = setupStore({ ideMessenger: messenger });
    const now = Date.now();
    store.dispatch(
      setAllSessionMetadata([
        {
          title: "Older running chat",
          sessionId: "running-session",
          dateCreated: String(now - 10 * 24 * 60 * 60 * 1000),
          dateUpdated: String(now - 10 * 24 * 60 * 60 * 1000),
          workspaceDirectory: "/workspace/app",
        },
        {
          title: "Recent completed chat",
          sessionId: "completed-session",
          dateCreated: String(now - 60 * 1000),
          dateUpdated: String(now - 60 * 1000),
          workspaceDirectory: "/workspace/app",
        },
      ]),
    );
    store.dispatch(
      newSession({
        sessionId: "running-session",
        title: "Older running chat",
        workspaceDirectory: "/workspace/app",
        history: [],
      }),
    );
    const rendered = await renderWithProviders(<HistoryPage />, {
      mockIdeMessenger: messenger,
      store,
    });
    await act(async () => {
      rendered.store.dispatch(setActive());
    });

    expect(
      screen.getByRole("heading", { name: "Running" }),
    ).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Older running chat");
    expect(rows[0]).toHaveAttribute("data-running", "true");
  });
});
