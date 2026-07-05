import { describe, expect, it } from "vitest";
import { BuiltInToolNames } from "./builtIn";
import { getBaseToolDefinitions } from ".";
import {
  CURSOR_LOCAL_CAPABILITIES,
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
    ).toBe("delete_file");
    expect(resolveCursorLocalCapability("CLIENT_SIDE_TOOL_V2_TODO_WRITE")).toBe(
      "update_plan",
    );
    expect(
      Object.values(CURSOR_LOCAL_CAPABILITIES).every(
        (equivalent) => equivalent.length > 0,
      ),
    ).toBe(true);
  });
});
