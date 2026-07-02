import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TerminalJobService } from "../src/terminalJobs.js";

const roots: string[] = [];
afterEach(() =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  ),
);

describe("durable terminal jobs", () => {
  it("reopens persisted output after service restart", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qivryn-jobs-"));
    roots.push(root);
    const service = new TerminalJobService(root);
    await service.initialize();
    const job = await service.start("printf terminal-job", root);
    for (
      let attempt = 0;
      attempt < 100 && (await service.get(job.id))?.status === "running";
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const restored = new TerminalJobService(root);
    await restored.initialize();
    expect((await restored.get(job.id))?.status).toBe("completed");
    expect(await restored.output(job.id)).toBe("terminal-job");
  });

  it("stops background process groups", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qivryn-jobs-"));
    roots.push(root);
    const service = new TerminalJobService(root);
    await service.initialize();
    const job = await service.start("sleep 30", root);
    expect((await service.stop(job.id)).status).toBe("stopped");
  });
});
