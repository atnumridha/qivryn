import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const adapter = vi.hoisted(() => ({
  create: vi.fn(async () => ({ metadata: { driverRef: "mock-page" } })),
  close: vi.fn(async () => undefined),
  navigate: vi.fn(async (_session: unknown, url: string) => ({
    url,
    title: `Page ${url}`,
  })),
  goBack: vi.fn(),
  goForward: vi.fn(),
  reload: vi.fn(),
  screenshot: vi.fn(),
  domSnapshot: vi.fn(async () => "<main>Ready</main>"),
  consoleLogs: vi.fn(),
  networkRequests: vi.fn(),
  setViewport: vi.fn(),
  setRecording: vi.fn(),
  click: vi.fn(async (session: { url?: string }) => ({
    url: session.url ?? "about:blank",
    title: "Clicked",
  })),
  typeText: vi.fn(async (session: { url?: string }) => ({
    url: session.url ?? "about:blank",
    title: "Typed",
  })),
  pressKey: vi.fn(async (session: { url?: string }) => ({
    url: session.url ?? "about:blank",
    title: "Pressed",
  })),
  scroll: vi.fn(async (session: { url?: string }) => ({
    url: session.url ?? "about:blank",
    title: "Scrolled",
  })),
  wait: vi.fn(async (session: { url?: string }) => ({
    url: session.url ?? "about:blank",
    title: "Ready",
  })),
}));

vi.mock("@qivryn/browser-runtime", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@qivryn/browser-runtime")>();
  return {
    ...actual,
    PuppeteerBrowserAdapter: class {
      create = adapter.create;
      close = adapter.close;
      navigate = adapter.navigate;
      goBack = adapter.goBack;
      goForward = adapter.goForward;
      reload = adapter.reload;
      screenshot = adapter.screenshot;
      domSnapshot = adapter.domSnapshot;
      consoleLogs = adapter.consoleLogs;
      networkRequests = adapter.networkRequests;
      setViewport = adapter.setViewport;
      setRecording = adapter.setRecording;
      click = adapter.click;
      typeText = adapter.typeText;
      pressKey = adapter.pressKey;
      scroll = adapter.scroll;
      wait = adapter.wait;
    },
  };
});

let root: string;
let originalGlobalDirectory: string | undefined;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "qivryn-cli-computer-use-"));
  originalGlobalDirectory = process.env.QIVRYN_GLOBAL_DIR;
  process.env.QIVRYN_GLOBAL_DIR = root;
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(async () => {
  if (originalGlobalDirectory === undefined) {
    delete process.env.QIVRYN_GLOBAL_DIR;
  } else {
    process.env.QIVRYN_GLOBAL_DIR = originalGlobalDirectory;
  }
  await rm(root, { recursive: true, force: true });
});

describe("computerUseTool", () => {
  it("is registered as an approval-gated built-in with the complete action contract", async () => {
    const { computerUseTool } = await import("./computerUse.js");
    const { ALL_BUILT_IN_TOOLS } = await import("./allBuiltIns.js");
    const { checkToolPermission } = await import(
      "../permissions/permissionChecker.js"
    );
    const { getDefaultToolPolicies } = await import(
      "../permissions/defaultPolicies.js"
    );

    expect(computerUseTool).toMatchObject({
      name: "computer_use",
      displayName: "Computer Use",
      readonly: false,
      isBuiltIn: true,
    });
    expect(computerUseTool.parameters.properties.action).toMatchObject({
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
    });
    expect(ALL_BUILT_IN_TOOLS).toContain(computerUseTool);
    expect(
      checkToolPermission(
        { name: computerUseTool.name, arguments: { action: "list" } },
        { policies: getDefaultToolPolicies(false) },
      ).permission,
    ).toBe("ask");
  });

  it("persists and executes every supported action without auditing typed text", async () => {
    const { computerUseTool } = await import("./computerUse.js");
    const secret = "do-not-echo-this";

    const createOutput = await computerUseTool.run({
      action: "create",
      url: "https://example.test/start",
      visible: true,
      recording: "full",
      width: 1440,
      height: 900,
    });
    const created = JSON.parse(createOutput) as {
      sessionId: string;
      url: string;
      visible: boolean;
      viewport: { width: number; height: number };
    };
    expect(created).toMatchObject({
      url: "https://example.test/start",
      visible: true,
      viewport: { width: 1440, height: 900 },
    });

    expect(JSON.parse(await computerUseTool.run({ action: "list" }))).toEqual([
      expect.objectContaining({ sessionId: created.sessionId }),
    ]);

    expect(
      JSON.parse(
        await computerUseTool.run({
          action: "navigate",
          sessionId: created.sessionId,
          url: "https://example.test/form",
        }),
      ).url,
    ).toBe("https://example.test/form");
    expect(
      await computerUseTool.run({
        action: "dom",
        sessionId: created.sessionId,
      }),
    ).toBe("<main>Ready</main>");
    await computerUseTool.run({
      action: "click",
      sessionId: created.sessionId,
      selector: "#name",
    });
    const typePreview = await computerUseTool.preprocess!({
      action: "type",
      sessionId: created.sessionId,
      selector: "#name",
      text: secret,
      replace: true,
    });
    const typeOutput = await computerUseTool.run(typePreview.args);
    expect(JSON.stringify(typePreview.preview)).not.toContain(secret);
    expect(typeOutput).not.toContain(secret);
    await computerUseTool.run({
      action: "press",
      sessionId: created.sessionId,
      key: "Enter",
    });
    await computerUseTool.run({
      action: "scroll",
      sessionId: created.sessionId,
      deltaX: 10,
      deltaY: 500,
    });
    await computerUseTool.run({
      action: "wait",
      sessionId: created.sessionId,
      selector: "main",
      milliseconds: 250,
    });

    expect(adapter.typeText).toHaveBeenCalledWith(
      expect.objectContaining({ id: created.sessionId }),
      { selector: "#name", text: secret, replace: true },
    );

    const auditPath = path.join(root, "browser", "browser.json");
    const auditJson = await readFile(auditPath, "utf8");
    const audit = JSON.parse(auditJson) as {
      events: Array<{ kind: string; payload: Record<string, unknown> }>;
    };
    expect(auditJson).not.toContain(secret);
    expect(
      audit.events
        .filter((event) => event.kind === "permission")
        .map((event) => ({
          action: event.payload.action,
          source: event.payload.source,
          allowed: event.payload.allowed,
        })),
    ).toEqual([
      { action: "navigate", source: "tool-policy", allowed: true },
      { action: "navigate", source: "tool-policy", allowed: true },
      { action: "interaction", source: "tool-policy", allowed: true },
      { action: "interaction", source: "tool-policy", allowed: true },
      { action: "interaction", source: "tool-policy", allowed: true },
      { action: "interaction", source: "tool-policy", allowed: true },
    ]);

    expect(
      await computerUseTool.run({
        action: "close",
        sessionId: created.sessionId,
      }),
    ).toBe(`Closed ${created.sessionId}`);
    expect(JSON.parse(await computerUseTool.run({ action: "list" }))).toEqual(
      [],
    );
  });
});
