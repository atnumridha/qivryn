import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { renderWithProviders } from "../../util/test/render";
import GUI from ".";

afterEach(() => {
  delete (window as any).isFullScreen;
  delete document.body.dataset.qivrynFullscreen;
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1024,
  });
});

test("keeps Qivryn actions visible inside a standalone chat", async () => {
  await renderWithProviders(<GUI />);

  expect(screen.queryByPlaceholderText("Search sessions")).toBeNull();
  expect(screen.queryByRole("button", { name: "Clear history" })).toBeNull();
  expect(screen.queryByTestId("qivryn-chat-header")).toBeNull();
  expect(screen.getByRole("button", { name: "Open settings" })).toBeVisible();
  expect(screen.getByRole("button", { name: "New chat" })).toBeVisible();
  expect(screen.getByRole("button", { name: "View history" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Reload chat" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Open full screen" })).toBeNull();
  expect(screen.getByTestId("qivryn-chat-composer-layer")).toBeVisible();
});

test("uses one shared rail for the transcript and composer", async () => {
  await renderWithProviders(<GUI />);

  expect(document.querySelector(".qivryn-chat-route")).not.toBeNull();
  expect(screen.getByTestId("qivryn-thread-rail")).toHaveClass(
    "qivryn-thread-rail",
  );
  expect(screen.getByTestId("qivryn-composer-rail")).toHaveClass(
    "qivryn-thread-rail",
  );
});

test("attaches files dropped anywhere in the Qivryn window", async () => {
  await renderWithProviders(<GUI />);
  const files = [
    new File(["alpha"], "alpha.txt", { type: "text/plain" }),
    new File(["beta"], "beta.json", { type: "application/json" }),
  ];
  const dataTransfer = {
    files,
    types: ["Files"],
    dropEffect: "none",
    getData: () => "",
  };

  fireEvent.dragEnter(screen.getByTestId("qivryn-thread-rail"), {
    dataTransfer,
  });
  expect(screen.getByTestId("qivryn-workspace-drop-overlay")).toBeVisible();

  fireEvent.drop(screen.getByTestId("qivryn-thread-rail"), {
    dataTransfer,
  });

  await waitFor(() => {
    expect(screen.queryByTestId("qivryn-workspace-drop-overlay")).toBeNull();
    expect(screen.getByText("alpha.txt")).toBeVisible();
    expect(screen.getByText("beta.json")).toBeVisible();
  });
});

test("admits protected drags before their file metadata is readable", async () => {
  await renderWithProviders(<GUI />);
  const protectedTransfer = {
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [],
    dropEffect: "none",
    getData: () => "",
  };
  const dragOver = fireEvent.dragOver(
    screen.getByTestId("qivryn-thread-rail"),
    { dataTransfer: protectedTransfer },
  );

  expect(dragOver).toBe(false);
  expect(screen.getByTestId("qivryn-workspace-drop-overlay")).toBeVisible();
});

test("attaches URI string items after a protected dragover", async () => {
  await renderWithProviders(<GUI />);
  const dataTransfer = {
    files: [] as unknown as FileList,
    items: [
      {
        kind: "string",
        type: "resourceurls",
        getAsString: (callback: (value: string) => void) =>
          callback(JSON.stringify(["file:///workspace/async-item.ts"])),
      },
    ] as unknown as DataTransferItemList,
    types: [],
    dropEffect: "none",
    getData: () => "",
  };

  fireEvent.dragOver(screen.getByTestId("qivryn-thread-rail"), {
    dataTransfer: {
      files: [] as unknown as FileList,
      items: [] as unknown as DataTransferItemList,
      types: [],
      dropEffect: "none",
      getData: () => "",
    },
  });
  fireEvent.drop(screen.getByTestId("qivryn-thread-rail"), {
    dataTransfer,
  });

  await waitFor(() => {
    expect(screen.getByText("Mock File")).toBeVisible();
  });
});

test("attaches file items when the webview omits DataTransfer.files", async () => {
  await renderWithProviders(<GUI />);
  const file = new File(["item payload"], "item-only.txt", {
    type: "text/plain",
  });
  const dataTransfer = {
    files: [] as unknown as FileList,
    items: [
      {
        kind: "file",
        type: "text/plain",
        getAsFile: () => file,
      },
    ] as unknown as DataTransferItemList,
    types: [],
    dropEffect: "none",
    getData: () => "",
  };

  fireEvent.dragEnter(screen.getByTestId("qivryn-chat-composer-layer"), {
    dataTransfer,
  });
  expect(screen.getByTestId("qivryn-workspace-drop-overlay")).toBeVisible();

  fireEvent.drop(screen.getByTestId("qivryn-chat-composer-layer"), {
    dataTransfer,
  });

  await waitFor(() => {
    expect(screen.getByText("item-only.txt")).toBeVisible();
  });
});

test("uses the full standalone window for chat instead of the history sidebar", async () => {
  (window as any).isFullScreen = true;
  await renderWithProviders(<GUI />);

  expect(screen.queryByPlaceholderText("Search sessions")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Agents mode dropdown" }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "New chat" })).toBeVisible();
  expect(screen.queryByTestId("qivryn-chat-header")).toBeNull();
  expect(document.querySelector(".qivryn-chat-route")).toHaveClass(
    "qivryn-standalone",
  );
});

test("uses the host fullscreen marker when the window flag is unavailable", async () => {
  document.body.dataset.qivrynFullscreen = "true";
  await renderWithProviders(<GUI />);

  expect(screen.queryByPlaceholderText("Search sessions")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Agents mode dropdown" }),
  ).toBeVisible();
});

test("uses the standalone layout for a wide maximized extension view", async () => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1280,
  });

  await renderWithProviders(<GUI />);

  expect(document.querySelector(".qivryn-chat-route")).toHaveClass(
    "qivryn-standalone",
  );
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
