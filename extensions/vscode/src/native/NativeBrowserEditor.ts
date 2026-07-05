import type { BrowserSession } from "@qivryn/agent-runtime";
import type { Core } from "core/core";
import * as vscode from "vscode";

export class NativeBrowserEditor {
  private activeSession?: BrowserSession;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly core: Core,
  ) {}

  async open(url?: string): Promise<void> {
    let session: BrowserSession | undefined;
    if (url) {
      session = await this.create(url);
    } else {
      const sessions = await this.core.invoke("browser/list", undefined);
      const selected = await vscode.window.showQuickPick(
        [
          {
            label: "$(add) New browser session",
            description: "Open a URL in Qivryn",
          },
          ...sessions.map((candidate) => ({
            label: candidate.title || candidate.url || "Browser session",
            description: candidate.url,
            detail:
              candidate.recording === "off" ? undefined : "Recording enabled",
            session: candidate,
          })),
        ],
        { title: "Qivryn Browser", placeHolder: "Open or create a session" },
      );
      if (!selected) return;
      session = "session" in selected ? selected.session : undefined;
      if (!session) {
        const input = await vscode.window.showInputBox({
          title: "New Qivryn Browser Session",
          prompt: "Enter a URL",
          value: "http://localhost:3000",
          ignoreFocusOut: true,
        });
        if (!input?.trim()) return;
        session = await this.create(input.trim());
      }
    }
    if (!session?.url) return;
    this.activeSession = session;
    await Promise.all([
      vscode.commands.executeCommand("simpleBrowser.show", session.url),
      vscode.commands.executeCommand(
        "setContext",
        "qivryn.activeBrowserSession",
        session.id,
      ),
    ]);
  }

  back(): Promise<void> {
    return this.navigate("back");
  }

  forward(): Promise<void> {
    return this.navigate("forward");
  }

  reload(): Promise<void> {
    return this.navigate("reload");
  }

  async takeover(): Promise<void> {
    const session = this.requireActive();
    this.activeSession = (await this.core.invoke("browser/action", {
      action: "takeover",
      sessionId: session.id,
      actor: "user",
    })) as BrowserSession;
    void vscode.window.showInformationMessage(
      "You now control this browser session.",
    );
  }

  async screenshot(): Promise<void> {
    const session = this.requireActive();
    const result = (await this.core.invoke("browser/action", {
      action: "screenshot",
      sessionId: session.id,
      actor: "user",
    })) as { data?: string; mediaType?: string };
    if (!result?.data)
      throw new Error("The browser did not return a screenshot");
    const directory = vscode.Uri.joinPath(
      this.context.globalStorageUri,
      "browser-artifacts",
    );
    await vscode.workspace.fs.createDirectory(directory);
    const filepath = vscode.Uri.joinPath(
      directory,
      `${session.id}-${Date.now()}.png`,
    );
    await vscode.workspace.fs.writeFile(
      filepath,
      Uint8Array.from(Buffer.from(result.data, "base64")),
    );
    await vscode.commands.executeCommand("vscode.open", filepath);
  }

  private async create(url: string): Promise<BrowserSession> {
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return this.core.invoke("browser/create", {
      url: normalized,
      visible: true,
      recording: "events",
    });
  }

  private async navigate(action: "back" | "forward" | "reload"): Promise<void> {
    const session = this.requireActive();
    this.activeSession = (await this.core.invoke("browser/action", {
      action,
      sessionId: session.id,
      actor: "user",
    })) as BrowserSession;
    if (this.activeSession.url) {
      await vscode.commands.executeCommand(
        "simpleBrowser.show",
        this.activeSession.url,
      );
    }
  }

  private requireActive(): BrowserSession {
    if (!this.activeSession)
      throw new Error("Open a Qivryn browser session first");
    return this.activeSession;
  }
}
