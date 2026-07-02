import { describe, expect, it } from "vitest";
import {
  BUILT_IN_LAYOUTS,
  createCustomLayout,
  restoreSavedLayouts,
  saveCustomLayout,
} from "./layoutPresets";

describe("Continue layouts", () => {
  it("ships every required built-in layout", () => {
    expect(BUILT_IN_LAYOUTS.map((layout) => layout.builtIn)).toEqual([
      "agent",
      "editor",
      "zen",
      "browser",
      "maximized-chat",
    ]);
  });

  it("creates stable workspace custom layouts from the active arrangement", () => {
    expect(
      createCustomLayout("  My Focus Layout  ", BUILT_IN_LAYOUTS[1]),
    ).toEqual({
      id: "custom-my-focus-layout",
      label: "My Focus Layout",
      builtIn: "editor",
      custom: true,
    });
    expect(() => createCustomLayout("   ", BUILT_IN_LAYOUTS[0])).toThrow(
      /cannot be empty/,
    );
  });

  it("persists captured snapshots and restores only valid saved layouts", () => {
    const snapshot = {
      sidebarVisible: true,
      auxiliaryBarVisible: false,
      panelVisible: true,
      zenMode: false,
    };
    const first = createCustomLayout("Focus", BUILT_IN_LAYOUTS[1], snapshot);
    const updated = createCustomLayout("Focus", BUILT_IN_LAYOUTS[0], {
      ...snapshot,
      panelVisible: false,
    });
    const stored = saveCustomLayout(saveCustomLayout([], first), updated);
    const serialized = JSON.parse(JSON.stringify(stored));

    expect(restoreSavedLayouts(serialized)).toEqual([updated]);
    expect(
      restoreSavedLayouts([...serialized, { id: "broken", custom: true }]),
    ).toEqual([updated]);
    expect(() => saveCustomLayout([], BUILT_IN_LAYOUTS[0])).toThrow(
      /captured workspace snapshot/,
    );
  });
});
