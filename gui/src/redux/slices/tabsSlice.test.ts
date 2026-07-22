import { expect, test } from "vitest";
import tabsReducer, { Tab, handleSessionChange } from "./tabsSlice";

const applySessionChange = (
  tabs: Tab[],
  payload: Parameters<typeof handleSessionChange>[0],
) => tabsReducer({ tabs }, handleSessionChange(payload)).tabs;

test("assigns the active empty tab and removes sibling empty tabs", () => {
  const tabs = applySessionChange(
    [
      { id: "empty-1", title: "New Session", isActive: false },
      { id: "empty-2", title: "New Session", isActive: true },
    ],
    {
      currentSessionId: "session-1",
      currentSessionTitle: "New Session",
    },
  );

  expect(tabs).toEqual([
    {
      id: "empty-2",
      title: "New Session",
      isActive: true,
      sessionId: "session-1",
    },
  ]);
});

test("collapses duplicate tabs for the current session", () => {
  const tabs = applySessionChange(
    [
      {
        id: "duplicate-current",
        title: "New Session",
        isActive: false,
        sessionId: "session-1",
      },
      {
        id: "active-current",
        title: "New Session",
        isActive: true,
        sessionId: "session-1",
      },
      { id: "empty", title: "New Session", isActive: false },
      {
        id: "other",
        title: "Existing Session",
        isActive: false,
        sessionId: "session-2",
      },
    ],
    {
      currentSessionId: "session-1",
      currentSessionTitle: "Renamed Session",
    },
  );

  expect(tabs).toEqual([
    {
      id: "active-current",
      title: "Renamed Session",
      isActive: true,
      sessionId: "session-1",
    },
    {
      id: "other",
      title: "Existing Session",
      isActive: false,
      sessionId: "session-2",
    },
  ]);
});

test("activates an existing session tab and removes stale empty tabs", () => {
  const tabs = applySessionChange(
    [
      {
        id: "old-active",
        title: "Old Session",
        isActive: true,
        sessionId: "session-old",
      },
      {
        id: "target",
        title: "New Session",
        isActive: false,
        sessionId: "session-1",
      },
      { id: "empty", title: "New Session", isActive: false },
    ],
    {
      currentSessionId: "session-1",
      currentSessionTitle: "Target Session",
    },
  );

  expect(tabs).toEqual([
    {
      id: "old-active",
      title: "Old Session",
      isActive: false,
      sessionId: "session-old",
    },
    {
      id: "target",
      title: "Target Session",
      isActive: true,
      sessionId: "session-1",
    },
  ]);
});

test("creates one new session tab without carrying stale empty tabs", () => {
  const tabs = applySessionChange(
    [
      {
        id: "old-active",
        title: "Old Session",
        isActive: true,
        sessionId: "session-old",
      },
      { id: "empty", title: "New Session", isActive: false },
    ],
    {
      currentSessionId: "session-1",
      currentSessionTitle: "New Session",
      newTabId: "new-tab",
    },
  );

  expect(tabs).toEqual([
    {
      id: "old-active",
      title: "Old Session",
      isActive: false,
      sessionId: "session-old",
    },
    {
      id: "new-tab",
      title: "New Session",
      isActive: true,
      sessionId: "session-1",
    },
  ]);
});
