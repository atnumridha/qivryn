import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  BrowserPermissionGrant,
  BrowserPermissionPolicy,
  BrowserPermissionRequest,
} from "./contracts.js";

export class FileBrowserPermissionPolicy implements BrowserPermissionPolicy {
  constructor(private readonly file: string) {}

  async authorize(request: BrowserPermissionRequest): Promise<boolean> {
    if (request.actor === "user") return true;
    const now = Date.now();
    return (await this.list(request.session.id)).some(
      (grant) =>
        grant.actor === request.actor &&
        grant.action === request.action &&
        (!grant.origin || grant.origin === request.origin) &&
        (!grant.expiresAt || Date.parse(grant.expiresAt) > now),
    );
  }

  async list(sessionId?: string): Promise<BrowserPermissionGrant[]> {
    const grants = await this.read();
    return sessionId
      ? grants.filter((grant) => grant.sessionId === sessionId)
      : grants;
  }

  async grant(
    input: Omit<BrowserPermissionGrant, "id" | "createdAt">,
  ): Promise<BrowserPermissionGrant> {
    const grant = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    await this.write([...(await this.read()), grant]);
    return grant;
  }

  async revoke(grantId: string): Promise<void> {
    await this.write(
      (await this.read()).filter((grant) => grant.id !== grantId),
    );
  }

  private async read(): Promise<BrowserPermissionGrant[]> {
    try {
      return JSON.parse(
        await readFile(this.file, "utf8"),
      ) as BrowserPermissionGrant[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async write(grants: BrowserPermissionGrant[]): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(grants, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, this.file);
  }
}
