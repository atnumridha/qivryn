export type PartialSuggestionUnit = "token" | "word" | "line";

export function partialSuggestionCommand(unit: PartialSuggestionUnit): string {
  return unit === "line"
    ? "editor.action.inlineSuggest.acceptNextLine"
    : "editor.action.inlineSuggest.acceptNextWord";
}
