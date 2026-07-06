import type { TerminalJob } from "@qivryn/terminal-security";
import type { Core } from "core/core";
import * as vscode from "vscode";

class DurableJobPseudoterminal implements vscode.Pseudoterminal {
  private readonly writeEmitter = new vscode.EventEmitter<string>();
  private readonly closeEmitter = new vscode.EventEmitter<number | void>();
  readonly onDidWrite = this.writeEmitter.event;
  readonly onDidClose = this.closeEmitter.event;
  private offset = 0;

  constructor(
    private readonly jobId: string,
    private readonly core: Core,
  ) {}

  open(): void {
    void this.refresh();
  }

  close(): void {
    this.writeEmitter.dispose();
    this.closeEmitter.dispose();
  }

  handleInput(): void {
    this.writeEmitter.fire(
      "\r\nQivryn: this durable job is read-only; start an interactive terminal for stdin.\r\n",
    );
  }

  async refresh(): Promise<TerminalJob | undefined> {
    const output = await this.core.invoke("terminal/jobOutput", {
      jobId: this.jobId,
    });
    if (output.length > this.offset) {
      this.writeEmitter.fire(toTerminalText(output.slice(this.offset)));
      this.offset = output.length;
    }
    const jobs = await this.core.invoke("terminal/jobs", undefined);
    const job = jobs.find((candidate) => candidate.id === this.jobId);
    if (job && job.status !== "running") {
      this.writeEmitter.fire(
        `\r\n[Qivryn job ${job.status}${job.exitCode === undefined ? "" : ` · exit ${job.exitCode}`}]\r\n`,
      );
    }
    return job;
  }
}

export class NativeTerminalJobs implements vscode.Disposable {
  private activeJob?: TerminalJob;
  private activePty?: DurableJobPseudoterminal;
  private activeTerminal?: vscode.Terminal;
  private refreshTimer?: NodeJS.Timeout;

  constructor(
    context: vscode.ExtensionContext,
    private readonly core: Core,
  ) {
    context.subscriptions.push(this);
  }

  dispose(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.activeTerminal?.dispose();
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
    this.activeTerminal?.dispose();
    this.activeJob = job;
    this.activePty = new DurableJobPseudoterminal(job.id, this.core);
    this.activeTerminal = vscode.window.createTerminal({
      name: `Qivryn · ${job.command.slice(0, 40)}`,
      pty: this.activePty,
      iconPath: new vscode.ThemeIcon("terminal"),
    });
    this.activeTerminal.show(false);
    await vscode.commands.executeCommand(
      "setContext",
      "qivryn.activeTerminalJob",
      job.id,
    );
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = setInterval(() => void this.refresh(), 500);
    this.refreshTimer.unref?.();
  }

  private async refresh(): Promise<void> {
    if (!this.activeJob || !this.activePty) return;
    this.activeJob = await this.activePty.refresh();
    if (this.activeJob?.status !== "running" && this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }
}

function toTerminalText(value: string): string {
  return value.replace(/\r?\n/g, "\r\n");
}
