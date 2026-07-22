import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { Provider } from "react-redux";
import { expect, test } from "vitest";
import { MockIdeMessenger } from "../../context/MockIdeMessenger";
import {
  newSession,
  setAllSessionMetadata,
} from "../../redux/slices/sessionSlice";
import { setTabs } from "../../redux/slices/tabsSlice";
import { setupStore } from "../../redux/store";
import { TabBar } from "./TabBar";

test("creates only one tab from an empty tab state under StrictMode", async () => {
  const store = setupStore({ ideMessenger: new MockIdeMessenger() });
  store.dispatch(setTabs([]));

  render(
    <React.StrictMode>
      <Provider store={store}>
        <TabBar />
      </Provider>
    </React.StrictMode>,
  );

  await waitFor(() => {
    expect(store.getState().tabs.tabs).toHaveLength(1);
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(store.getState().tabs.tabs).toHaveLength(1);
});

test("rehydrates an active persisted session tab with no transcript", async () => {
  const messenger = new MockIdeMessenger();
  messenger.responseHandlers["history/load"] = async ({ id }) => ({
    sessionId: id,
    title: "Saved Session",
    workspaceDirectory: "/workspace/app",
    history: [
      {
        contextItems: [],
        message: {
          id: "message-1",
          role: "user",
          content: "Saved prompt",
        },
      },
    ],
  });
  const store = setupStore({ ideMessenger: messenger });
  store.dispatch(
    newSession({
      sessionId: "saved-session",
      title: "Saved Session",
      workspaceDirectory: "/workspace/app",
      history: [],
    }),
  );
  store.dispatch(
    setAllSessionMetadata([
      {
        sessionId: "saved-session",
        title: "Saved Session",
        workspaceDirectory: "/workspace/app",
        dateCreated: "2026-07-22T00:00:00.000Z",
        dateUpdated: "2026-07-22T00:01:00.000Z",
        messageCount: 1,
      },
    ]),
  );
  store.dispatch(
    setTabs([
      {
        id: "saved-tab",
        title: "Saved Session",
        isActive: true,
        sessionId: "saved-session",
      },
      {
        id: "other-tab",
        title: "Other Session",
        isActive: false,
        sessionId: "other-session",
      },
    ]),
  );
  const user = userEvent.setup();

  render(
    <Provider store={store}>
      <TabBar />
    </Provider>,
  );

  await user.click(screen.getByRole("tab", { name: "Saved Session" }));

  await waitFor(() => {
    expect(store.getState().session.history[0]?.message.content).toBe(
      "Saved prompt",
    );
  });
});
