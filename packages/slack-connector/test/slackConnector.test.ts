import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  SlackApiClient,
  SlackAuthorization,
  SlackCredentialStore,
} from "../src/contracts.js";
import { FileSlackCredentialStore } from "../src/fileStore.js";
import { SlackConnectorService } from "../src/service.js";

class MemoryCredentials implements SlackCredentialStore {
  authorization?: SlackAuthorization;
  token?: string;
  async initialize() {}
  async getAuthorization() {
    return this.authorization;
  }
  async saveAuthorization(value: SlackAuthorization) {
    this.authorization = value;
  }
  async getToken() {
    return this.token;
  }
  async saveToken(value: string) {
    this.token = value;
  }
  async clear() {
    this.authorization = undefined;
    this.token = undefined;
  }
}

function api(): SlackApiClient {
  return {
    authenticate: vi.fn(async () => ({
      workspaceId: "T1",
      workspaceName: "Qivryn",
    })),
    listChannels: vi.fn(async () => [
      { id: "C1", name: "engineering" },
      { id: "C2", name: "private" },
    ]),
    readMessages: vi.fn(async (_token, channelId) => [
      { channelId, timestamp: "1.0", text: "Build passed" },
    ]),
    postMessage: vi.fn(async (_token, channelId, text, threadTimestamp) => ({
      channelId,
      timestamp: "2.0",
      text,
      threadTimestamp,
    })),
  };
}

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("SlackConnectorService", () => {
  it("requires explicit channel authorization and defaults to read-only", async () => {
    const credentials = new MemoryCredentials();
    const client = api();
    const service = new SlackConnectorService(credentials, client);
    const authorization = await service.authorize({
      token: "xoxb-secret",
      channelIds: ["C1", "C1"],
    });
    expect(authorization).toMatchObject({
      workspaceId: "T1",
      channelIds: ["C1"],
      allowRead: true,
      allowWrite: false,
    });
    expect(await service.channels()).toEqual([
      { id: "C1", name: "engineering" },
    ]);
    expect(await service.messages("C1")).toHaveLength(1);
    await expect(service.messages("C2")).rejects.toThrow(/allowlist/);
    await expect(service.post("C1", "Deploy now")).rejects.toThrow(
      /write access/,
    );
  });

  it("posts only after explicit write authorization and supports revoke", async () => {
    const credentials = new MemoryCredentials();
    const client = api();
    const service = new SlackConnectorService(credentials, client);
    await service.authorize({
      token: "xoxb-secret",
      channelIds: ["C1"],
      allowWrite: true,
    });
    expect(await service.post("C1", " Deploy complete ", "1.0")).toMatchObject({
      channelId: "C1",
      text: "Deploy complete",
      threadTimestamp: "1.0",
    });
    await service.revoke();
    expect(await service.status()).toBeUndefined();
    await expect(service.messages("C1")).rejects.toThrow(/not authorized/);
  });

  it("stores tokens separately with owner-only file permissions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qivryn-slack-"));
    roots.push(root);
    const store = new FileSlackCredentialStore(root);
    await store.saveToken("xoxb-secret");
    expect(await store.getToken()).toBe("xoxb-secret");
    if (process.platform !== "win32") {
      expect((await stat(path.join(root, "token"))).mode & 0o777).toBe(0o600);
    }
  });
});
