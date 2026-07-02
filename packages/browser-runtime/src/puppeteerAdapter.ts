import puppeteer, { type Browser, type Page } from "puppeteer";
import type { BrowserSession } from "@qivryn/agent-runtime";
import type { BrowserAdapter } from "./contracts.js";

interface BrowserState {
  browser: Browser;
  page: Page;
  console: unknown[];
  network: unknown[];
}

export class PuppeteerBrowserAdapter implements BrowserAdapter {
  private readonly states = new Map<string, BrowserState>();

  async create(session: BrowserSession): Promise<Partial<BrowserSession>> {
    if (this.states.has(session.id)) return {};
    const browser = await puppeteer.launch({
      headless: !session.visible,
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
    _session: BrowserSession,
    _recording: BrowserSession["recording"],
  ): Promise<void> {}

  private require(sessionId: string): BrowserState {
    const state = this.states.get(sessionId);
    if (!state) {
      throw new Error(
        "Browser driver is not connected. Close this session and create a new one.",
      );
    }
    return state;
  }
}
