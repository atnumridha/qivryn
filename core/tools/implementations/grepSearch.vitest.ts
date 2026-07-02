import { describe, expect, it, vi } from "vitest";
import { grepSearchImpl } from "./grepSearch";

describe("grepSearchImpl precision options", () => {
  it("forwards Cursor-compatible search controls to the IDE", async () => {
    const getSearchResults = vi.fn().mockResolvedValue("./src/a.ts\n1:match");
    await grepSearchImpl(
      {
        query: "match",
        path: "src",
        glob: "**/*.ts",
        output_mode: "files_with_matches",
        case_insensitive: false,
        fixed_strings: true,
        type: "ts",
        head_limit: 25,
        multiline: true,
        sort: "path",
        sort_ascending: false,
        offset: 2,
      },
      { ide: { getSearchResults } } as never,
    );

    expect(getSearchResults).toHaveBeenCalledWith("match", 25, {
      path: "src",
      glob: "**/*.ts",
      outputMode: "files_with_matches",
      contextBefore: undefined,
      contextAfter: undefined,
      context: undefined,
      caseInsensitive: false,
      fixedStrings: true,
      fileType: "ts",
      multiline: true,
      sort: "path",
      sortAscending: false,
      offset: 2,
    });
  });
});
