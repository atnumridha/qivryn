import { screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { MockIdeMessenger } from "../../context/MockIdeMessenger";
import { renderWithProviders } from "../../util/test/render";
import GUI from ".";

afterEach(() => {
  delete (window as any).isFullScreen;
});

test("opens chat full screen in one click", async () => {
  const messenger = new MockIdeMessenger();
  const request = vi.spyOn(messenger, "request");
  const { user } = await renderWithProviders(<GUI />, {
    mockIdeMessenger: messenger,
  });

  await user.click(screen.getByRole("button", { name: "Open full screen" }));
  expect(request).toHaveBeenCalledWith("toggleFullScreen", {
    newWindow: true,
    path: "/",
  });
});

test("offers a clickable standalone reload that releases stuck edit state", async () => {
  (window as any).isFullScreen = true;
  const messenger = new MockIdeMessenger();
  const post = vi.spyOn(messenger, "post");
  const { user } = await renderWithProviders(<GUI />, {
    mockIdeMessenger: messenger,
  });

  await user.click(screen.getByRole("button", { name: "Reload chat" }));
  expect(post).toHaveBeenCalledWith("reloadAgentWindow", { path: "/" });
});

test("uses the full standalone window for chat instead of the history sidebar", async () => {
  (window as any).isFullScreen = true;
  const { user, store } = await renderWithProviders(<GUI />);
  const previousSessionId = store.getState().session.id;

  expect(screen.queryByPlaceholderText("Search past sessions")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Agents mode dropdown" }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "New chat" })).toBeVisible();

  await user.click(screen.getByRole("button", { name: "New chat" }));
  expect(store.getState().session.id).not.toBe(previousSessionId);
});

test("keeps tool permissions and skills inside the primary mode dropdown", async () => {
  const { user } = await renderWithProviders(<GUI />);
  expect(
    screen.getAllByRole("button", { name: "Agents mode dropdown" }),
  ).toHaveLength(1);
  expect(screen.queryByRole("group", { name: "Agent access mode" })).toBeNull();
  expect(screen.queryByRole("group", { name: "Skill choices" })).toBeNull();

  await user.click(
    screen.getByRole("button", { name: "Agents mode dropdown" }),
  );

  expect(screen.getByRole("button", { name: "Skills dropdown" })).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Autonomous dropdown" }),
  ).toBeVisible();
  expect(screen.queryByRole("group", { name: "Agent access mode" })).toBeNull();
  expect(screen.queryByRole("group", { name: "Skill choices" })).toBeNull();

  await user.click(screen.getByRole("button", { name: "Skills dropdown" }));
  expect(screen.getByRole("group", { name: "Skill choices" })).toBeVisible();

  await user.click(screen.getByRole("button", { name: "Autonomous dropdown" }));
  expect(
    screen.getByRole("group", { name: "Agent access mode" }),
  ).toBeVisible();
  expect(screen.queryByRole("group", { name: "Skill choices" })).toBeNull();
});

test("keeps config controls as a compact chat header icon popover", async () => {
  const { user } = await renderWithProviders(<GUI />);

  expect(screen.getByTestId("qivryn-chat-header")).toHaveClass(
    "relative",
    "z-[120]",
    "overflow-visible",
  );
  expect(screen.getByTestId("qivryn-chat-composer-layer")).toHaveClass(
    "relative",
    "z-0",
  );
  expect(screen.getAllByRole("button", { name: "Open settings" })).toHaveLength(
    1,
  );
  expect(screen.getByRole("button", { name: "Open settings" })).toBeVisible();
  expect(screen.queryByText("CONFIG")).toBeNull();
  expect(screen.queryByText("Config")).toBeNull();
  expect(screen.queryByRole("button", { name: "Configure rules" })).toBeNull();

  await user.click(screen.getByRole("button", { name: "Open settings" }));

  expect(screen.queryByText("CONFIG")).toBeNull();
  expect(screen.queryByRole("button", { name: "Configure rules" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Configure tools" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Configure models" })).toBeNull();
});
