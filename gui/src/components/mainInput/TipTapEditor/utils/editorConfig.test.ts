import { describe, expect, it } from "vitest";
import { CodeBlock, PromptBlock } from "../extensions";
import { hasValidEditorContent } from "./editorConfig";

describe("hasValidEditorContent", () => {
  it("accepts image-only composer content", () => {
    expect(
      hasValidEditorContent({
        type: "doc",
        content: [{ type: "image", attrs: { src: "data:image/png;base64,a" } }],
      }),
    ).toBe(true);
  });

  it.each([CodeBlock.name, PromptBlock.name])(
    "accepts a %s attachment without text",
    (type) => {
      expect(
        hasValidEditorContent({
          type: "doc",
          content: [{ type }],
        }),
      ).toBe(true);
    },
  );

  it("rejects empty and whitespace-only paragraphs", () => {
    expect(
      hasValidEditorContent({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: " " }] },
        ],
      }),
    ).toBe(false);
  });
});
