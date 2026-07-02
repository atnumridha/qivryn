import type { ReviewFinding, ReviewRequest } from "@continuedev/agent-runtime";

export interface ReviewDiff {
  repositoryPath: string;
  baseLabel: string;
  diff: string;
  changedFiles: string[];
  generatedAt: string;
}

export interface ReviewReport {
  id: string;
  repositoryPath: string;
  request: ReviewRequest;
  status: "queued" | "running" | "completed" | "failed" | "canceled";
  createdAt: string;
  updatedAt: string;
  findings: ReviewFinding[];
  analyzerIds: string[];
  summary?: string;
  error?: string;
  revision: number;
}

export interface ReviewFixResult {
  report: ReviewReport;
  verification: ReviewReport;
}

export interface ReviewAnalyzerContext {
  request: ReviewRequest;
  source: ReviewDiff;
  signal: AbortSignal;
}

export interface ReviewAnalyzer {
  id: string;
  analyze(context: ReviewAnalyzerContext): Promise<ReviewFinding[]>;
}

export interface CreateReviewRequest {
  repositoryPath: string;
  request: ReviewRequest;
  analyzerIds?: string[];
}

export interface ReviewFindingComment {
  id: string;
  findingId: string;
  createdAt: string;
  body: string;
  author: "user" | "agent";
}

export interface ReviewFindingFeedback {
  findingId: string;
  value: "up" | "down";
  createdAt: string;
}

export type ReviewActionRequest =
  | {
      action: "status";
      reportId: string;
      findingId: string;
      status: ReviewFinding["status"];
    }
  | { action: "comment"; findingId: string; body: string }
  | { action: "feedback"; findingId: string; value: "up" | "down" }
  | { action: "reanchor"; reportId: string; findingId: string }
  | { action: "fix"; reportId: string; findingId: string };

export type ReviewActionResult =
  | ReviewReport
  | ReviewFinding
  | ReviewFindingComment
  | ReviewFindingFeedback
  | ReviewFixResult;
