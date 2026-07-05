import type { ReviewFinding } from "@qivryn/agent-runtime";
import type { ReviewReport } from "@qivryn/review-engine";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Core } from "core/core";
import * as vscode from "vscode";

const REVIEW_SCHEME = "qivryn-review";

export class NativeReviewEditor implements vscode.Disposable {
  private readonly documents = new Map<string, string>();
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  private activeReport?: ReviewReport;
  private readonly registration: vscode.Disposable;

  constructor(
    context: vscode.ExtensionContext,
    private readonly core: Core,
  ) {
    this.registration = vscode.workspace.registerTextDocumentContentProvider(
      REVIEW_SCHEME,
      {
        onDidChange: this.changed.event,
        provideTextDocumentContent: (uri) =>
          this.documents.get(uri.toString()) ?? "",
      },
    );
    context.subscriptions.push(this, this.registration, this.changed);
  }

  dispose(): void {
    this.documents.clear();
  }

  async open(reportId?: string): Promise<void> {
    let report = reportId
      ? await this.core.invoke("reviews/get", { reportId })
      : await this.chooseReport();
    if (!report) report = await this.runFastReview();
    if (!report) return;
    this.activeReport = report;
    if (report.status !== "completed") {
      void vscode.window.showInformationMessage(
        report.error ?? `Review is ${report.status}`,
      );
      return;
    }
    const resources = await this.reviewResources(report);
    if (resources.length === 0) {
      void vscode.window.showInformationMessage(
        report.summary ?? "Qivryn found no review issues.",
      );
      return;
    }
    await vscode.commands.executeCommand(
      "vscode.changes",
      `Qivryn Review · ${path.basename(report.repositoryPath)}`,
      resources,
    );
    await vscode.commands.executeCommand(
      "setContext",
      "qivryn.activeReview",
      report.id,
    );
  }

  async accept(): Promise<void> {
    const finding = await this.chooseFinding("Accept review finding");
    if (!finding || !this.activeReport) return;
    if (finding.proposedPatch) {
      await this.core.invoke("reviews/action", {
        action: "fix",
        reportId: this.activeReport.id,
        findingId: finding.id,
      });
    } else {
      await this.core.invoke("reviews/action", {
        action: "status",
        reportId: this.activeReport.id,
        findingId: finding.id,
        status: "fixed",
      });
    }
    await this.open(this.activeReport.id);
  }

  async reject(): Promise<void> {
    const finding = await this.chooseFinding("Dismiss review finding");
    if (!finding || !this.activeReport) return;
    await this.core.invoke("reviews/action", {
      action: "status",
      reportId: this.activeReport.id,
      findingId: finding.id,
      status: "dismissed",
    });
    await this.open(this.activeReport.id);
  }

  async comment(): Promise<void> {
    const finding = await this.chooseFinding("Comment on review finding");
    if (!finding) return;
    const body = await vscode.window.showInputBox({
      title: finding.title,
      prompt: "Add a review comment",
      ignoreFocusOut: true,
    });
    if (!body?.trim()) return;
    await this.core.invoke("reviews/action", {
      action: "comment",
      findingId: finding.id,
      body: body.trim(),
    });
  }

  private async chooseReport(): Promise<ReviewReport | undefined> {
    const reports = await this.core.invoke("reviews/list", undefined);
    if (reports.length === 0) return undefined;
    const selected = await vscode.window.showQuickPick(
      [...reports]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((report) => ({
          label: `${path.basename(report.repositoryPath)} · ${report.status}`,
          description: `${report.findings.length} findings`,
          detail: report.summary ?? report.request.target.type,
          report,
        })),
      { title: "Open Qivryn Review", placeHolder: "Choose a review" },
    );
    return selected?.report;
  }

  private async runFastReview(): Promise<ReviewReport | undefined> {
    const repositoryPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!repositoryPath) {
      void vscode.window.showErrorMessage(
        "Open a repository to start a review.",
      );
      return undefined;
    }
    return this.core.invoke("reviews/run", {
      repositoryPath,
      request: {
        id: randomUUID(),
        mode: "fast",
        target: { type: "working-tree" },
      },
      analyzerIds: ["builtin.diff-safety"],
    });
  }

  private async reviewResources(
    report: ReviewReport,
  ): Promise<Array<[vscode.Uri, vscode.Uri, vscode.Uri]>> {
    const repository = gitRepositoryFor(report.repositoryPath);
    const filepaths = [
      ...new Set(
        report.findings
          .filter((finding) => finding.status === "open")
          .map((finding) => finding.filepath),
      ),
    ];
    const resources: Array<[vscode.Uri, vscode.Uri, vscode.Uri]> = [];
    for (const filepath of filepaths) {
      const modified = vscode.Uri.file(
        path.join(report.repositoryPath, filepath),
      );
      const original = vscode.Uri.from({
        scheme: REVIEW_SCHEME,
        authority: report.id,
        path: `/${filepath}`,
        query: "base=HEAD",
      });
      let content = "";
      try {
        content = repository ? await repository.show("HEAD", filepath) : "";
      } catch {
        // New files have no HEAD version and intentionally use an empty base.
      }
      this.documents.set(original.toString(), content);
      this.changed.fire(original);
      resources.push([modified, original, modified]);
    }
    return resources;
  }

  private async chooseFinding(
    title: string,
  ): Promise<ReviewFinding | undefined> {
    if (!this.activeReport) {
      void vscode.window.showInformationMessage("Open a Qivryn review first.");
      return undefined;
    }
    const findings = this.activeReport.findings.filter(
      (finding) => finding.status === "open",
    );
    const selected = await vscode.window.showQuickPick(
      findings.map((finding) => ({
        label: finding.title,
        description: `${finding.severity} · ${finding.filepath}:${finding.startLine}`,
        detail: finding.body,
        finding,
      })),
      { title },
    );
    return selected?.finding;
  }
}

function gitRepositoryFor(
  repositoryPath: string,
): { show(ref: string, filepath: string): Promise<string> } | undefined {
  const api = vscode.extensions
    .getExtension("vscode.git")
    ?.exports?.getAPI?.(1);
  return api?.repositories?.find(
    (candidate: { rootUri: vscode.Uri }) =>
      path.resolve(candidate.rootUri.fsPath) === path.resolve(repositoryPath),
  );
}
