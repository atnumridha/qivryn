import { describe, expect, it } from "vitest";

import { checkToolPermission } from "./permissionChecker.js";
import {
  AUTONOMOUS_MODE_POLICIES,
  AUTO_MODE_POLICIES,
  getDefaultToolPolicies,
  PLAN_MODE_POLICIES,
  SANDBOX_MODE_POLICIES,
} from "./defaultPolicies.js";
const DEFAULT_TOOL_POLICIES = getDefaultToolPolicies();

describe("defaultPolicies", () => {
  it("should have correct permissions for read-only tools", () => {
    const readOnlyTools = [
      "Read",
      "List",
      "Search",
      "Fetch",
      "Exit",
      "Diff",
      "Checklist",
    ];

    for (const tool of readOnlyTools) {
      const policy = DEFAULT_TOOL_POLICIES.find((p) => p.tool === tool);
      expect(policy, `Policy should exist for ${tool}`).toBeDefined();
      expect(policy?.permission, `${tool} should be allowed`).toBe("allow");
    }
  });

  it("should not have prefix wildcard policies in defaults", () => {
    const prefixWildcardPolicy = DEFAULT_TOOL_POLICIES.find(
      (p) => p.tool.endsWith("*") && p.tool !== "*",
    );
    expect(prefixWildcardPolicy).toBeUndefined();
  });

  it("should have correct permissions for write tools", () => {
    const writeTools = ["Write", "Edit", "MultiEdit", "Bash"];

    for (const tool of writeTools) {
      const policy = DEFAULT_TOOL_POLICIES.find((p) => p.tool === tool);
      expect(policy, `Policy should exist for ${tool}`).toBeDefined();
      expect(policy?.permission, `${tool} should require confirmation`).toBe(
        "ask",
      );
    }
  });

  it("should have a catch-all policy", () => {
    const catchAllPolicy = DEFAULT_TOOL_POLICIES.find((p) => p.tool === "*");
    expect(catchAllPolicy).toBeDefined();
    expect(catchAllPolicy?.permission).toBe("ask");
  });

  it("should include MultiEdit policy", () => {
    const multiEditPolicy = DEFAULT_TOOL_POLICIES.find(
      (p) => p.tool === "MultiEdit",
    );
    expect(multiEditPolicy).toBeDefined();
    expect(multiEditPolicy?.permission).toBe("ask");
  });

  it("should have policies in correct order", () => {
    // The catch-all policy should be last
    const catchAllIndex = DEFAULT_TOOL_POLICIES.findIndex(
      (p) => p.tool === "*",
    );
    expect(catchAllIndex).toBe(DEFAULT_TOOL_POLICIES.length - 1);
  });

  it("should keep sandbox read-only and expose autonomous/full profiles", () => {
    expect(SANDBOX_MODE_POLICIES).toContainEqual({
      tool: "Bash",
      permission: "exclude",
    });
    expect(SANDBOX_MODE_POLICIES.at(-1)).toEqual({
      tool: "*",
      permission: "exclude",
    });
    expect(AUTONOMOUS_MODE_POLICIES).toEqual([
      { tool: "*", permission: "allow" },
    ]);
    expect(AUTO_MODE_POLICIES).toEqual([{ tool: "*", permission: "allow" }]);
  });

  it("should fail closed in plan mode while allowing classified shell reads", () => {
    expect(PLAN_MODE_POLICIES).toContainEqual({
      tool: "Bash(ls -la)",
      permission: "allow",
    });
    expect(PLAN_MODE_POLICIES).toContainEqual({
      tool: "Bash(git status --short)",
      permission: "allow",
    });
    expect(PLAN_MODE_POLICIES).toContainEqual({
      tool: "Bash",
      permission: "allow",
      argumentMatches: { command: undefined },
    });
    expect(PLAN_MODE_POLICIES).toContainEqual({
      tool: "Bash",
      permission: "exclude",
    });
    expect(PLAN_MODE_POLICIES.at(-1)).toEqual({
      tool: "*",
      permission: "exclude",
    });

    const permissions = { policies: PLAN_MODE_POLICIES };
    expect(
      checkToolPermission(
        { name: "Bash", arguments: { command: "ls -la" } },
        permissions,
      ).permission,
    ).toBe("allow");

    for (const command of [
      "touch created.txt",
      "ls -la && touch created.txt",
      "ls -la\ntouch created.txt",
      "ls -la > listing.txt",
      "echo `touch created.txt`",
    ]) {
      expect(
        checkToolPermission(
          { name: "Bash", arguments: { command } },
          permissions,
        ).permission,
      ).toBe("exclude");
    }

    expect(
      checkToolPermission(
        { name: "unclassified_mcp_write", arguments: {} },
        permissions,
      ).permission,
    ).toBe("exclude");

    expect(
      checkToolPermission({ name: "Bash", arguments: {} }, permissions)
        .permission,
    ).toBe("allow");

    expect(
      SANDBOX_MODE_POLICIES.some((policy) => policy.tool.startsWith("Bash(")),
    ).toBe(false);
  });
});
