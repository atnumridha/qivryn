import { act, screen, waitFor } from "@testing-library/react";
import { newSession } from "../../../redux/slices/sessionSlice";
import { addAndSelectMockLlm } from "../../../util/test/config";
import { renderWithProviders } from "../../../util/test/render";
import {
  getElementByTestId,
  getElementByText,
  getMainEditor,
  sendInputWithMockedResponse,
} from "../../../util/test/utils";
import { Chat } from "../Chat";

test("should render input box", async () => {
  await renderWithProviders(<Chat />);
  await getElementByTestId("qivryn-input-box-main-editor-input");
});

test("should be able to toggle modes", async () => {
  const { store } = await renderWithProviders(<Chat />);
  await getElementByText("Agents");

  // Simulate cmd+. keyboard shortcut to toggle modes
  await act(async () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: ".",
        metaKey: true, // cmd key on Mac
      }),
    );
    await Promise.resolve();
  });

  expect(store.getState().session.mode).toBe("chat");
});

test("should send a message and receive a response", async () => {
  const { ideMessenger, store } = await renderWithProviders(<Chat />);

  // First add and select the mock LLM
  await act(async () => {
    addAndSelectMockLlm(store, ideMessenger);
  });

  const CONTENT = "Expected response";
  const INPUT = "User input";

  await sendInputWithMockedResponse(ideMessenger, INPUT, [
    { role: "assistant", content: CONTENT },
  ]);

  await getElementByText(CONTENT);
});

test("surfaces a recoverable error instead of ignoring submit while chat model is loading", async () => {
  const { store } = await renderWithProviders(<Chat />);
  const editor = await getMainEditor();
  const sendButton = await getElementByTestId("submit-input-button");

  await act(async () => {
    editor.commands.insertContent("Hello World");
  });

  await act(async () => {
    sendButton.click();
  });

  await waitFor(() => {
    expect(store.getState().ui.showDialog).toBe(true);
    expect((store.getState().ui.dialogMessage as any)?.props?.error).toEqual(
      expect.objectContaining({
        message: "No chat model selected",
      }),
    );
  });
});

test("keyboard enter also submits into the recoverable error path while chat model is loading", async () => {
  const { store, user } = await renderWithProviders(<Chat />);
  const editor = await getMainEditor();

  await act(async () => {
    editor.commands.insertContent("Hello from keyboard");
    editor.commands.focus();
  });

  await user.keyboard("{Enter}");

  await waitFor(() => {
    expect(store.getState().ui.showDialog).toBe(true);
    expect((store.getState().ui.dialogMessage as any)?.props?.error).toEqual(
      expect.objectContaining({
        message: "No chat model selected",
      }),
    );
  });
});

test("bounds initial rendering for large sessions and loads older items on demand", async () => {
  const { store, user } = await renderWithProviders(<Chat />);
  const history = Array.from({ length: 120 }, (_, index) => ({
    contextItems: [],
    message: {
      id: `assistant-${index + 1}`,
      role: "assistant" as const,
      content: `Large session message ${index + 1}`,
    },
  }));

  await act(async () => {
    store.dispatch(
      newSession({
        sessionId: "large-session",
        title: "Large session",
        workspaceDirectory: "/workspace/app",
        history,
      }),
    );
  });

  expect(screen.queryByText("Large session message 1")).not.toBeInTheDocument();
  expect(screen.getByText("Large session message 120")).toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Show 60 earlier items" }),
  );
  expect(screen.getByText("Large session message 1")).toBeInTheDocument();
});
