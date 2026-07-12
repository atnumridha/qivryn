import puppeteer, {
  type Browser,
  type KeyInput,
  type Page,
  type ScreenRecorder,
} from "puppeteer";
import type { BrowserSession } from "@qivryn/agent-runtime";
import { constants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BrowserAdapter } from "./contracts.js";

interface BrowserState {
  browser: Browser;
  page: Page;
  console: unknown[];
  network: unknown[];
  recorder?: ScreenRecorder;
  recordingPath?: string;
}

function platformBrowserCandidates(): string[] {
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ].filter((candidate): candidate is string => Boolean(candidate));
  }

  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA;
    const programFiles = process.env.PROGRAMFILES;
    const programFilesX86 = process.env["PROGRAMFILES(X86)"];
    return [
      local &&
        path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
      programFiles &&
        path.join(
          programFiles,
          "Google",
          "Chrome",
          "Application",
          "chrome.exe",
        ),
      programFilesX86 &&
        path.join(
          programFilesX86,
          "Google",
          "Chrome",
          "Application",
          "chrome.exe",
        ),
      programFiles &&
        path.join(
          programFiles,
          "Microsoft",
          "Edge",
          "Application",
          "msedge.exe",
        ),
    ].filter((candidate): candidate is string => Boolean(candidate));
  }

  return [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge-stable",
  ].filter((candidate): candidate is string => Boolean(candidate));
}

export async function resolveBrowserExecutable(): Promise<string | undefined> {
  const managed = puppeteer.executablePath();
  const candidates = [
    process.env.QIVRYN_BROWSER_EXECUTABLE,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    managed,
    ...platformBrowserCandidates(),
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return undefined;
}

export class PuppeteerBrowserAdapter implements BrowserAdapter {
  private readonly states = new Map<string, BrowserState>();

  async create(session: BrowserSession): Promise<Partial<BrowserSession>> {
    if (this.states.has(session.id)) return {};
    const executablePath = await resolveBrowserExecutable();
    const browser = await puppeteer.launch({
      headless: !session.visible,
      executablePath,
      args: ["--disable-background-networking", "--disable-component-update"],
    });
    const page = await browser.newPage();
    const state: BrowserState = { browser, page, console: [], network: [] };
    this.states.set(session.id, state);
    page.on("console", (message) => {
      state.console.push({
        type: message.type(),
        text: message.text(),
        location: message.location(),
        timestamp: new Date().toISOString(),
      });
    });
    page.on("request", (request) => {
      state.network.push({
        phase: "request",
        method: request.method(),
        url: request.url(),
        resourceType: request.resourceType(),
        timestamp: new Date().toISOString(),
      });
    });
    page.on("response", (response) => {
      state.network.push({
        phase: "response",
        status: response.status(),
        url: response.url(),
        timestamp: new Date().toISOString(),
      });
    });
    if (session.viewport) await page.setViewport(session.viewport);
    if (session.recording === "full") {
      await this.startRecording(session, state);
    }
    if (session.url && session.metadata?.driver === "puppeteer") {
      await page.goto(session.url, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
    }
    return { metadata: { ...session.metadata, driver: "puppeteer" } };
  }

  async close(session: BrowserSession): Promise<void> {
    const state = this.states.get(session.id);
    if (!state) return;
    this.states.delete(session.id);
    if (state.recorder) await state.recorder.stop();
    await state.browser.close();
  }

  async navigate(session: BrowserSession, url: string) {
    const page = this.require(session.id).page;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    return { url: page.url(), title: await page.title() };
  }

  async goBack(session: BrowserSession) {
    const page = this.require(session.id).page;
    await page.goBack({ waitUntil: "domcontentloaded", timeout: 30_000 });
    return { url: page.url(), title: await page.title() };
  }

  async goForward(session: BrowserSession) {
    const page = this.require(session.id).page;
    await page.goForward({ waitUntil: "domcontentloaded", timeout: 30_000 });
    return { url: page.url(), title: await page.title() };
  }

  async reload(session: BrowserSession) {
    const page = this.require(session.id).page;
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    return { url: page.url(), title: await page.title() };
  }

  async screenshot(session: BrowserSession) {
    const data = await this.require(session.id).page.screenshot({
      encoding: "base64",
      type: "png",
      fullPage: true,
    });
    return { data: String(data), mediaType: "image/png" as const };
  }

  domSnapshot(session: BrowserSession): Promise<string> {
    return this.require(session.id).page.content();
  }

  async consoleLogs(session: BrowserSession): Promise<unknown[]> {
    return this.require(session.id).console.splice(0);
  }

  async networkRequests(session: BrowserSession): Promise<unknown[]> {
    return this.require(session.id).network.splice(0);
  }

  setViewport(
    session: BrowserSession,
    viewport: NonNullable<BrowserSession["viewport"]>,
  ): Promise<void> {
    return this.require(session.id).page.setViewport(viewport);
  }

  async setRecording(
    session: BrowserSession,
    recording: BrowserSession["recording"],
  ): Promise<Partial<BrowserSession>> {
    const state = this.require(session.id);
    if (recording === "full" && !state.recorder) {
      await this.startRecording(session, state);
    } else if (recording !== "full" && state.recorder) {
      await state.recorder.stop();
      state.recorder = undefined;
    }
    return {
      metadata: {
        ...session.metadata,
        recordingPath: state.recordingPath,
        recordingFormat: state.recordingPath ? "video/webm" : undefined,
      },
    };
  }

  async click(
    session: BrowserSession,
    target: { selector?: string; x?: number; y?: number },
  ) {
    const page = this.require(session.id).page;
    if (target.selector) {
      await page.waitForSelector(target.selector, {
        visible: true,
        timeout: 30_000,
      });
      await page.click(target.selector);
    } else {
      await page.mouse.click(target.x!, target.y!);
    }
    return this.pageDetails(page);
  }

  async typeText(
    session: BrowserSession,
    request: { selector?: string; text: string; replace?: boolean },
  ) {
    const page = this.require(session.id).page;
    if (request.selector) {
      await page.waitForSelector(request.selector, {
        visible: true,
        timeout: 30_000,
      });
      await page.click(request.selector, {
        clickCount: request.replace ? 3 : 1,
      });
      if (request.replace) await page.keyboard.press("Backspace");
    }
    await page.keyboard.type(request.text);
    return this.pageDetails(page);
  }

  async pressKey(session: BrowserSession, key: string) {
    const page = this.require(session.id).page;
    await page.keyboard.press(key as KeyInput);
    return this.pageDetails(page);
  }

  async scroll(session: BrowserSession, deltaX: number, deltaY: number) {
    const page = this.require(session.id).page;
    await page.evaluate(({ x, y }) => window.scrollBy(x, y), {
      x: deltaX,
      y: deltaY,
    });
    return this.pageDetails(page);
  }

  async wait(
    session: BrowserSession,
    request: { selector?: string; milliseconds?: number },
  ) {
    const page = this.require(session.id).page;
    if (request.selector) {
      await page.waitForSelector(request.selector, {
        visible: true,
        timeout: request.milliseconds ?? 30_000,
      });
    } else {
      await new Promise((resolve) =>
        setTimeout(resolve, request.milliseconds ?? 1_000),
      );
    }
    return this.pageDetails(page);
  }

  private async startRecording(
    session: BrowserSession,
    state: BrowserState,
  ): Promise<void> {
    const recordingDirectory =
      typeof session.metadata?.recordingDirectory === "string"
        ? session.metadata.recordingDirectory
        : path.join(os.tmpdir(), "qivryn-browser-recordings");
    await mkdir(recordingDirectory, { recursive: true });
    const recordingPath = path.join(
      recordingDirectory,
      `${session.id}.webm`,
    ) as `${string}.webm`;
    state.recordingPath = recordingPath;
    state.recorder = await state.page.screencast({
      path: recordingPath,
      ffmpegPath:
        typeof session.metadata?.ffmpegPath === "string"
          ? session.metadata.ffmpegPath
          : undefined,
    });
  }

  private require(sessionId: string): BrowserState {
    const state = this.states.get(sessionId);
    if (!state) {
      throw new Error(
        "Browser driver is not connected. Close this session and create a new one.",
      );
    }
    return state;
  }

  private async pageDetails(page: Page) {
    return { url: page.url(), title: await page.title() };
  }
}
