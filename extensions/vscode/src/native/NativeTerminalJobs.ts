import type { TerminalJob } from "@qivryn/terminal-security";
import type { Core } from "core/core";
import * as vscode from "vscode";

const TERMINAL_JOB_SCHEME = "qivryn-terminal-job";

export class NativeTerminalJobs implements vscode.Disposable {
  private readonly output = new Map<string, string>();
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  private activeJob?: TerminalJob;
  private activeUri?: vscode.Uri;
  private refreshTimer?: NodeJS.Timeout;

  constructor(
    context: vscode.ExtensionContext,
    private readonly core: Core,
  ) {
    const registration = vscode.workspace.registerTextDocumentContentProvider(
      TERMINAL_JOB_SCHEME,
      {
        onDidChange: this.changed.event,
        provideTextDocumentContent: (uri) =>
          this.output.get(uri.authority) ?? "",
      },
    );
    context.subscriptions.push(this, registration, this.changed);
  }

  dispose(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.output.clear();
  }

  async open(): Promise<void> {
    const jobs = await this.core.invoke("terminal/jobs", undefined);
    const selected = await vscode.window.showQuickPick(
      [
        {
          label: "$(add) New terminal job",
          description: "Run in the background",
        },
        ...jobs.map((job) => ({
          label: job.command,
          description: job.status,
          detail: job.cwd,
          job,
        })),
      ],
      { title: "Qivryn Terminal Jobs", placeHolder: "Open or start a job" },
    );
    if (!selected) return;
    const job = "job" in selected ? selected.job : await this.start();
    if (job) await this.show(job);
  }

  async stop(): Promise<void> {
    if (!this.activeJob) throw new Error("Open a terminal job first");
    this.activeJob = await this.core.invoke("terminal/jobStop", {
      jobId: this.activeJob.id,
    });
    await this.refresh();
  }

  private async start(): Promise<TerminalJob | undefined> {
    const command = await vscode.window.showInputBox({
      title: "Start Qivryn Terminal Job",
      prompt: "Enter a shell command",
      ignoreFocusOut: true,
    });
    if (!command?.trim()) return undefined;
    const cwd =
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    const classification = await this.core.invoke("terminal/classify", {
      command: command.trim(),
      basePolicy: "allowedWithoutPermission",
      sandboxed: false,
    });
    if (classification.policy === "disabled") {
      void vscode.window.showErrorMessage(
        `Qivryn blocked this command: ${classification.reasons.join("; ")}`,
      );
      return undefined;
    }
    if (
      classification.policy === "allowedWithPermission" ||
      classification.elevated ||
      classification.requiresNetwork ||
      classification.mutatesFilesystem
    ) {
      const decision = await vscode.window.showWarningMessage(
        classification.reasons.join("; ") ||
          "This command changes your system.",
        { modal: true, detail: command.trim() },
        "Run",
      );
      if (decision !== "Run") return undefined;
    }
    return this.core.invoke("terminal/jobStart", {
      command: command.trim(),
      cwd,
    });
  }

  private async show(job: TerminalJob): Promise<void> {
    this.activeJob = job;
    const uri = vscode.Uri.from({
      scheme: TERMINAL_JOB_SCHEME,
      authority: job.id,
      path: `/${encodeURIComponent(job.command.slice(0, 50))}.log`,
    });
    this.activeUri = uri;
    await this.refresh();
    await Promise.all([
      vscode.commands.executeCommand("vscode.open", uri, {
        preview: false,
        preserveFocus: false,
      }),
      vscode.commands.executeCommand(
        "setContext",
        "qivryn.activeTerminalJob",
        job.id,
      ),
    ]);
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(() => void this.refresh(), 1_000);
    this.refreshTimer.unref?.();
  }

  private async refresh(): Promise<void> {
    if (!this.activeJob) return;
    const output = await this.core.invoke("terminal/jobOutput", {
      jobId: this.activeJob.id,
    });
    this.output.set(this.activeJob.id, output);
    if (this.activeUri) this.changed.fire(this.activeUri);
    const jobs = await this.core.invoke("terminal/jobs", undefined);
    this.activeJob = jobs.find((job) => job.id === this.activeJob?.id);
    if (this.activeJob?.status !== "running" && this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }
}
