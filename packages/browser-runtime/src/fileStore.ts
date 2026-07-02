import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BrowserEvent, BrowserSession } from "@qivryn/agent-runtime";
import type { BrowserStore } from "./contracts.js";

interface BrowserState {
  sessions: BrowserSession[];
  events: BrowserEvent[];
}

const EMPTY: BrowserState = { sessions: [], events: [] };

export class FileBrowserStore implements BrowserStore {
  private readonly statePath: string;
  private readonly lockPath: string;

  constructor(private readonly rootDirectory: string) {
    this.statePath = path.join(rootDirectory, "browser.json");
    this.lockPath = path.join(rootDirectory, ".browser.lock");
  }

  async initialize(): Promise<void> {
    await mkdir(this.rootDirectory, { recursive: true });
    try {
      await readFile(this.statePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.write(EMPTY);
    }
  }

  async saveSession(session: BrowserSession): Promise<BrowserSession> {
    return this.mutate((state) => {
      const saved = structuredClone(session);
      const index = state.sessions.findIndex((item) => item.id === session.id);
      if (index >= 0) state.sessions[index] = saved;
      else state.sessions.push(saved);
      return saved;
    });
  }

  async getSession(sessionId: string): Promise<BrowserSession | undefined> {
    const session = (await this.read()).sessions.find(
      (item) => item.id === sessionId,
    );
    return session ? structuredClone(session) : undefined;
  }

  async listSessions(): Promise<BrowserSession[]> {
    return (await this.read()).sessions
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((session) => structuredClone(session));
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.mutate((state) => {
      state.sessions = state.sessions.filter((item) => item.id !== sessionId);
      return undefined;
    });
  }

  async appendEvent(
    event: Omit<BrowserEvent, "id" | "sequence">,
  ): Promise<BrowserEvent> {
    return this.mutate((state) => {
      const sequence =
        (state.events
          .filter((item) => item.sessionId === event.sessionId)
          .at(-1)?.sequence ?? 0) + 1;
      const saved: BrowserEvent = {
        ...structuredClone(event),
        id: randomUUID(),
        sequence,
      };
      state.events.push(saved);
      return saved;
    });
  }

  async readEvents(
    sessionId: string,
    afterSequence = 0,
  ): Promise<BrowserEvent[]> {
    return (await this.read()).events
      .filter(
        (event) =>
          event.sessionId === sessionId && event.sequence > afterSequence,
      )
      .map((event) => structuredClone(event));
  }

  private async read(): Promise<BrowserState> {
    await this.initialize();
    return JSON.parse(await readFile(this.statePath, "utf8")) as BrowserState;
  }

  private async write(state: BrowserState): Promise<void> {
    const temporary = `${this.statePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temporary, this.statePath);
  }

  private async mutate<T>(operation: (state: BrowserState) => T): Promise<T> {
    await this.initialize();
    const startedAt = Date.now();
    while (true) {
      try {
        const handle = await open(this.lockPath, "wx");
        try {
          const state = await this.read();
          const value = operation(state);
          await this.write(state);
          return value;
        } finally {
          await handle.close();
          await rm(this.lockPath, { force: true });
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (Date.now() - startedAt > 5_000)
          throw new Error("Timed out acquiring browser store lock");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
  }
}
