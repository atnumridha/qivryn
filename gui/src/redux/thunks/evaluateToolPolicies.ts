import { ToolPolicy } from "@qivryn/terminal-security";
import { Tool, ToolCallState } from "core";
import { IIdeMessenger } from "../../context/IdeMessenger";
import { isEditTool } from "../../util/toolCallState";
import { errorToolCall, updateToolCallOutput } from "../slices/sessionSlice";
import {
  AgentAccessMode,
  DEFAULT_TOOL_SETTING,
  ToolPolicies,
} from "../slices/uiSlice";
import { AppThunkDispatch } from "../store";

interface EvaluatedPolicy {
  policy: ToolPolicy;
  displayValue?: string;
  toolCallState: ToolCallState;
}

/**
 * Evaluates the tool policy for a tool call, including dynamic policy evaluation
 * Note that tool group policies are not considered here because activeTools already excludes disabled groups
 */
async function evaluateToolPolicy(
  ideMessenger: IIdeMessenger,
  activeTools: Tool[],
  toolCallState: ToolCallState,
  toolPolicies: ToolPolicies,
  accessMode: AgentAccessMode,
): Promise<EvaluatedPolicy> {
  const toolName = toolCallState.toolCall.function.name;
  const tool = activeTools.find(
    (candidate) => candidate.function.name === toolName,
  );
  const configuredPolicy =
    toolPolicies[toolName] ?? tool?.defaultToolPolicy ?? DEFAULT_TOOL_SETTING;

  // An explicitly disabled tool stays disabled in every access mode.
  if (configuredPolicy === "disabled") {
    return { policy: "disabled", toolCallState };
  }

  if (accessMode === "readOnly") {
    return {
      policy: tool?.readonly ? "allowedWithoutPermission" : "disabled",
      toolCallState,
    };
  }

  // Full access bypasses Qivryn approval and command classification. OS-level
  // permissions still apply to the extension host process.
  if (accessMode === "fullAccess") {
    return { policy: "allowedWithoutPermission", toolCallState };
  }

  // Preserve the existing edit UX in Ask mode. Autonomous mode also permits
  // edits, while dynamic terminal/file policies can still escalate risky args.
  if (isEditTool(toolName)) {
    return { policy: "allowedWithoutPermission", toolCallState };
  }

  const basePolicy =
    accessMode === "autonomous" ? "allowedWithoutPermission" : configuredPolicy;

  const result = await ideMessenger.request("tools/evaluatePolicy", {
    toolName,
    basePolicy,
    parsedArgs: toolCallState.parsedArgs,
    processedArgs: toolCallState.processedArgs,
  });

  // Evaluate the policy dynamically
  if (result.status === "error") {
    console.error(`Error evaluating tool policy for ${toolName}`, result.error);
    return { policy: "disabled", toolCallState };
  }

  const dynamicPolicy = result.content.policy;
  const displayValue = result.content.displayValue;

  // Ensure dynamic policy cannot be more lenient than base policy
  // Policy hierarchy (most restrictive to least): disabled > allowedWithPermission > allowedWithoutPermission
  if (
    basePolicy === "allowedWithPermission" &&
    dynamicPolicy === "allowedWithoutPermission"
  ) {
    return { policy: "allowedWithPermission", displayValue, toolCallState }; // Cannot make more lenient
  }

  return { policy: dynamicPolicy, displayValue, toolCallState };
}

/*
    1. Get arg-dependent tool policies from core
    2. Mark any disabled ones as errored
    3. Mark others as generated
*/
export async function evaluateToolPolicies(
  dispatch: AppThunkDispatch,
  ideMessenger: IIdeMessenger,
  activeTools: Tool[],
  generatedToolCalls: ToolCallState[],
  toolPolicies: ToolPolicies,
  accessMode: AgentAccessMode,
): Promise<EvaluatedPolicy[]> {
  // Check if ALL tool calls are auto-approved using dynamic evaluation
  const policyResults = await Promise.all(
    generatedToolCalls.map((toolCallState) =>
      evaluateToolPolicy(
        ideMessenger,
        activeTools,
        toolCallState,
        toolPolicies,
        accessMode,
      ),
    ),
  );

  const disabledResults = policyResults.filter(
    ({ policy }) => policy === "disabled",
  );

  for (const { displayValue, toolCallState } of disabledResults) {
    dispatch(errorToolCall({ toolCallId: toolCallState.toolCallId }));

    // Use the displayValue from the policy evaluation, or fallback to function name
    const command = displayValue || toolCallState.toolCall.function.name;

    // Add error message explaining why it's disabled
    dispatch(
      updateToolCallOutput({
        toolCallId: toolCallState.toolCallId,
        contextItems: [
          {
            icon: "problems",
            name: "Security Policy Violation",
            description: "Command Disabled",
            content: `This command has been disabled by security policy:\n\n${command}\n\nThis command cannot be executed as it may pose a security risk.`,
            hidden: false,
          },
        ],
      }),
    );
  }

  return policyResults;
}
