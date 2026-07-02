import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  BrowserSessionService,
  FileBrowserStore,
  PuppeteerBrowserAdapter,
  FileBrowserPermissionPolicy,
  type BrowserPermissionGrant,
  type BrowserActionRequest,
} from "@continuedev/browser-runtime";

export interface BrowserCommandOptions {
  url?: string;
  visible?: boolean;
  json?: boolean;
  output?: string;
  width?: string;
  height?: string;
  recording?: "off" | "events" | "full";
  permission?: BrowserPermissionGrant["action"];
  origin?: string;
  expiresAt?: string;
}

async function createBrowserService(): Promise<BrowserSessionService> {
  const globalDirectory =
    process.env.CONTINUE_GLOBAL_DIR ?? path.join(os.homedir(), ".continue");
  const service = new BrowserSessionService(
    new FileBrowserStore(path.join(globalDirectory, "browser")),
    new PuppeteerBrowserAdapter(),
    new FileBrowserPermissionPolicy(
      path.join(globalDirectory, "browser", "grants.json"),
    ),
  );
  await service.initialize();
  return service;
}

function output(value: unknown, json?: boolean): void {
  if (json || typeof value !== "string")
    console.log(JSON.stringify(value, null, 2));
  else console.log(value);
}

export async function browserCommand(
  action = "list",
  sessionId: string | undefined,
  options: BrowserCommandOptions,
): Promise<void> {
  const service = await createBrowserService();
  if (action === "list") {
    output(await service.list(), options.json);
    return;
  }
  if (action === "create") {
    output(
      await service.create({
        url: options.url,
        visible: options.visible,
        recording: options.recording ?? "events",
      }),
      options.json,
    );
    return;
  }
  if (!sessionId)
    throw new Error(`Browser action ${action} requires a session ID`);
  if (action === "grants") {
    output(await service.listGrants(sessionId), options.json);
    return;
  }
  if (action === "grant") {
    if (!options.permission)
      throw new Error("Browser grant requires --permission");
    output(
      await service.grant(
        sessionId,
        options.permission,
        options.origin,
        options.expiresAt,
      ),
      options.json,
    );
    return;
  }
  if (action === "revoke") {
    if (!options.permission)
      throw new Error("Browser revoke requires --permission <grant-id>");
    await service.revokeGrant(sessionId, options.permission);
    return;
  }
  let request: BrowserActionRequest;
  switch (action) {
    case "navigate":
      if (!options.url) throw new Error("Browser navigation requires --url");
      request = { action, sessionId, url: options.url };
      break;
    case "viewport": {
      const width = Number(options.width);
      const height = Number(options.height);
      if (!Number.isFinite(width) || !Number.isFinite(height)) {
        throw new Error(
          "Browser viewport requires numeric --width and --height",
        );
      }
      request = { action, sessionId, viewport: { width, height } };
      break;
    }
    case "recording":
      if (!options.recording)
        throw new Error("Browser recording requires --recording");
      request = { action, sessionId, recording: options.recording };
      break;
    case "close":
    case "back":
    case "forward":
    case "reload":
    case "lock":
    case "takeover":
    case "unlock":
    case "screenshot":
    case "dom":
    case "console":
    case "network":
      request = { action, sessionId };
      break;
    default:
      throw new Error(`Unknown browser action: ${action}`);
  }
  const result = await (async () => {
    switch (request.action) {
      case "close":
        return service.close(request.sessionId);
      case "navigate":
        return service.navigate(request.sessionId, request.url, "user");
      case "back":
        return service.back(request.sessionId, "user");
      case "forward":
        return service.forward(request.sessionId, "user");
      case "reload":
        return service.reload(request.sessionId, "user");
      case "lock":
        return service.lock(request.sessionId, "user");
      case "takeover":
        return service.takeover(request.sessionId, "user");
      case "unlock":
        return service.unlock(request.sessionId, "user");
      case "screenshot":
        return service.screenshot(request.sessionId, "user");
      case "dom":
        return service.dom(request.sessionId, "user");
      case "console":
        return service.console(request.sessionId, "user");
      case "network":
        return service.network(request.sessionId, "user");
      case "viewport":
        return service.viewport(request.sessionId, request.viewport, "user");
      case "recording":
        return service.recording(request.sessionId, request.recording, "user");
    }
  })();
  if (
    request.action === "screenshot" &&
    result &&
    "data" in result &&
    options.output
  ) {
    await writeFile(
      path.resolve(options.output),
      Buffer.from(result.data, "base64"),
    );
    output(
      { output: path.resolve(options.output), event: result.event },
      options.json,
    );
    return;
  }
  if (
    request.action === "dom" &&
    result &&
    "content" in result &&
    !options.json
  ) {
    console.log(result.content);
    return;
  }
  output(result, options.json);
}
