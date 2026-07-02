import { FileAgentStore, type AgentRun } from "@qivryn/agent-runtime";
import { getQivrynGlobalPath } from "core/util/paths";
import path from "node:path";
import * as vscode from "vscode";
import { worktreeDecorationForFile } from "./worktreeDecorationPolicy";

const COLORS = [
  "charts.blue",
  "charts.green",
  "charts.purple",
  "charts.orange",
  "charts.yellow",
  "charts.red",
];

export class AgentWorktreeDecorationProvider
  implements vscode.FileDecorationProvider, vscode.Disposable
{
  private readonly emitter = new vscode.EventEmitter<
    vscode.Uri | vscode.Uri[]
  >();
  readonly onDidChangeFileDecorations = this.emitter.event;
  private readonly store = new FileAgentStore(
    path.join(getQivrynGlobalPath(), "agents"),
  );
  private runs: AgentRun[] = [];
  private readonly timer: NodeJS.Timeout;

  constructor() {
    this.timer = setInterval(() => void this.refreshSafely(), 2_000);
    this.timer.unref();
    void this.refreshSafely();
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== "file") return undefined;
    const match = worktreeDecorationForFile(uri.fsPath, this.runs);
    if (!match) return undefined;
    return {
      badge: "A",
      color: new vscode.ThemeColor(COLORS[match.colorIndex]),
      tooltip: `Agent worktree · ${match.branch ?? "detached"} · ${match.title}`,
      propagate: true,
    };
  }

  dispose(): void {
    clearInterval(this.timer);
    this.emitter.dispose();
  }

  private async refreshSafely(): Promise<void> {
    try {
      await this.refresh();
    } catch (error) {
      console.warn("Failed to refresh Qivryn worktree decorations", error);
    }
  }

  private async refresh(): Promise<void> {
    await this.store.initialize();
    const next = await this.store.listRuns({
      includeArchived: false,
      limit: 200,
    });
    const signature = next
      .map(
        (run) =>
          `${run.id}:${run.updatedAt}:${run.workspace.worktreePath ?? ""}`,
      )
      .join("|");
    const previous = this.runs
      .map(
        (run) =>
          `${run.id}:${run.updatedAt}:${run.workspace.worktreePath ?? ""}`,
      )
      .join("|");
    if (signature === previous) return;
    this.runs = next;
    this.emitter.fire([]);
  }
}
