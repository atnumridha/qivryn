import {
  AssistantUnrolled,
  ModelConfig,
  RuleObject,
  RuleType,
  getRuleType,
} from "@continuedev/config-yaml";
import { Box, Text } from "ink";
import React, { useMemo } from "react";

import { getDisplayableAsciiArt } from "../asciiArt.js";
import { MCPService } from "../services/MCPService.js";
import { isModelCapable } from "../utils/modelCapability.js";

import { ModelCapabilityWarning } from "./ModelCapabilityWarning.js";
import { TipsDisplay, shouldShowTip } from "./TipsDisplay.js";

interface IntroMessageProps {
  config?: AssistantUnrolled;
  model?: ModelConfig;
  mcpService?: MCPService;
  organizationName?: string;
}

type ConfigRule = string | Partial<RuleObject> | undefined;

export interface RuleSummary {
  title: string;
  type: RuleType;
}

function cleanRuleTitle(title: string): string {
  return title
    .replace(/[`*_#>\-[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateRuleTitle(title: string): string {
  return title.length > 64 ? `${title.slice(0, 61).trim()}...` : title;
}

function titleFromRuleContent(content?: string): string | undefined {
  const trimmed = content?.trim();
  if (!trimmed) {
    return undefined;
  }

  const heading = trimmed.match(/^#{1,6}\s+(.+)$/m)?.[1];
  if (heading) {
    return truncateRuleTitle(cleanRuleTitle(heading));
  }

  const firstLine = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return undefined;
  }

  const sentence = firstLine.match(/^(.+?[.!?])\s/)?.[1];
  return truncateRuleTitle(cleanRuleTitle(sentence ?? firstLine));
}

export function summarizeRulesForIntro(
  rules: ConfigRule[] = [],
): RuleSummary[] {
  return rules
    .map((rule) => {
      if (!rule) {
        return undefined;
      }

      if (typeof rule === "string") {
        return {
          title: titleFromRuleContent(rule) ?? "Inline rule",
          type: RuleType.Always,
        };
      }

      return {
        title:
          rule.name ??
          titleFromRuleContent(rule.rule) ??
          rule.description ??
          "Unnamed rule",
        type: getRuleType(rule),
      };
    })
    .filter((summary): summary is RuleSummary => !!summary);
}

function getRuleTypeLabel(type: RuleType): string {
  switch (type) {
    case RuleType.AutoAttached:
      return "File scoped";
    case RuleType.AgentRequested:
      return "Agent requested";
    default:
      return type;
  }
}

const IntroMessage: React.FC<IntroMessageProps> = ({
  config,
  model,
  mcpService,
  organizationName,
}) => {
  // Get MCP prompts directly (not memoized since they can change after first render)
  const mcpPrompts = mcpService?.getState().prompts ?? [];

  // Determine if we should show a tip (1 in 5 chance) - computed once on mount
  const showTip = useMemo(() => shouldShowTip(), []);

  // Memoize expensive operations to avoid running on every resize
  const { allRules, modelCapable } = useMemo(() => {
    const allRules = summarizeRulesForIntro(config?.rules as ConfigRule[]);

    // Check if model is capable - now checking both name and model properties
    const modelCapable = model
      ? isModelCapable(model.provider, model.name, model.model)
      : true; // Default to true if model not loaded yet

    return { allRules, modelCapable };
  }, [config?.rules, model?.provider, model?.name, model?.model]);

  // Render helper components
  const renderMcpPrompts = () =>
    mcpPrompts.length > 0 ? (
      <>
        {mcpPrompts.map((prompt, index) => (
          <Text key={`mcp-${index}`}>
            - <Text color="white">/{prompt.name}</Text>:{" "}
            <Text color="dim">{prompt.description}</Text>
          </Text>
        ))}
        <Text> </Text>
      </>
    ) : null;

  const renderRules = () => {
    const groupedRules = Object.values(RuleType)
      .map((ruleType) => ({
        ruleType,
        rules: allRules.filter((rule) => rule.type === ruleType),
      }))
      .filter((group) => group.rules.length > 0);

    if (groupedRules.length === 0) {
      return null;
    }

    return (
      <>
        <Text bold color="blue">
          Rules:
        </Text>
        <Text>
          - <Text color="white">{allRules.length} configured</Text>
        </Text>
        {groupedRules.map((group) => (
          <Text key={group.ruleType}>
            - <Text color="white">{getRuleTypeLabel(group.ruleType)}</Text>{" "}
            <Text color="dim">({group.rules.length})</Text>
          </Text>
        ))}
        {allRules.slice(0, 8).map((rule, index) => (
          <Text key={`${rule.type}-${index}`}>
            <Text color="dim"> - </Text>
            <Text color="white">{rule.title}</Text>
          </Text>
        ))}
        {allRules.length > 8 && (
          <Text color="dim"> - +{allRules.length - 8} more</Text>
        )}
        <Text> </Text>
      </>
    );
  };

  const renderMcpServers = () =>
    (config?.mcpServers?.length ?? 0) > 0 ? (
      <>
        <Text bold color="blue">
          MCP Servers:
        </Text>
        {config?.mcpServers?.map((server: any, index: number) => (
          <Text key={index}>
            - <Text color="white">{server?.name}</Text>
          </Text>
        ))}
        <Text> </Text>
      </>
    ) : null;

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      {/* ASCII Art */}
      <Text>{getDisplayableAsciiArt()}</Text>
      <Text> </Text>

      {/* Tips Display - shown randomly 1 in 5 times */}
      {showTip && <TipsDisplay />}

      {/* Organization name */}
      {organizationName && (
        <Text color="blue">
          <Text bold>Org:</Text> <Text color="white">{organizationName}</Text>
        </Text>
      )}

      {/* Agent name */}
      {config && (
        <Text color="blue">
          <Text bold>Config:</Text> <Text color="white">{config.name}</Text>
        </Text>
      )}

      {/* Model */}
      {model ? (
        <Text color="blue">
          <Text bold>Model:</Text>{" "}
          <Text color="white">{model.name.split("/").pop()}</Text>
        </Text>
      ) : (
        <Text color="blue">
          <Text bold>Model:</Text> <Text color="dim">Loading...</Text>
        </Text>
      )}

      <Text> </Text>

      {/* Model capability warning */}
      {model && !modelCapable && (
        <>
          <ModelCapabilityWarning
            modelName={model.name.split("/").pop() || model.name}
          />
          <Text> </Text>
        </>
      )}

      {renderMcpPrompts()}
      {renderRules()}
      {renderMcpServers()}
    </Box>
  );
};

export { IntroMessage };
