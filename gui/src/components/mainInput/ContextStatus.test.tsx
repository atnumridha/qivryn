import { act, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { MockIdeMessenger } from "../../context/MockIdeMessenger";
import { updateConfig } from "../../redux/slices/configSlice";
import {
  newSession,
  setCompactionLoading,
  setContextUsage,
} from "../../redux/slices/sessionSlice";
import { renderWithProviders } from "../../util/test/render";
import ConversationSummary from "../StepContainer/ConversationSummary";
import ContextStatus from "./ContextStatus";

const historyItem = {
  message: { id: "message-1", role: "user" as const, content: "Hello" },
  contextItems: [],
};

async function renderContextUi(ui: ReactElement) {
  const messenger = new MockIdeMessenger();
  const rendered = await renderWithProviders(ui, {
    mockIdeMessenger: messenger,
  });
  act(() => {
    rendered.store.dispatch(
      newSession({
        sessionId: "context-session",
        title: "Context session",
        history: [historyItem],
      } as any),
    );
    rendered.store.dispatch(
      setContextUsage({
        inputTokens: 160_000,
        contextLength: 200_000,
        availableTokens: 180_000,
        model: "gpt-context",
      }),
    );
  });
  return rendered;
}

describe("context usage", () => {
  it("shows used tokens and the full context window throughout a chat", async () => {
    const { store } = await renderContextUi(<ContextStatus />);

    const status = await screen.findByRole("button", {
      name: "Context window: 160,000 of 200,000 tokens used (80%).",
    });
    expect(status).toHaveTextContent("160K / 200K");

    act(() => {
      store.dispatch(setCompactionLoading({ index: 0, loading: true }));
    });
    expect(status).toHaveTextContent("Compacting · 160K / 200K");
  });

  it("includes the token budget in the automatic compaction banner", async () => {
    const { store } = await renderContextUi(
      <ConversationSummary item={historyItem as any} index={0} />,
    );

    act(() => {
      store.dispatch(setCompactionLoading({ index: 0, loading: true }));
    });

    expect(
      await screen.findByText("Automatically compacting context"),
    ).toBeVisible();
    expect(screen.getByText("160K / 200K")).toBeVisible();
  });

  it("updates a stored limit when Codex metadata changes for the same model", async () => {
    const { store } = await renderContextUi(<ContextStatus />);

    act(() => {
      const config = store.getState().config.config;
      store.dispatch(
        updateConfig({
          ...config,
          selectedModelByRole: {
            ...config.selectedModelByRole,
            chat: {
              model: "gpt-5.6-sol",
              title: "GPT-5.6-Sol",
              provider: "chatgpt-codex",
              contextLength: 353_400,
            } as any,
          },
        }),
      );
      store.dispatch(
        setContextUsage({
          inputTokens: 246_000,
          contextLength: 128_000,
          availableTokens: 0,
          model: "gpt-5.6-sol",
        }),
      );
    });

    const status = await screen.findByRole("button", {
      name: "Context window: 246,000 of 353,400 tokens used (70%).",
    });
    expect(status).toHaveTextContent("246K / 353K");
  });
});
