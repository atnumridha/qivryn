export type BuiltInLayoutId =
  | "agent"
  | "editor"
  | "zen"
  | "browser"
  | "maximized-chat";

export interface ContinueLayoutSnapshot {
  sidebarVisible: boolean;
  auxiliaryBarVisible: boolean;
  panelVisible: boolean;
  zenMode: boolean;
}

export interface ContinueLayoutPreset {
  id: string;
  label: string;
  builtIn: BuiltInLayoutId;
  custom: boolean;
  snapshot?: ContinueLayoutSnapshot;
}

export const BUILT_IN_LAYOUTS: ContinueLayoutPreset[] = [
  { id: "agent", label: "Agent", builtIn: "agent", custom: false },
  { id: "editor", label: "Editor", builtIn: "editor", custom: false },
  { id: "zen", label: "Zen", builtIn: "zen", custom: false },
  { id: "browser", label: "Browser", builtIn: "browser", custom: false },
  {
    id: "maximized-chat",
    label: "Maximized Chat",
    builtIn: "maximized-chat",
    custom: false,
  },
];

export function createCustomLayout(
  name: string,
  source: ContinueLayoutPreset,
  snapshot?: ContinueLayoutSnapshot,
): ContinueLayoutPreset {
  const label = name.replace(/\s+/g, " ").trim();
  if (!label) throw new Error("Layout name cannot be empty");
  return {
    id: `custom-${label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")}`,
    label,
    builtIn: source.builtIn,
    custom: true,
    ...(snapshot ? { snapshot } : {}),
  };
}

export function saveCustomLayout(
  layouts: readonly ContinueLayoutPreset[],
  preset: ContinueLayoutPreset,
): ContinueLayoutPreset[] {
  if (!preset.custom || !preset.snapshot) {
    throw new Error("Saved layouts require a captured workspace snapshot");
  }
  return [...layouts.filter((item) => item.id !== preset.id), preset];
}

export function restoreSavedLayouts(value: unknown): ContinueLayoutPreset[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ContinueLayoutPreset => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as Partial<ContinueLayoutPreset>;
    const snapshot = candidate.snapshot as
      | Partial<ContinueLayoutSnapshot>
      | undefined;
    return (
      candidate.custom === true &&
      typeof candidate.id === "string" &&
      typeof candidate.label === "string" &&
      BUILT_IN_LAYOUTS.some((layout) => layout.builtIn === candidate.builtIn) &&
      Boolean(snapshot) &&
      typeof snapshot?.sidebarVisible === "boolean" &&
      typeof snapshot.auxiliaryBarVisible === "boolean" &&
      typeof snapshot.panelVisible === "boolean" &&
      typeof snapshot.zenMode === "boolean"
    );
  });
}
