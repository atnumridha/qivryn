import { screen } from "@testing-library/react";
import type { JSONContent } from "@tiptap/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useLocation } from "react-router-dom";
import { renderWithProviders } from "../../util/test/render";
import { EmptyChatBody } from "./EmptyChatBody";

function editorStateText(value: JSONContent | undefined): string {
  return (
    value?.content
      ?.map(
        (block) => block.content?.map((node) => node.text ?? "").join("") ?? "",
      )
      .join("\n") ?? ""
  );
}

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="current-route">
      {location.pathname}
      {location.search}
    </output>
  );
}

describe("EmptyChatBody", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("never renders provider credentials in the conversation surface", async () => {
    localStorage.setItem("onboardingStatus", JSON.stringify("Started"));
    await renderWithProviders(<EmptyChatBody />);
    expect(
      screen.queryByPlaceholderText("Enter your OpenAI API key"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-card")).not.toBeInTheDocument();
  });

  it("routes starter actions into the main composer trigger before the editor is ready", async () => {
    const { store, user } = await renderWithProviders(<EmptyChatBody />);

    await user.click(screen.getByRole("button", { name: "Run in parallel" }));

    expect(
      editorStateText(store.getState().session.mainEditorContentTrigger),
    ).toBe(
      [
        "Run in parallel:",
        "Review the current workspace changes",
        "Run the relevant validation checks",
        "Audit the UI for alignment, spacing, and overflow issues",
      ].join("\n"),
    );
  });

  it("opens the scheduled task screen from the starter action", async () => {
    const { user } = await renderWithProviders(
      <>
        <EmptyChatBody />
        <LocationProbe />
      </>,
    );

    await user.click(screen.getByRole("button", { name: "Schedule" }));

    expect(screen.getByTestId("current-route")).toHaveTextContent(
      "/agents?scheduled=1",
    );
  });
});
