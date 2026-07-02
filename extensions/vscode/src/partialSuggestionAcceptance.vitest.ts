import { describe, expect, it } from "vitest";
import { partialSuggestionCommand } from "./partialSuggestionAcceptance";

describe("partial suggestion acceptance", () => {
  it("maps token, word, and line acceptance to host-native commands", () => {
    expect(partialSuggestionCommand("token")).toContain("acceptNextWord");
    expect(partialSuggestionCommand("word")).toContain("acceptNextWord");
    expect(partialSuggestionCommand("line")).toContain("acceptNextLine");
  });
});
