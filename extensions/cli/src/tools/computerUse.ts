import os from "node:os";
import path from "node:path";

import type { BrowserSession } from "@qivryn/agent-runtime";
import {
  BrowserSessionService,
  FileBrowserPermissionPolicy,
  FileBrowserStore,
  PuppeteerBrowserAdapter,
} from "@qivryn/browser-runtime";

import type { ParameterSchema, Tool } from "./types.js";

const COMPUTER_USE_ACTIONS = [
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
] as const;

const actionParameter = {
  type: "string",
  description: "Browser action to perform.",
  enum: [...COMPUTER_USE_ACTIONS],
} satisfies ParameterSchema & { enum: string[] };

const recordingParameter = {
  type: "string",
  description: "Audit recording level for a new session.",
  enum: ["events", "full"],
} satisfies ParameterSchema & { enum: string[] };

const widthParameter = {
  type: "number",
  description: "Viewport width for a new session. Defaults to 1280.",
  minimum: 200,
  maximum: 7680,
} satisfies ParameterSchema & { minimum: number; maximum: number };

const heightParameter = {
  type: "number",
  description: "Viewport height for a new session. Defaults to 720.",
  minimum: 200,
  maximum: 4320,
} satisfies ParameterSchema & { minimum: number; maximum: number };

const waitParameter = {
  type: "number",
  description: "Wait duration in milliseconds, from 0 through 30000.",
  minimum: 0,
  maximum: 30_000,
} satisfies ParameterSchema & { minimum: number; maximum: number };

let browserServicePromise: Promise<BrowserSessionService> | undefined;

async function initializeBrowserService(): Promise<BrowserSessionService> {
  const globalDirectory =
    process.env.QIVRYN_GLOBAL_DIR ?? path.join(os.homedir(), ".qivryn");
  const browserDirectory = path.join(globalDirectory, "browser");
  const service = new BrowserSessionService(
    new FileBrowserStore(browserDirectory),
    new PuppeteerBrowserAdapter(),
    new FileBrowserPermissionPolicy(path.join(browserDirectory, "grants.json")),
  );
  await service.initialize();
  return service;
}

function getBrowserService(): Promise<BrowserSessionService> {
  if (!browserServicePromise) {
    browserServicePromise = initializeBrowserService().catch((error) => {
      browserServicePromise = undefined;
      throw error;
    });
  }
  return browserServicePromise;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function sessionSummary(session: BrowserSession) {
  return {
    sessionId: session.id,
    title: session.title,
    url: session.url,
    visible: session.visible,
    locked: session.locked,
    lockOwner: session.lockOwner,
    viewport: session.viewport,
  };
}

function summarize(session: BrowserSession): string {
  return JSON.stringify(sessionSummary(session), null, 2);
}

function preview(args: Record<string, unknown>): string {
  const action = typeof args.action === "string" ? args.action : "unknown";
  const sessionId =
    typeof args.sessionId === "string" ? args.sessionId.trim() : "";
  const suffix = sessionId ? ` for browser session ${sessionId}` : "";

  if (action === "type") {
    const length = typeof args.text === "string" ? args.text.length : 0;
    return `Will enter ${length} character${length === 1 ? "" : "s"}${suffix}`;
  }
  if (
    (action === "create" || action === "navigate") &&
    typeof args.url === "string" &&
    args.url.trim()
  ) {
    return `Will ${action} a browser session at ${args.url.trim()}${suffix}`;
  }
  return `Will run browser action ${action}${suffix}`;
}

export const computerUseTool: Tool = {
  name: "computer_use",
  displayName: "Computer Use",
  description:
    "Create and control an auditable local browser session. Use DOM snapshots to inspect pages, then use selectors when possible for reliable clicks and typing. Browser actions run through the normal CLI tool permission policy.",
  parameters: {
    type: "object",
    required: ["action"],
    properties: {
      action: actionParameter,
      sessionId: {
        type: "string",
        description: "Browser session ID. Not needed for list or create.",
      },
      url: {
        type: "string",
        description: "URL for create or navigate.",
      },
      visible: {
        type: "boolean",
        description: "Whether a new browser session should be visible.",
      },
      recording: recordingParameter,
      width: widthParameter,
      height: heightParameter,
      selector: {
        type: "string",
        description: "CSS selector for click, type, or wait.",
      },
      x: {
        type: "number",
        description: "Horizontal coordinate for click.",
      },
      y: {
        type: "number",
        description: "Vertical coordinate for click.",
      },
      text: {
        type: "string",
        description: "Text to enter. The tool does not echo it in its output.",
      },
      replace: {
        type: "boolean",
        description: "Replace existing field content before typing.",
      },
      key: {
        type: "string",
        description: "Puppeteer key name such as Enter, Tab, or Escape.",
      },
      deltaX: {
        type: "number",
        description: "Horizontal scroll delta. Defaults to 0.",
      },
      deltaY: {
        type: "number",
        description: "Vertical scroll delta. Defaults to 0.",
      },
      milliseconds: waitParameter,
    },
  },
  readonly: false,
  isBuiltIn: true,
  preprocess: async (args: Record<string, unknown>) => ({
    args,
    preview: [{ type: "text", content: preview(args) }],
  }),
  run: async (args: Record<string, unknown>): Promise<string> => {
    const service = await getBrowserService();
    const action = typeof args.action === "string" ? args.action : "";
    const sessionId =
      typeof args.sessionId === "string" ? args.sessionId.trim() : "";

    if (action === "list") {
      return JSON.stringify(
        (await service.list()).map((session) => sessionSummary(session)),
        null,
        2,
      );
    }

    if (action === "create") {
      const session = await service.create({
        visible: args.visible === true,
        recording: args.recording === "full" ? "full" : "events",
        viewport: {
          width: finiteNumber(args.width) ?? 1280,
          height: finiteNumber(args.height) ?? 720,
        },
        metadata: { createdBy: "computer_use" },
      });
      const url = typeof args.url === "string" ? args.url.trim() : "";
      const ready = url
        ? await service.navigate(session.id, url, "agent", true)
        : session;
      return summarize(ready);
    }

    if (!sessionId) {
      throw new Error(`${action || "Computer use"} needs sessionId`);
    }

    switch (action) {
      case "navigate": {
        const url = typeof args.url === "string" ? args.url.trim() : "";
        if (!url) throw new Error("Browser navigation needs a URL");
        return summarize(await service.navigate(sessionId, url, "agent", true));
      }
      case "dom":
        return (await service.dom(sessionId, "agent")).content;
      case "click":
        return summarize(
          await service.click(
            sessionId,
            {
              selector:
                typeof args.selector === "string" ? args.selector : undefined,
              x: finiteNumber(args.x),
              y: finiteNumber(args.y),
            },
            "agent",
            true,
          ),
        );
      case "type":
        return summarize(
          await service.typeText(
            sessionId,
            {
              selector:
                typeof args.selector === "string" ? args.selector : undefined,
              text: typeof args.text === "string" ? args.text : "",
              replace: args.replace === true,
            },
            "agent",
            true,
          ),
        );
      case "press":
        return summarize(
          await service.pressKey(
            sessionId,
            typeof args.key === "string" ? args.key : "",
            "agent",
            true,
          ),
        );
      case "scroll":
        return summarize(
          await service.scroll(
            sessionId,
            finiteNumber(args.deltaX) ?? 0,
            finiteNumber(args.deltaY) ?? 0,
            "agent",
            true,
          ),
        );
      case "wait":
        return summarize(
          await service.wait(
            sessionId,
            {
              selector:
                typeof args.selector === "string" ? args.selector : undefined,
              milliseconds: finiteNumber(args.milliseconds),
            },
            "agent",
          ),
        );
      case "close":
        await service.close(sessionId, "agent");
        return `Closed ${sessionId}`;
      default:
        throw new Error(`Unsupported computer use action: ${action}`);
    }
  },
};
