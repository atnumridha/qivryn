import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";
import { renderWithProviders } from "../../util/test/render";
import {
  compactModelTriggerName,
  ModeSelect,
  scrollTopToReveal,
} from "./ModeSelect";

describe("ModeSelect", () => {
  it.each([
    ["Codex: GPT-5.5", "5.5"],
    ["Codex: GPT-5.6-Sol", "5.6-Sol"],
    ["GPT-5.4-Mini", "5.4-Mini"],
    ["Claude Sonnet", "Claude Sonnet"],
  ])("formats the compact model trigger label %s", (label, expected) => {
    expect(compactModelTriggerName(label)).toBe(expected);
  });

  it("opens the durable background task workspace", async () => {
    const { user } = await renderWithProviders(
      <Routes>
        <Route path="/" element={<ModeSelect />} />
        <Route path="/agents" element={<div>Background workspace</div>} />
      </Routes>,
    );

    await user.click(
      screen.getByRole("button", { name: "Agents mode dropdown" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: /Background tasks/ }),
    );

    expect(await screen.findByText("Background workspace")).toBeVisible();
  });

  it.each([
    {
      name: "scrolls down when the nested menu extends below the viewport",
      input: {
        currentScrollTop: 24,
        viewportTop: 100,
        viewportBottom: 400,
        targetTop: 350,
        targetBottom: 460,
      },
      expected: 88,
    },
    {
      name: "scrolls up when the nested menu extends above the viewport",
      input: {
        currentScrollTop: 80,
        viewportTop: 100,
        viewportBottom: 400,
        targetTop: 70,
        targetBottom: 180,
      },
      expected: 46,
    },
    {
      name: "keeps the current position when the nested menu is visible",
      input: {
        currentScrollTop: 42,
        viewportTop: 100,
        viewportBottom: 400,
        targetTop: 150,
        targetBottom: 350,
      },
      expected: 42,
    },
  ])("$name", ({ input, expected }) => {
    expect(scrollTopToReveal(input)).toBe(expected);
  });
});
