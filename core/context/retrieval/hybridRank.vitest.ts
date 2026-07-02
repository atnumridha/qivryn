import { describe, expect, it } from "vitest";
import type { Chunk, QivrynConfig } from "../..";
import { assertLocalOnlyRetrieval, rankHybridChunks } from "./hybridRank";

function chunk(filepath: string, signature?: string): Chunk {
  return {
    filepath,
    signature,
    content: filepath,
    startLine: 1,
    endLine: 2,
    digest: filepath,
    index: 0,
  };
}

describe("hybrid retrieval ranking", () => {
  it("fuses semantic, lexical, symbol and Git-history signals", () => {
    const semantic = chunk("src/semantic.ts");
    const lexical = chunk("src/lexical.ts");
    const symbol = chunk("src/auth.ts", "validateSession");
    const ranked = rankHybridChunks(
      "validate session",
      {
        semantic: [semantic],
        lexical: [lexical],
        symbols: [symbol],
        recent: [],
      },
      ["src/auth.ts"],
      3,
    );
    expect(ranked[0]).toBe(symbol);
    expect(ranked).toEqual(expect.arrayContaining([semantic, lexical]));
  });

  it("blocks remote providers in local-only mode", () => {
    const config = {
      experimental: { localOnly: true },
      selectedModelByRole: {
        chat: { providerName: "openai", apiBase: "https://api.openai.com" },
      },
    } as unknown as QivrynConfig;
    expect(() => assertLocalOnlyRetrieval(config)).toThrow(
      /blocked remote chat/,
    );
    (
      config.selectedModelByRole.chat as unknown as { apiBase: string }
    ).apiBase = "http://127.0.0.1:11434";
    expect(() => assertLocalOnlyRetrieval(config)).not.toThrow();
  });
});
