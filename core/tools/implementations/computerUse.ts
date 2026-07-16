import type { BrowserSession } from "@qivryn/agent-runtime";
import { ContextItem } from "../..";
import { getBrowserService } from "../../context/browser/BrowserServiceSingleton";
import { ToolImpl } from ".";

function item(description: string, content: string): ContextItem[] {
  return [
    {
      name: "Computer Use",
      description,
      content,
    },
  ];
}

function summarize(session: BrowserSession): string {
  return JSON.stringify(
    {
      sessionId: session.id,
      title: session.title,
      url: session.url,
      visible: session.visible,
      locked: session.locked,
      lockOwner: session.lockOwner,
      viewport: session.viewport,
    },
    null,
    2,
  );
}

function sameOrigin(left: string | undefined, right: string): boolean {
  if (!left) return false;
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

function reusableSession(sessions: BrowserSession[], url: string) {
  return sessions
    .filter(
      (session) =>
        sameOrigin(session.url, url) &&
        (!session.locked || session.lockOwner === "agent"),
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

export const computerUseImpl: ToolImpl = async (args) => {
  const service = await getBrowserService();
  const action = typeof args.action === "string" ? args.action : "";
  const sessionId =
    typeof args.sessionId === "string" ? args.sessionId.trim() : "";

  if (action === "list") {
    const sessions = await service.list();
    return item(
      "Browser sessions",
      JSON.stringify(
        sessions.map((session) => JSON.parse(summarize(session))),
        null,
        2,
      ),
    );
  }

  if (action === "create") {
    const url = typeof args.url === "string" ? args.url.trim() : "";
    const reuseExisting = args.reuseExisting !== false;
    const existing =
      reuseExisting && url
        ? reusableSession(await service.list(), url)
        : undefined;
    if (existing) {
      const ready = await service.navigate(existing.id, url, "agent", true);
      return item("Browser session reused", summarize(ready));
    }
    const session = await service.create({
      visible: args.visible === true,
      recording: args.recording === "full" ? "full" : "events",
      viewport: {
        width: Number.isFinite(args.width) ? Number(args.width) : 1280,
        height: Number.isFinite(args.height) ? Number(args.height) : 720,
      },
      metadata: { createdBy: "computer_use" },
    });
    const ready = url
      ? await service.navigate(session.id, url, "agent", true)
      : session;
    return item("Browser session created", summarize(ready));
  }

  if (!sessionId)
    throw new Error(`${action || "Computer use"} needs sessionId`);

  switch (action) {
    case "navigate": {
      const url = typeof args.url === "string" ? args.url.trim() : "";
      if (!url) throw new Error("Browser navigation needs a URL");
      return item(
        "Browser navigated",
        summarize(await service.navigate(sessionId, url, "agent", true)),
      );
    }
    case "dom": {
      const result = await service.dom(sessionId, "agent");
      return item("Browser DOM", result.content);
    }
    case "click":
      return item(
        "Browser click completed",
        summarize(
          await service.click(
            sessionId,
            {
              selector:
                typeof args.selector === "string" ? args.selector : undefined,
              x: Number.isFinite(args.x) ? Number(args.x) : undefined,
              y: Number.isFinite(args.y) ? Number(args.y) : undefined,
            },
            "agent",
            true,
          ),
        ),
      );
    case "type": {
      const text = typeof args.text === "string" ? args.text : "";
      return item(
        "Browser text entered",
        summarize(
          await service.typeText(
            sessionId,
            {
              selector:
                typeof args.selector === "string" ? args.selector : undefined,
              text,
              replace: args.replace === true,
            },
            "agent",
            true,
          ),
        ),
      );
    }
    case "press":
      return item(
        "Browser key pressed",
        summarize(
          await service.pressKey(
            sessionId,
            typeof args.key === "string" ? args.key : "",
            "agent",
            true,
          ),
        ),
      );
    case "scroll":
      return item(
        "Browser scrolled",
        summarize(
          await service.scroll(
            sessionId,
            Number.isFinite(args.deltaX) ? Number(args.deltaX) : 0,
            Number.isFinite(args.deltaY) ? Number(args.deltaY) : 0,
            "agent",
            true,
          ),
        ),
      );
    case "wait":
      return item(
        "Browser wait completed",
        summarize(
          await service.wait(
            sessionId,
            {
              selector:
                typeof args.selector === "string" ? args.selector : undefined,
              milliseconds: Number.isFinite(args.milliseconds)
                ? Number(args.milliseconds)
                : undefined,
            },
            "agent",
          ),
        ),
      );
    case "close":
      await service.close(sessionId, "agent");
      return item("Browser session closed", `Closed ${sessionId}`);
    default:
      throw new Error(`Unsupported computer use action: ${action}`);
  }
};
