import { RuleMetadata } from "../..";
import { getLastNPathParts } from "../../util/uri";

function cleanMarkdownTitle(title: string): string {
  return title
    .replace(/[`*_#>\-[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateTitle(title: string): string {
  return title.length > 64 ? `${title.slice(0, 61).trim()}...` : title;
}

function getTitleFromRuleContent(
  rule: RuleMetadata & { rule?: string },
): string | undefined {
  const markdown = rule.rule?.trim();
  if (!markdown) {
    return undefined;
  }

  const heading = markdown.match(/^#{1,6}\s+(.+)$/m)?.[1];
  if (heading) {
    return truncateTitle(cleanMarkdownTitle(heading));
  }

  const firstMeaningfulLine = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstMeaningfulLine) {
    return undefined;
  }

  const sentence = firstMeaningfulLine.match(/^(.+?[.!?])\s/)?.[1];
  return truncateTitle(cleanMarkdownTitle(sentence ?? firstMeaningfulLine));
}

export function getRuleDisplayName(rule: RuleMetadata): string {
  if (rule.name) {
    return rule.name;
  }
  if (
    ["rules-block", "colocated-markdown", "agentFile"].includes(rule.source)
  ) {
    const contentTitle = getTitleFromRuleContent(
      rule as RuleMetadata & {
        rule?: string;
      },
    );
    if (contentTitle) {
      return contentTitle;
    }
  }
  return getRuleSourceDisplayName(rule);
}

export function getRuleSourceDisplayName(rule: RuleMetadata): string {
  switch (rule.source) {
    case ".qivrynrules":
      return "Project rules";
    case "default-chat":
      return "Default chat system message";
    case "default-plan":
      return "Default plan mode system message";
    case "default-agent":
      return "Default agent system message";
    case "json-systemMessage":
      return "System Message (JSON)";
    case "model-options-agent":
      return "Base System Agent Message";
    case "model-options-plan":
      return "Base System Plan Message";
    case "model-options-chat":
      return "Base System Chat Message";
    case "agentFile":
      if (rule.sourceFile) {
        return getLastNPathParts(rule.sourceFile, 2);
      } else {
        return "Agent file";
      }
    case "colocated-markdown":
      if (rule.sourceFile) {
        return getLastNPathParts(rule.sourceFile, 2);
      } else {
        return "rules.md";
      }
    case "rules-block":
      return "Inline rule";
    default:
      return rule.source;
  }
}
