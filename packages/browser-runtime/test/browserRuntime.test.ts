import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserSession } from "@qivryn/agent-runtime";
import type {
  BrowserAdapter,
  BrowserPermissionRequest,
} from "../src/contracts.js";
import { FileBrowserStore } from "../src/fileStore.js";
import { BrowserSessionService } from "../src/service.js";
import { FileBrowserPermissionPolicy } from "../src/permissionPolicy.js";
import { resolveBrowserExecutable } from "../src/puppeteerAdapter.js";

const roots: string[] = [];

function adapter(): BrowserAdapter {
  return {
    create: vi.fn(async () => ({ metadata: { driverRef: "mock-page" } })),
    close: vi.fn(async () => undefined),
    navigate: vi.fn(async (_session, url) => ({ url, title: `Page ${url}` })),
    goBack: vi.fn(async () => ({
      url: "http://localhost:3000/back",
      title: "Back",
    })),
    goForward: vi.fn(async () => ({
      url: "http://localhost:3000/forward",
      title: "Forward",
    })),
    reload: vi.fn(async (session) => ({
      url: session.url ?? "about:blank",
      title: "Reloaded",
    })),
    screenshot: vi.fn(async () => ({
      data: Buffer.from("png").toString("base64"),
      mediaType: "image/png" as const,
    })),
    domSnapshot: vi.fn(async () => "<html><body>Ready</body></html>"),
    consoleLogs: vi.fn(async () => [{ level: "log", text: "Ready" }]),
    networkRequests: vi.fn(async () => [
      { method: "GET", url: "http://localhost:3000/api" },
    ]),
    click: vi.fn(async (session) => ({
      url: session.url ?? "about:blank",
      title: "Clicked",
    })),
    typeText: vi.fn(async (session) => ({
      url: session.url ?? "about:blank",
      title: "Typed",
    })),
    pressKey: vi.fn(async (session) => ({
      url: session.url ?? "about:blank",
      title: "Pressed",
    })),
    scroll: vi.fn(async (session) => ({
      url: session.url ?? "about:blank",
      title: "Scrolled",
    })),
    wait: vi.fn(async (session) => ({
      url: session.url ?? "about:blank",
      title: "Ready",
    })),
    setViewport: vi.fn(async () => undefined),
    setRecording: vi.fn(async (session, recording) => ({
      metadata: {
        ...session.metadata,
        recordingPath:
          recording === "full" ? `/recordings/${session.id}.webm` : undefined,
      },
    })),
  };
}

async function service(allow = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), "qivryn-browser-"));
  roots.push(root);
  const requests: BrowserPermissionRequest[] = [];
  const store = new FileBrowserStore(root);
  const browser = new BrowserSessionService(store, adapter(), {
    async authorize(request) {
      requests.push(request);
      return allow;
    },
  });
  await browser.initialize();
  return { browser, requests, root, store };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("resolveBrowserExecutable", () => {
  it("prefers an explicitly configured browser executable", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qivryn-browser-bin-"));
    roots.push(root);
    const executable = path.join(root, "browser");
    await writeFile(executable, "");
    await chmod(executable, 0o755);
    const previous = process.env.QIVRYN_BROWSER_EXECUTABLE;
    process.env.QIVRYN_BROWSER_EXECUTABLE = executable;
    try {
      await expect(resolveBrowserExecutable()).resolves.toBe(executable);
    } finally {
      if (previous === undefined) delete process.env.QIVRYN_BROWSER_EXECUTABLE;
      else process.env.QIVRYN_BROWSER_EXECUTABLE = previous;
    }
  });
});

describe("BrowserSessionService", () => {
  it("persists sessions and allows localhost navigation without a prompt", async () => {
    const { browser, requests, root } = await service(false);
    const created = await browser.create({ visible: true, runId: "run-1" });
    const navigated = await browser.navigate(
      created.id,
      "http://localhost:3000",
      "agent",
    );
    expect(navigated).toMatchObject({
      url: "http://localhost:3000",
      visible: true,
      runId: "run-1",
      title: "Page http://localhost:3000",
    });
    expect(requests).toHaveLength(0);
    expect((await browser.back(created.id, "agent")).title).toBe("Back");
    expect((await browser.forward(created.id, "agent")).title).toBe("Forward");
    expect((await browser.reload(created.id, "agent")).title).toBe("Reloaded");

    const restored = new FileBrowserStore(root);
    await restored.initialize();
    expect((await restored.listSessions())[0].id).toBe(created.id);
    expect(
      (await restored.readEvents(created.id)).map((event) => event.sequence),
    ).toEqual([1, 2, 3, 4, 5]);
  });

  it("does not restore browser windows when Qivryn starts", async () => {
    const { browser, root } = await service();
    const created = await browser.create({ visible: true });
    await browser.navigate(created.id, "http://localhost:3000", "user");

    const restoredAdapter = adapter();
    const restored = new BrowserSessionService(
      new FileBrowserStore(root),
      restoredAdapter,
      { authorize: async () => true },
    );
    await restored.initialize();

    expect(restoredAdapter.create).not.toHaveBeenCalled();
    expect(await restored.list()).toEqual([]);
    expect(
      await new FileBrowserStore(root).readEvents(created.id),
    ).toHaveLength(2);
  });

  it("gates cross-origin and sensitive actions with auditable decisions", async () => {
    const { browser, requests } = await service(false);
    const session = await browser.create();
    await expect(
      browser.navigate(session.id, "https://example.test", "agent"),
    ).rejects.toThrow(/not authorized/);
    await expect(
      browser.authorizeSensitive(
        session.id,
        "download",
        "agent",
        "https://example.test/file",
      ),
    ).rejects.toThrow(/not authorized/);
    expect(requests.map((request) => request.action)).toEqual([
      "navigate",
      "download",
    ]);
    const events = await browser.events(session.id);
    expect(events.map((event) => event.kind)).toEqual([
      "permission",
      "permission",
    ]);
    expect(
      events.every(
        (event) => (event.payload as { allowed: boolean }).allowed === false,
      ),
    ).toBe(true);
  });

  it("persists origin-scoped agent grants and audits revocation", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "qivryn-browser-grants-"),
    );
    roots.push(root);
    const store = new FileBrowserStore(path.join(root, "sessions"));
    const policy = new FileBrowserPermissionPolicy(
      path.join(root, "grants.json"),
    );
    const browser = new BrowserSessionService(store, adapter(), policy);
    await browser.initialize();
    const session = await browser.create();
    const grant = await browser.grant(
      session.id,
      "download",
      "https://allowed.test",
    );
    await expect(
      browser.authorizeSensitive(
        session.id,
        "download",
        "agent",
        "https://allowed.test/file",
      ),
    ).resolves.toBeUndefined();
    await expect(
      browser.authorizeSensitive(
        session.id,
        "download",
        "agent",
        "https://blocked.test/file",
      ),
    ).rejects.toThrow(/not authorized/);
    expect(await browser.listGrants(session.id)).toHaveLength(1);
    await browser.revokeGrant(session.id, grant.id);
    await expect(
      browser.authorizeSensitive(
        session.id,
        "download",
        "agent",
        "https://allowed.test/file",
      ),
    ).rejects.toThrow(/not authorized/);
  });

  it("enforces locking and explicit takeover", async () => {
    const { browser } = await service();
    const session = await browser.create();
    await browser.lock(session.id, "agent");
    await expect(browser.screenshot(session.id, "user")).rejects.toThrow(
      /controlled by agent/,
    );
    expect((await browser.takeover(session.id, "user")).lockOwner).toBe("user");
    await expect(browser.dom(session.id, "agent")).rejects.toThrow(
      /controlled by user/,
    );
    expect((await browser.unlock(session.id, "user")).locked).toBe(false);
  });

  it("captures screenshots, DOM, console, network, viewport and recording events", async () => {
    const { browser } = await service();
    const session = await browser.create();
    expect((await browser.screenshot(session.id, "user")).mediaType).toBe(
      "image/png",
    );
    expect((await browser.dom(session.id, "user")).content).toContain("Ready");
    expect(await browser.console(session.id, "user")).toHaveLength(1);
    expect(await browser.network(session.id, "user")).toHaveLength(1);
    expect(
      (await browser.viewport(session.id, { width: 390, height: 844 }, "user"))
        .viewport,
    ).toEqual({ width: 390, height: 844 });
    const recording = await browser.recording(session.id, "full", "user");
    expect(recording.recording).toBe("full");
    expect(recording.metadata?.recordingPath).toBe(
      `/recordings/${session.id}.webm`,
    );
    await expect(
      browser.viewport(session.id, { width: 100, height: 100 }, "user"),
    ).rejects.toThrow(/between 200x200/);
    expect(
      (await browser.events(session.id)).map((event) => event.kind),
    ).toEqual([
      "screenshot",
      "dom",
      "console",
      "network",
      "viewport",
      "recording",
    ]);
  });

  it("executes auditable browser computer-use interactions", async () => {
    const { browser, requests } = await service(true);
    const session = await browser.create();
    expect(
      await browser.click(
        session.id,
        { selector: "button[type=submit]" },
        "agent",
      ),
    ).toMatchObject({ title: "Clicked" });
    expect(
      await browser.typeText(
        session.id,
        { selector: "input", text: "secret", replace: true },
        "agent",
      ),
    ).toMatchObject({ title: "Typed" });
    expect(await browser.pressKey(session.id, "Enter", "agent")).toMatchObject({
      title: "Pressed",
    });
    expect(await browser.scroll(session.id, 0, 600, "agent")).toMatchObject({
      title: "Scrolled",
    });
    expect(
      await browser.wait(session.id, { selector: "main" }, "agent"),
    ).toMatchObject({ title: "Ready" });
    expect(requests.map((request) => request.action)).toEqual([
      "interaction",
      "interaction",
      "interaction",
      "interaction",
    ]);
    const events = await browser.events(session.id);
    expect(events.filter((event) => event.kind === "interaction")).toHaveLength(
      5,
    );
    expect(JSON.stringify(events)).not.toContain("secret");
  });

  it("closes the driver and removes the session while retaining its audit log", async () => {
    const browserAdapter = adapter();
    const root = await mkdtemp(path.join(os.tmpdir(), "qivryn-browser-"));
    roots.push(root);
    const store = new FileBrowserStore(root);
    const browser = new BrowserSessionService(store, browserAdapter, {
      authorize: async () => true,
    });
    await browser.initialize();
    const session = await browser.create();
    await browser.close(session.id);
    expect(browserAdapter.close).toHaveBeenCalledWith(
      expect.objectContaining({ id: session.id }),
    );
    expect(await browser.get(session.id)).toBeUndefined();
    expect((await browser.events(session.id)).at(-1)?.kind).toBe("closed");
  });
});
