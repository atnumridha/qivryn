import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function parseColor(hex: string): [number, number, number, number] {
  const [r, g, b, a = "ff"] = hex.slice(1).match(/../g)!;
  return [r, g, b, a].map((value) => Number.parseInt(value, 16) / 255) as [
    number,
    number,
    number,
    number,
  ];
}

function blend(foreground: string, background: string): string {
  const [r, g, b, a] = parseColor(foreground);
  if (a >= 1) {
    return foreground.slice(0, 7);
  }
  const [br, bg, bb] = parseColor(background);
  return `#${[r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)]
    .map((value) =>
      Math.round(value * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function luminance(hex: string): number {
  const rgb = parseColor(hex)
    .slice(0, 3)
    .map((value) =>
      value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}
function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("Qivryn themes", () => {
  for (const name of [
    "qivryn-dark",
    "qivryn-midnight",
    "qivryn-light",
    "qivryn-high-contrast",
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
      ).toBeGreaterThanOrEqual(name === "qivryn-high-contrast" ? 7 : 4.5);
      expect(
        contrast(
          theme.colors["input.foreground"],
          blend(
            theme.colors["input.background"],
            theme.colors["editor.background"],
          ),
        ),
      ).toBeGreaterThanOrEqual(7);
      expect(
        contrast(
          theme.colors["button.foreground"],
          blend(
            theme.colors["button.background"],
            theme.colors["editor.background"],
          ),
        ),
      ).toBeGreaterThanOrEqual(3);
    });
  }
});
