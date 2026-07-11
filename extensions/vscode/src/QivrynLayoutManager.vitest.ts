import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { QivrynLayoutManager } from "./QivrynLayoutManager";
import { BUILT_IN_LAYOUTS, createCustomLayout } from "./layoutPresets";

vi.mock("vscode", () => ({
  commands: { executeCommand: vi.fn(), getCommands: vi.fn() },
  window: {
    showQuickPick: vi.fn(),
    showInputBox: vi.fn(),
    showInformationMessage: vi.fn(),
    tabGroups: { all: [] },
  },
}));

const CUSTOM_KEY = "qivryn.customLayouts";
const ACTIVE_KEY = "qivryn.activeLayout";

function createContext(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial));
  const workspaceState = {
    get<T>(key: string, fallback?: T): T | undefined {
      return (values.has(key) ? values.get(key) : fallback) as T | undefined;
    },
    async update(key: string, value: unknown) {
      values.set(key, value);
    },
  };
  return {
    context: { workspaceState } as unknown as vscode.ExtensionContext,
    values,
  };
}

describe("QivrynLayoutManager", () => {
  const state: Record<string, boolean> = {
    sideBarVisible: true,
    auxiliaryBarVisible: false,
    panelVisible: true,
    inZenMode: false,
  };
  const executed: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    (vscode.window.tabGroups.all as unknown as vscode.TabGroup[]).length = 0;
    delete process.env.QIVRYN_ENABLE_NATIVE_AGENT_SESSIONS;
    Object.assign(state, {
      sideBarVisible: true,
      auxiliaryBarVisible: false,
      panelVisible: true,
      inZenMode: false,
    });
    executed.length = 0;
    vi.mocked(vscode.commands.getCommands).mockResolvedValue([
      "workbench.action.openAgentsWindow",
      "getContextKeyValue",
    ]);
    vi.mocked(vscode.commands.executeCommand).mockImplementation(
      async (command: string, ...args: unknown[]) => {
        if (command === "getContextKeyValue") {
          return state[String(args[0])] as never;
        }
        executed.push(command);
        if (command === "workbench.action.toggleSidebarVisibility") {
          state.sideBarVisible = !state.sideBarVisible;
        } else if (command === "workbench.action.toggleAuxiliaryBar") {
          state.auxiliaryBarVisible = !state.auxiliaryBarVisible;
        } else if (command === "workbench.action.togglePanel") {
          state.panelVisible = !state.panelVisible;
        } else if (command === "workbench.action.toggleZenMode") {
          state.inZenMode = !state.inZenMode;
        }
        return undefined as never;
      },
    );
  });

  it("captures and persists the current workspace arrangement", async () => {
    const { context, values } = createContext({
      [ACTIVE_KEY]: BUILT_IN_LAYOUTS[1],
    });
    vi.mocked(vscode.window.showInputBox).mockResolvedValue("Focus");

    await new QivrynLayoutManager(context).saveCurrent();

    expect(values.get(CUSTOM_KEY)).toEqual([
      createCustomLayout("Focus", BUILT_IN_LAYOUTS[1], {
        sidebarVisible: true,
        auxiliaryBarVisible: false,
        panelVisible: true,
        zenMode: false,
      }),
    ]);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      "Saved layout “Focus”",
    );
  });

  it("restores a saved layout without toggling already-correct state", async () => {
    const preset = createCustomLayout("Review", BUILT_IN_LAYOUTS[0], {
      sidebarVisible: false,
      auxiliaryBarVisible: true,
      panelVisible: true,
      zenMode: false,
    });
    const { context, values } = createContext({ [ACTIVE_KEY]: preset });

    await new QivrynLayoutManager(context).restoreActive();

    expect(executed).toEqual([
      "workbench.action.toggleSidebarVisibility",
      "workbench.action.toggleAuxiliaryBar",
      "setContext",
      "setContext",
    ]);
    expect(values.get(ACTIVE_KEY)).toEqual(preset);
  });

  it("uses the Agent layout as the built-in IDE first-run default", async () => {
    const { context, values } = createContext();

    await new QivrynLayoutManager(context).restoreActive(true);

    expect(executed).toEqual([
      "workbench.action.closePanel",
      "workbench.action.closeSidebar",
      "workbench.view.extension.qivryn",
      "workbench.action.focusAuxiliaryBar",
      "qivryn.qivrynGUIView.focus",
      "qivryn.qivrynGUIView.focus",
      "qivryn.closeRestoredAgentEditors",
      "setContext",
      "setContext",
    ]);
    expect(values.get(ACTIVE_KEY)).toEqual(BUILT_IN_LAYOUTS[0]);
  });

  it("applies each built-in layout through the host workbench commands", async () => {
    const { context } = createContext();
    const manager = new QivrynLayoutManager(context);

    await manager.apply(BUILT_IN_LAYOUTS[0]);
    expect(executed).toEqual([
      "workbench.action.closePanel",
      "workbench.action.closeSidebar",
      "workbench.view.extension.qivryn",
      "workbench.action.focusAuxiliaryBar",
      "qivryn.qivrynGUIView.focus",
      "qivryn.qivrynGUIView.focus",
      "qivryn.closeRestoredAgentEditors",
      "setContext",
      "setContext",
    ]);

    executed.length = 0;
    await manager.apply(BUILT_IN_LAYOUTS[2]);
    expect(executed).toEqual([
      "workbench.action.toggleZenMode",
      "setContext",
      "setContext",
    ]);

    executed.length = 0;
    await manager.apply(BUILT_IN_LAYOUTS[3]);
    expect(executed).toEqual([
      "workbench.action.toggleZenMode",
      "qivryn.openBrowserWorkspace",
      "setContext",
      "setContext",
    ]);

    executed.length = 0;
    await manager.apply(BUILT_IN_LAYOUTS[4]);
    expect(executed).toEqual([
      "qivryn.openInNewWindow",
      "setContext",
      "setContext",
    ]);
  });

  it("keeps the Agent layout on the Qivryn right sidebar chat surface", async () => {
    process.env.QIVRYN_ENABLE_NATIVE_AGENT_SESSIONS = "true";
    const { context } = createContext();

    await new QivrynLayoutManager(context).apply(BUILT_IN_LAYOUTS[0]);

    expect(executed).toEqual([
      "workbench.action.closePanel",
      "workbench.action.closeSidebar",
      "workbench.view.extension.qivryn",
      "workbench.action.focusAuxiliaryBar",
      "qivryn.qivrynGUIView.focus",
      "qivryn.qivrynGUIView.focus",
      "qivryn.closeRestoredAgentEditors",
      "setContext",
      "setContext",
    ]);
  });

  it("uses public workbench commands when the host has no context-key reader", async () => {
    vi.mocked(vscode.commands.getCommands).mockResolvedValue([]);
    const { context } = createContext();

    await new QivrynLayoutManager(context).apply(BUILT_IN_LAYOUTS[4]);

    expect(executed).toEqual([
      "workbench.action.exitZenMode",
      "qivryn.openInNewWindow",
      "setContext",
      "setContext",
    ]);
  });

  it("does not restore a sidebar layout beside an existing Qivryn editor", async () => {
    const { context } = createContext({ [ACTIVE_KEY]: BUILT_IN_LAYOUTS[0] });
    const tabGroups = vscode.window.tabGroups
      .all as unknown as vscode.TabGroup[];
    tabGroups.push({
      tabs: [{ input: { viewType: "qivryn.qivrynGUIView" } }],
    } as unknown as vscode.TabGroup);

    await new QivrynLayoutManager(context).restoreActive();

    expect(executed).toEqual([]);
    tabGroups.length = 0;
  });
});
