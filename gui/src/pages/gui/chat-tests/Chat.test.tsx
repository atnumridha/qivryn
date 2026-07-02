import { act, screen } from "@testing-library/react";
import { newSession } from "../../../redux/slices/sessionSlice";
import { addAndSelectMockLlm } from "../../../util/test/config";
import { renderWithProviders } from "../../../util/test/render";
import {
  getElementByTestId,
  getElementByText,
  sendInputWithMockedResponse,
} from "../../../util/test/utils";
import { Chat } from "../Chat";

test("should render input box", async () => {
  await renderWithProviders(<Chat />);
  await getElementByTestId("continue-input-box-main-editor-input");
});

test("should be able to toggle modes", async () => {
  await renderWithProviders(<Chat />);
  await getElementByText("Agent");

  // Simulate cmd+. keyboard shortcut to toggle modes
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: ".",
        metaKey: true, // cmd key on Mac
      }),
    );
  });

  // Check that it switched to Chat mode
  await getElementByText("Chat");

  act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: ".",
        metaKey: true, // cmd key on Mac
      }),
    );
  });

  // Check that it switched to Plan mode
  await getElementByText("Plan");

  act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: ".",
        metaKey: true, // cmd key on Mac
      }),
    );
  });

  await getElementByText("Agent");
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
