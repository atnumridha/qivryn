import { createHash } from "node:crypto";

export const MODEL_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MODEL_TOOL_NAME_MAX_LENGTH = 64;
const MODEL_TOOL_NAME_HASH_LENGTH = 8;

export function isValidModelToolName(name: string): boolean {
  return MODEL_TOOL_NAME_PATTERN.test(name);
}

export function toModelToolName(rawName: string): string {
  const trimmed = rawName.trim();
  const normalized =
    trimmed
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "") || "tool";

  if (
    trimmed === normalized &&
    normalized.length <= MODEL_TOOL_NAME_MAX_LENGTH &&
    isValidModelToolName(normalized)
  ) {
    return normalized;
  }

  const hash = createHash("sha256")
    .update(rawName)
    .digest("hex")
    .slice(0, MODEL_TOOL_NAME_HASH_LENGTH);
  const maxPrefixLength =
    MODEL_TOOL_NAME_MAX_LENGTH - MODEL_TOOL_NAME_HASH_LENGTH - 1;
  const prefix =
    normalized.slice(0, maxPrefixLength).replace(/[_-]+$/g, "") || "tool";

  return `${prefix}_${hash}`;
}
