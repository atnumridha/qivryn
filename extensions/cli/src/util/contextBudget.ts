export const MAX_TOOL_RESULT_CHARS = 48_000;
export const MAX_TOOL_ARGUMENT_CHARS = 24_000;

function truncationMarker(originalChars: number): string {
  return `\n\n[Context compacted: ${originalChars.toLocaleString()} original chars; inspect the workspace for omitted details.]\n\n`;
}

/**
 * Keep durable agent history bounded without hiding that content was omitted.
 * The tail is retained because command failures and summaries are commonly
 * written after the bulk output.
 */
export function truncateTextForContext(
  value: string,
  maxChars = MAX_TOOL_RESULT_CHARS,
): string {
  if (value.length <= maxChars) return value;

  const marker = truncationMarker(value.length);
  const available = Math.max(0, maxChars - marker.length);
  const headChars = Math.ceil(available * 0.7);
  const tailChars = Math.max(0, available - headChars);
  return `${value.slice(0, headChars)}${marker}${
    tailChars > 0 ? value.slice(-tailChars) : ""
  }`;
}

/**
 * Tool-call arguments must remain valid JSON when replayed to chat APIs. Large
 * edits and shell payloads are therefore represented by a compact JSON record
 * once execution has completed.
 */
export function compactToolArgumentsForContext(
  value: string,
  maxChars = MAX_TOOL_ARGUMENT_CHARS,
): string {
  if (value.length <= maxChars) return value;

  let excerptBudget = Math.max(0, maxChars - 320);
  while (true) {
    const headChars = Math.ceil(excerptBudget * 0.65);
    const tailChars = Math.max(0, excerptBudget - headChars);
    const compacted = JSON.stringify({
      context_compacted: true,
      original_characters: value.length,
      note: "Completed tool arguments were compacted. Inspect the workspace for the authoritative result.",
      beginning: value.slice(0, headChars),
      ending: tailChars > 0 ? value.slice(-tailChars) : "",
    });
    if (compacted.length <= maxChars || excerptBudget === 0) return compacted;
    excerptBudget = Math.max(0, Math.floor(excerptBudget * 0.75));
  }
}

export function compactParsedToolArgumentsForContext(
  value: unknown,
  maxChars = MAX_TOOL_ARGUMENT_CHARS,
): unknown {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return value;
  }
  if (!serialized || serialized.length <= maxChars) return value;
  return JSON.parse(compactToolArgumentsForContext(serialized, maxChars));
}
