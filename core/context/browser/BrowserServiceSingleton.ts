import type { BrowserSessionService } from "@qivryn/browser-runtime";

let service: BrowserSessionService | undefined;
let ready: Promise<void> | undefined;

export function registerBrowserService(
  nextService: BrowserSessionService,
  initialized: Promise<void>,
): void {
  service = nextService;
  ready = initialized;
}

export async function getBrowserService(): Promise<BrowserSessionService> {
  if (!service || !ready) {
    throw new Error("Browser runtime is not initialized");
  }
  await ready;
  return service;
}
