import { describe, expect, it } from "vitest";
import { BuiltInToolNames } from "./builtIn";
import { getBaseToolDefinitions, getToolNameInventory } from ".";
import {
  CURSOR_LOCAL_CAPABILITIES,
  LocalCapabilityKind,
  resolveCursorLocalCapability,
} from "./cursorLocalCapabilities";

describe("Cursor-compatible local tools", () => {
  it("registers concrete local equivalents in the shared core registry", () => {
    const tools = getBaseToolDefinitions();
    const byName = new Map(tools.map((tool) => [tool.function.name, tool]));

    for (const name of [
      BuiltInToolNames.WriteFile,
      BuiltInToolNames.DeleteFile,
      BuiltInToolNames.ReadLints,
      BuiltInToolNames.GoToDefinition,
      BuiltInToolNames.SearchSymbols,
      BuiltInToolNames.UpdatePlan,
    ]) {
      expect(byName.has(name), `${name} should be registered`).toBe(true);
    }

    expect(byName.get(BuiltInToolNames.WriteFile)?.readonly).toBe(false);
    expect(byName.get(BuiltInToolNames.DeleteFile)?.defaultToolPolicy).toBe(
      "allowedWithPermission",
    );
    expect(byName.get(BuiltInToolNames.ReadLints)?.readonly).toBe(true);
    expect(byName.get(BuiltInToolNames.GoToDefinition)?.defaultToolPolicy).toBe(
      "allowedWithoutPermission",
    );
    expect(byName.get(BuiltInToolNames.UpdatePlan)?.readonly).toBe(true);
  });

  it("maps the complete authorized Cursor client-tool inventory locally", () => {
    expect(Object.keys(CURSOR_LOCAL_CAPABILITIES)).toHaveLength(53);
    expect(
      resolveCursorLocalCapability("CLIENT_SIDE_TOOL_V2_DELETE_FILE"),
    ).toMatchObject({
      kind: LocalCapabilityKind.Tool,
      executable: true,
      toolName: BuiltInToolNames.DeleteFile,
    });
    expect(
      resolveCursorLocalCapability("CLIENT_SIDE_TOOL_V2_WRITE_SHELL_STDIN"),
    ).toMatchObject({
      kind: LocalCapabilityKind.Unsupported,
      executable: false,
    });

    const registered = getToolNameInventory();
    for (const [name, capability] of Object.entries(
      CURSOR_LOCAL_CAPABILITIES,
    )) {
      expect(capability.implementation.length, name).toBeGreaterThan(0);
      if (!capability.executable) continue;
      expect(capability.kind, name).toBe(LocalCapabilityKind.Tool);
      expect(capability.toolName, name).toBeDefined();
      expect(registered.has(capability.toolName!), name).toBe(true);
    }
  });
});
