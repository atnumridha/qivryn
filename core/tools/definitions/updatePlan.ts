import { Tool } from "../..";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const updatePlanTool: Tool = {
  type: "function",
  displayTitle: "Update Plan",
  wouldLikeTo: "update the visible plan",
  isCurrently: "updating the visible plan",
  hasAlready: "updated the visible plan",
  group: BUILT_IN_GROUP_NAME,
  readonly: true,
  isInstant: true,
  function: {
    name: BuiltInToolNames.UpdatePlan,
    description:
      "Create or update the visible conversation plan. Send the complete current plan every time.",
    parameters: {
      type: "object",
      required: ["plan"],
      properties: {
        explanation: {
          type: "string",
          description:
            "Optional short note explaining why the plan changed. Keep it concise.",
        },
        plan: {
          type: "array",
          description:
            "Complete ordered plan. Use at most one in_progress item.",
          items: {
            type: "object",
            required: ["step", "status"],
            properties: {
              step: {
                type: "string",
                description: "A concise task step.",
              },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed"],
                description: "Current status for this step.",
              },
            },
          },
        },
      },
    },
  },
  systemMessageDescription: {
    prefix: `To create or update the visible task plan, use the ${BuiltInToolNames.UpdatePlan} tool with the complete current plan. Use it for multi-step work, keep steps short and checkable, and keep at most one item marked in_progress.`,
  },
  defaultToolPolicy: "allowedWithoutPermission",
  toolCallIcon: "ClipboardDocumentCheckIcon",
};
