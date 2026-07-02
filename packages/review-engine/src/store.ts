import type {
  ReviewFindingComment,
  ReviewFindingFeedback,
  ReviewReport,
} from "./contracts.js";

export interface ReviewStore {
  initialize(): Promise<void>;
  saveReport(
    report: ReviewReport,
    expectedRevision?: number,
  ): Promise<ReviewReport>;
  getReport(reportId: string): Promise<ReviewReport | undefined>;
  listReports(): Promise<ReviewReport[]>;
  saveComment(comment: ReviewFindingComment): Promise<void>;
  listComments(findingId: string): Promise<ReviewFindingComment[]>;
  saveFeedback(feedback: ReviewFindingFeedback): Promise<void>;
  getFeedback(findingId: string): Promise<ReviewFindingFeedback | undefined>;
}

export class ReviewStoreConflictError extends Error {
  constructor(reportId: string) {
    super(`Review report ${reportId} was updated by another process`);
    this.name = "ReviewStoreConflictError";
  }
}
