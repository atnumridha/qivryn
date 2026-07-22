import { screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { MockIdeMessenger } from "../context/MockIdeMessenger";
import { setupStore } from "../redux/store";
import { renderWithProviders } from "../util/test/render";
import Layout from "./Layout";

test("does not create another session when New is clicked on an empty standalone chat", async () => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1024,
  });

  const ideMessenger = new MockIdeMessenger();
  const store = setupStore({ ideMessenger });
  const initialSessionId = store.getState().session.id;
  const { user } = await renderWithProviders(<Layout />, {
    store,
    mockIdeMessenger: ideMessenger,
  });

  await user.click(screen.getByRole("button", { name: "New chat" }));

  expect(store.getState().session.id).toBe(initialSessionId);
  expect(store.getState().session.history).toHaveLength(0);
});
