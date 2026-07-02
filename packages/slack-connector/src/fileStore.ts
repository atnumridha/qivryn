import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SlackAuthorization, SlackCredentialStore } from "./contracts.js";

export class FileSlackCredentialStore implements SlackCredentialStore {
  private readonly authorizationPath: string;
  private readonly tokenPath: string;

  constructor(private readonly rootDirectory: string) {
    this.authorizationPath = path.join(rootDirectory, "authorization.json");
    this.tokenPath = path.join(rootDirectory, "token");
  }

  async initialize(): Promise<void> {
    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
  }

  async getAuthorization(): Promise<SlackAuthorization | undefined> {
    try {
      return JSON.parse(await readFile(this.authorizationPath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async saveAuthorization(authorization: SlackAuthorization): Promise<void> {
    await this.initialize();
    await writeFile(
      this.authorizationPath,
      `${JSON.stringify(authorization, null, 2)}\n`,
      { mode: 0o600 },
    );
  }

  async getToken(): Promise<string | undefined> {
    try {
      return (await readFile(this.tokenPath, "utf8")).trim() || undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async saveToken(token: string): Promise<void> {
    const value = token.trim();
    if (!value) throw new Error("Slack token cannot be empty");
    await this.initialize();
    await writeFile(this.tokenPath, `${value}\n`, { mode: 0o600 });
  }

  async clear(): Promise<void> {
    await Promise.all([
      rm(this.authorizationPath, { force: true }),
      rm(this.tokenPath, { force: true }),
    ]);
  }
}
