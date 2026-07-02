import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  createSmokeContext,
  cleanupSmokeContext,
  writeQivrynProxyConfig,
  runHeadless,
  type SmokeTestContext,
} from "./smoke-api-helpers.js";

const QIVRYN_API_KEY = process.env.QIVRYN_API_KEY;
// qivryn-proxy requires a 4-part model name (owner/package/provider/model)
// that depends on org-specific proxy configuration, so we also require
// SMOKE_PROXY_MODEL to be set (e.g. "qivryn/default/anthropic/claude-3-haiku-20240307")
const SMOKE_PROXY_MODEL = process.env.SMOKE_PROXY_MODEL;

describe.skipIf(!QIVRYN_API_KEY || !SMOKE_PROXY_MODEL)(
  "Smoke: Headless → real Qivryn proxy",
  () => {
    let ctx: SmokeTestContext;

    beforeEach(async () => {
      ctx = await createSmokeContext();
      await writeQivrynProxyConfig(ctx, QIVRYN_API_KEY!);
    });

    afterEach(async () => {
      await cleanupSmokeContext(ctx);
    });

    it("should complete a round-trip and return a response", async () => {
      const result = await runHeadless(ctx, [
        "-p",
        "--config",
        ctx.configPath,
        "Reply with exactly the word 'hello' and nothing else.",
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout.toLowerCase()).toContain("hello");
    });
  },
);
