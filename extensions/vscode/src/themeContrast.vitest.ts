import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function luminance(hex: string): number {
  const rgb = hex
    .slice(1)
    .match(/../g)!
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) =>
      value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}
function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("Continue themes", () => {
  for (const name of [
    "continue-dark",
    "continue-midnight",
    "continue-light",
    "continue-high-contrast",
  ]) {
    it(`${name} meets text contrast gates`, () => {
      const theme = JSON.parse(
        readFileSync(
          path.join(__dirname, "..", "themes", `${name}.json`),
          "utf8",
        ),
      );
      expect(
        contrast(
          theme.colors["editor.foreground"],
          theme.colors["editor.background"],
        ),
      ).toBeGreaterThanOrEqual(7);
      expect(
        contrast(
          theme.colors["input.foreground"],
          theme.colors["input.background"],
        ),
      ).toBeGreaterThanOrEqual(7);
      expect(
        contrast(
          theme.colors["button.foreground"],
          theme.colors["button.background"],
        ),
      ).toBeGreaterThanOrEqual(4.5);
    });
  }
});
