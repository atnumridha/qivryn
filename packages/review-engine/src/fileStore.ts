import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ReviewFindingComment,
  ReviewFindingFeedback,
  ReviewReport,
} from "./contracts.js";
import { type ReviewStore, ReviewStoreConflictError } from "./store.js";

interface ReviewState {
  reports: ReviewReport[];
  comments: ReviewFindingComment[];
  feedback: ReviewFindingFeedback[];
}

const EMPTY_STATE: ReviewState = { reports: [], comments: [], feedback: [] };

export class FileReviewStore implements ReviewStore {
  private readonly statePath: string;
  private readonly lockPath: string;

  constructor(private readonly rootDirectory: string) {
    this.statePath = path.join(rootDirectory, "reviews.json");
    this.lockPath = path.join(rootDirectory, ".reviews.lock");
  }

  async initialize(): Promise<void> {
    await mkdir(this.rootDirectory, { recursive: true });
    try {
      await readFile(this.statePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.writeState(EMPTY_STATE);
    }
  }

  async saveReport(
    report: ReviewReport,
    expectedRevision?: number,
  ): Promise<ReviewReport> {
    return this.mutate(async (state) => {
      const index = state.reports.findIndex(
        (candidate) => candidate.id === report.id,
      );
      if (
        expectedRevision !== undefined &&
        (index < 0 || state.reports[index].revision !== expectedRevision)
      ) {
        throw new ReviewStoreConflictError(report.id);
      }
      const saved = structuredClone({
        ...report,
        revision:
          expectedRevision === undefined
            ? report.revision
            : expectedRevision + 1,
      });
      if (index >= 0) state.reports[index] = saved;
      else state.reports.push(saved);
      return saved;
    });
  }

  async getReport(reportId: string): Promise<ReviewReport | undefined> {
    const report = (await this.readState()).reports.find(
      (candidate) => candidate.id === reportId,
    );
    return report ? structuredClone(report) : undefined;
  }

  async listReports(): Promise<ReviewReport[]> {
    return (await this.readState()).reports
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((report) => structuredClone(report));
  }

  async saveComment(comment: ReviewFindingComment): Promise<void> {
    await this.mutate(async (state) => {
      if (!state.comments.some((candidate) => candidate.id === comment.id)) {
        state.comments.push(structuredClone(comment));
      }
    });
  }

  async listComments(findingId: string): Promise<ReviewFindingComment[]> {
    return (await this.readState()).comments
      .filter((comment) => comment.findingId === findingId)
      .map((comment) => structuredClone(comment));
  }

  async saveFeedback(feedback: ReviewFindingFeedback): Promise<void> {
    await this.mutate(async (state) => {
      const index = state.feedback.findIndex(
        (candidate) => candidate.findingId === feedback.findingId,
      );
      if (index >= 0) state.feedback[index] = structuredClone(feedback);
      else state.feedback.push(structuredClone(feedback));
    });
  }

  async getFeedback(
    findingId: string,
  ): Promise<ReviewFindingFeedback | undefined> {
    const feedback = (await this.readState()).feedback.find(
      (candidate) => candidate.findingId === findingId,
    );
    return feedback ? structuredClone(feedback) : undefined;
  }

  private async readState(): Promise<ReviewState> {
    await this.initialize();
    return JSON.parse(await readFile(this.statePath, "utf8")) as ReviewState;
  }

  private async writeState(state: ReviewState): Promise<void> {
    const temporary = `${this.statePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temporary, this.statePath);
  }

  private async mutate<T>(
    operation: (state: ReviewState) => Promise<T>,
  ): Promise<T> {
    await this.initialize();
    const startedAt = Date.now();
    while (true) {
      try {
        const handle = await open(this.lockPath, "wx");
        try {
          const state = await this.readState();
          const result = await operation(state);
          await this.writeState(state);
          return result;
        } finally {
          await handle.close();
          await rm(this.lockPath, { force: true });
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (Date.now() - startedAt > 5_000) {
          throw new Error("Timed out acquiring review store lock");
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
  }
}
