import { Tool } from "../..";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const computerUseTool: Tool = {
  type: "function",
  displayTitle: "Computer Use",
  wouldLikeTo: "control a local browser session",
  isCurrently: "controlling a local browser session",
  hasAlready: "controlled a local browser session",
  group: BUILT_IN_GROUP_NAME,
  readonly: false,
  function: {
    name: BuiltInToolNames.ComputerUse,
    description:
      "Create and control an auditable local browser session. Use DOM snapshots to inspect pages, then use selectors when possible for reliable clicks and typing. Every mutating call is approval-gated.",
    parameters: {
      type: "object",
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: [
            "list",
            "create",
            "navigate",
            "dom",
            "click",
            "type",
            "press",
            "scroll",
            "wait",
            "close",
          ],
        },
        sessionId: {
          type: "string",
          description: "Browser session ID. Not needed for list or create.",
        },
        url: { type: "string" },
        visible: { type: "boolean" },
        recording: { type: "string", enum: ["events", "full"] },
        width: { type: "number", minimum: 200, maximum: 7680 },
        height: { type: "number", minimum: 200, maximum: 4320 },
        selector: {
          type: "string",
          description: "CSS selector for click, type, or wait.",
        },
        x: { type: "number" },
        y: { type: "number" },
        text: { type: "string" },
        replace: { type: "boolean" },
        key: {
          type: "string",
          description: "Puppeteer key name such as Enter, Tab, or Escape.",
        },
        deltaX: { type: "number" },
        deltaY: { type: "number" },
        milliseconds: { type: "number", minimum: 0, maximum: 30000 },
      },
    },
  },
  defaultToolPolicy: "allowedWithPermission",
  systemMessageDescription: {
    prefix: `Use ${BuiltInToolNames.ComputerUse} for browser computer use. Create or list a session, inspect the DOM, then use stable selectors for actions. Do not type credentials or approve consequential actions without explicit user direction.`,
  },
  toolCallIcon: "CursorArrowRaysIcon",
};
