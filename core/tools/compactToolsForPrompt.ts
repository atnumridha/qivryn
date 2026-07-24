import { Tool } from "..";

const MAX_TOOL_DESCRIPTION_LENGTH = 96;
const MAX_PARAMETER_DESCRIPTION_LENGTH = 80;
const MAX_SYSTEM_MESSAGE_PREFIX_LENGTH = 140;

function compactText(value: string | undefined, maxLength: number): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function compactSchemaDescriptions(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => compactSchemaDescriptions(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] =
      key === "description" && typeof child === "string"
        ? compactText(child, MAX_PARAMETER_DESCRIPTION_LENGTH)
        : compactSchemaDescriptions(child);
  }
  return result;
}

export function compactToolsForPrompt(
  tools: Tool[] | undefined,
): Tool[] | undefined {
  if (!tools?.length) {
    return undefined;
  }

  return tools.map((tool) => ({
    ...tool,
    function: {
      ...tool.function,
      description: compactText(
        tool.function.description,
        MAX_TOOL_DESCRIPTION_LENGTH,
      ),
      parameters: compactSchemaDescriptions(
        tool.function.parameters,
      ) as Tool["function"]["parameters"],
    },
    systemMessageDescription: tool.systemMessageDescription
      ? {
          ...tool.systemMessageDescription,
          prefix: compactText(
            tool.systemMessageDescription.prefix,
            MAX_SYSTEM_MESSAGE_PREFIX_LENGTH,
          ),
        }
      : undefined,
  }));
}
