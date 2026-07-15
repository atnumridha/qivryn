import type { AssistantUnrolled, RuleObject } from "@qivryn/config-yaml";

const LEGACY_DEFAULT_RULES = new Set([
  "You are a precise software engineering assistant. Think carefully before making changes.",
  "Prefer minimal, targeted edits. Always explain your reasoning concisely.",
  "When using tools, be explicit about which file and line you are editing.",
]);

type ConfigRule = string | RuleObject | null | undefined;

export function removeLegacyDefaultRules(
  config: AssistantUnrolled,
): AssistantUnrolled {
  if (!config.rules) return config;

  const rules = config.rules.filter(
    (rule: ConfigRule) =>
      typeof rule !== "string" || !LEGACY_DEFAULT_RULES.has(rule),
  );

  return {
    ...config,
    rules,
  };
}
