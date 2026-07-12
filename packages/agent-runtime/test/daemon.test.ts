import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_DAEMON_PROTOCOL_VERSION,
  connectAgentDaemon,
} from "../src/daemon.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(cleanup.splice(0).map((dispose) => dispose()));
});

describe("agent daemon protocol migration", () => {
  it("uses the current hooks and read-only transport compatible protocol", () => {
    expect(AGENT_DAEMON_PROTOCOL_VERSION).toBe(6);
  });

  it("terminates a healthy version-2 worker instead of reusing it", async () => {
    const fixture = await daemonFixture(2);
    const kill = vi
      .spyOn(process, "kill")
      .mockImplementation((() => true) as typeof process.kill);

    await expect(
      connectAgentDaemon(fixture.descriptor),
    ).resolves.toBeUndefined();
    expect(kill).toHaveBeenCalledWith(fixture.pid, "SIGTERM");
    await expect(access(fixture.descriptor)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("connects to a healthy current-protocol worker", async () => {
    const fixture = await daemonFixture(AGENT_DAEMON_PROTOCOL_VERSION);
    const kill = vi
      .spyOn(process, "kill")
      .mockImplementation((() => true) as typeof process.kill);

    await expect(connectAgentDaemon(fixture.descriptor)).resolves.toBeDefined();
    expect(kill).not.toHaveBeenCalled();
  });

  it("removes a dead current-protocol descriptor so the bundled worker can respawn", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "qivryn-daemon-dead-"),
    );
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const descriptor = path.join(directory, "daemon.json");
    await writeFile(
      descriptor,
      JSON.stringify({
        baseUrl: "http://127.0.0.1:1",
        token: "dead-token",
        pid: 424_242,
        createdAt: new Date().toISOString(),
        protocolVersion: AGENT_DAEMON_PROTOCOL_VERSION,
      }),
    );
    vi.spyOn(process, "kill").mockImplementation(((pid, signal) => {
      if (signal === 0)
        throw Object.assign(new Error("missing"), { code: "ESRCH" });
      return true;
    }) as typeof process.kill);

    await expect(connectAgentDaemon(descriptor)).resolves.toBeUndefined();
    await expect(access(descriptor)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

async function daemonFixture(protocolVersion: number) {
  const token = "fixture-token";
  const server = createServer((request, response) => {
    if (
      request.url !== "/health" ||
      request.headers.authorization !== `Bearer ${token}`
    ) {
      response.writeHead(401).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ state: "ready" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  );
  const directory = await mkdtemp(path.join(os.tmpdir(), "qivryn-daemon-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const address = server.address() as AddressInfo;
  const descriptor = path.join(directory, "daemon.json");
  const pid = 424_242;
  await writeFile(
    descriptor,
    JSON.stringify({
      baseUrl: `http://127.0.0.1:${address.port}`,
      token,
      pid,
      createdAt: new Date().toISOString(),
      protocolVersion,
    }),
  );
  return { descriptor, pid };
}
