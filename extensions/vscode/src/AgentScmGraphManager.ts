import { FileAgentStore } from "@qivryn/agent-runtime";
import { getQivrynGlobalPath } from "core/util/paths";
import path from "node:path";
import * as vscode from "vscode";
import { activeAgentScmEntries } from "./agentScmPolicy";
import type { GitExtension } from "./otherExtensions/git";

export class AgentScmGraphManager implements vscode.Disposable {
  private readonly store = new FileAgentStore(
    path.join(getQivrynGlobalPath(), "agents"),
  );
  private readonly opened = new Set<string>();
  private readonly timer: NodeJS.Timeout;

  constructor() {
    this.timer = setInterval(() => void this.refreshSafely(), 2_000);
    this.timer.unref();
    void this.refreshSafely();
  }

  dispose(): void {
    clearInterval(this.timer);
  }

  async openGraph(): Promise<void> {
    await this.refresh();
    await vscode.commands.executeCommand("workbench.view.scm");
  }

  private async refreshSafely(): Promise<void> {
    try {
      await this.refresh();
    } catch (error) {
      console.warn("Failed to refresh Qivryn agent repositories", error);
    }
  }

  private async refresh(): Promise<void> {
    await this.store.initialize();
    const runs = await this.store.listRuns({
      includeArchived: false,
      limit: 200,
    });
    const entries = activeAgentScmEntries(runs);
    await vscode.commands.executeCommand(
      "setContext",
      "qivryn.agentWorktrees",
      entries,
    );
    const extension =
      vscode.extensions.getExtension<GitExtension>("vscode.git");
    if (!extension) return;
    if (!extension.isActive) await extension.activate();
    if (!extension.exports.enabled) return;
    const git = extension.exports.getAPI(1);
    for (const { root: worktree } of entries) {
      if (this.opened.has(worktree)) continue;
      const repository = await git.openRepository(vscode.Uri.file(worktree));
      if (repository) this.opened.add(worktree);
    }
    await vscode.commands.executeCommand(
      "setContext",
      "qivryn.hasAgentRepositories",
      this.opened.size > 0,
    );
  }
}
