import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { renderWithProviders } from "../../util/test/render";
import GUI from ".";

afterEach(() => {
  delete (window as any).isFullScreen;
});

test("does not duplicate native view-toolbar actions inside chat", async () => {
  await renderWithProviders(<GUI />);

  expect(screen.queryByTestId("qivryn-chat-header")).toBeNull();
  expect(screen.queryByRole("button", { name: "Open settings" })).toBeNull();
  expect(screen.queryByRole("button", { name: "New chat" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Reload chat" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Open full screen" })).toBeNull();
  expect(screen.getByTestId("qivryn-chat-composer-layer")).toBeVisible();
});

test("attaches every dropped file to the composer", async () => {
  await renderWithProviders(<GUI />);
  const composer = screen.getByTestId("editor-input-main");

  const files = [
    new File(["alpha"], "alpha.txt", { type: "text/plain" }),
    new File(["beta"], "beta.json", { type: "application/json" }),
  ];
  fireEvent.drop(composer, {
    dataTransfer: {
      files,
      getData: () => "",
    },
  });

  await waitFor(() => {
    expect(screen.getByText("alpha.txt")).toBeVisible();
    expect(screen.getByText("beta.json")).toBeVisible();
  });
});

test("uses the full standalone window for chat instead of the history sidebar", async () => {
  (window as any).isFullScreen = true;
  await renderWithProviders(<GUI />);

  expect(screen.queryByPlaceholderText("Search past sessions")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Agents mode dropdown" }),
  ).toBeVisible();
  expect(screen.queryByRole("button", { name: "New chat" })).toBeNull();
  expect(screen.queryByTestId("qivryn-chat-header")).toBeNull();
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
