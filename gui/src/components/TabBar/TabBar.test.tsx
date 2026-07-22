import { render, waitFor } from "@testing-library/react";
import React from "react";
import { Provider } from "react-redux";
import { expect, test } from "vitest";
import { MockIdeMessenger } from "../../context/MockIdeMessenger";
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
