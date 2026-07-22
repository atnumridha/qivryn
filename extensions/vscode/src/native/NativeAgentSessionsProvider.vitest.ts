import type { AgentRun } from "@qivryn/agent-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { NativeAgentSessionsProvider } from "./NativeAgentSessionsProvider";

const vscodeMock = vi.hoisted(() => ({
  registeredCommands: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock("vscode", () => ({
  commands: {
    executeCommand: vi.fn(),
    getCommands: vi.fn(),
    registerCommand: vi.fn(
      (command: string, handler: (...args: unknown[]) => unknown) => {
        vscodeMock.registeredCommands.set(command, handler);
        return { dispose: vi.fn() };
      },
    ),
  },
  Uri: class Uri {
    constructor(
      readonly scheme: string,
      readonly authority: string,
      readonly path: string,
    ) {}

    static from(value: { scheme: string; authority?: string; path?: string }) {
      return new Uri(value.scheme, value.authority ?? "", value.path ?? "");
    }

    static joinPath() {
      return new Uri("file", "", "/icon.png");
    }
  },
  ThemeIcon: class ThemeIcon {
    constructor(readonly id: string) {}
  },
  MarkdownString: class MarkdownString {
    constructor(readonly value: string) {}
  },
  window: {
    tabGroups: {
      all: [],
      close: vi.fn(),
    },
  },
  workspace: {
    workspaceFolders: [],
  },
}));

describe("NativeAgentSessionsProvider", () => {
  let provider: NativeAgentSessionsProvider | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    vscodeMock.registeredCommands.clear();
    vi.mocked(vscode.commands.executeCommand).mockImplementation(
      async (command: string, ...args: unknown[]) => {
        if (command === "getContextKeyValue") return false as never;
        if (command === "qivryn.openNativeAgent") {
          return vscodeMock.registeredCommands.get(command)?.(...args) as never;
        }
        return undefined as never;
      },
    );
    vi.mocked(vscode.commands.getCommands).mockResolvedValue([
      "workbench.action.chat.open",
    ] as never);
  });

  afterEach(() => {
    provider?.dispose();
    provider = undefined;
  });

  it("declines native restore when there is no restorable agent run", async () => {
    provider = createProvider([]);
    await Promise.resolve();
    vi.mocked(vscode.commands.executeCommand).mockClear();

    await expect(provider.restoreDefaultSurface()).resolves.toBe(false);

    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
      "workbench.action.chat.open",
    );
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
      "workbench.action.closeSidebar",
    );
  });

  it("opens the selected native agent run when one is available", async () => {
    provider = createProvider([run("run-42")]);
    await Promise.resolve();
    vi.mocked(vscode.commands.executeCommand).mockClear();

    await expect(provider.restoreDefaultSurface()).resolves.toBe(true);

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "qivryn.openNativeAgent",
      expect.objectContaining({
        scheme: "qivryn-agent",
        path: "/run-42",
      }),
    );
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "workbench.action.closeSidebar",
    );
  });

  function createProvider(runs: AgentRun[]): NativeAgentSessionsProvider {
    const context = createContext();
    const messenger = {
      externalRequest: vi.fn(async (method: string) => {
        if (method === "agents/list") return runs;
        if (method === "agents/events") return [];
        return undefined;
      }),
    };
    const chat = createChat();
    const Provider = NativeAgentSessionsProvider as unknown as {
      new (
        context: unknown,
        messenger: unknown,
        chat: unknown,
      ): NativeAgentSessionsProvider;
    };
    return new Provider(context, messenger, chat);
  }

  function createContext() {
    const workspaceValues = new Map<string, unknown>();
    const globalValues = new Map<string, unknown>();
    return {
      extensionUri: vscode.Uri.from({
        scheme: "file",
        path: "/extension",
      }),
      subscriptions: [],
      workspaceState: stateStore(workspaceValues),
      globalState: stateStore(globalValues),
    };
  }

  function stateStore(values: Map<string, unknown>) {
    return {
      get<T>(key: string): T | undefined {
        return values.get(key) as T | undefined;
      },
      async update(key: string, value: unknown) {
        values.set(key, value);
      },
    };
  }

  function createChat() {
    const controller = {
      dispose: vi.fn(),
      items: {
        replace: vi.fn(),
        add: vi.fn(),
        get: vi.fn(),
      },
      createChatSessionItem: vi.fn((resource, label) => ({
        resource,
        label,
      })),
      createChatSessionInputState: vi.fn((groups) => ({ groups })),
    };
    return {
      createChatParticipant: vi.fn(() => ({ dispose: vi.fn() })),
      createChatSessionItemController: vi.fn(() => controller),
      registerChatSessionContentProvider: vi.fn(() => ({ dispose: vi.fn() })),
    };
  }
});

function run(id: string): AgentRun {
  return {
    id,
    revision: 0,
    title: id,
    prompt: id,
    status: "completed",
    permissionMode: "autonomous",
    workspace: {
      id: "workspace",
      location: "local",
      repositoryPath: "/workspace",
    },
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
  };
}
