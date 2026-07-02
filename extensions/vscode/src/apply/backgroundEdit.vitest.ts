import { describe, expect, it } from "vitest";
import type { DiffLine } from "core";
import { materializeBackgroundEdit } from "./backgroundEdit";

async function* diff(lines: DiffLine[]) {
  yield* lines;
}

describe("materializeBackgroundEdit", () => {
  it("keeps same/new lines and removes old lines", async () => {
    const result = await materializeBackgroundEdit(
      "one\ntwo\n",
      diff([
        { type: "same", line: "one" },
        { type: "old", line: "two" },
        { type: "new", line: "three" },
      ]),
    );

    expect(result).toEqual({ content: "one\nthree\n", changedLines: 2 });
  });

  it("preserves CRLF files", async () => {
    const result = await materializeBackgroundEdit(
      "one\r\ntwo\r\n",
      diff([
        { type: "same", line: "one" },
        { type: "same", line: "two" },
      ]),
    );

    expect(result.content).toBe("one\r\ntwo\r\n");
    expect(result.changedLines).toBe(0);
  });
});
