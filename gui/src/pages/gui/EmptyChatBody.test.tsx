import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../util/test/render";
import { EmptyChatBody } from "./EmptyChatBody";

describe("EmptyChatBody", () => {
  it("never renders provider credentials in the conversation surface", async () => {
    localStorage.setItem("onboardingStatus", JSON.stringify("Started"));
    await renderWithProviders(<EmptyChatBody />);
    expect(
      screen.queryByPlaceholderText("Enter your OpenAI API key"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-card")).not.toBeInTheDocument();
  });
});
