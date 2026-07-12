import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MockIdeMessenger } from "../../../context/MockIdeMessenger";
import { renderWithProviders } from "../../../util/test/render";
import { ExtensionsSection } from "./ExtensionsSection";

afterEach(() => {
  window.localStorage.removeItem("qivryn.skills.catalog.v2");
});

const plugin = {
  id: "release-tools",
  name: "release-tools",
  displayName: "Release Tools",
  version: "1.0.0",
  description: "Release workflow skills",
  developerName: "Qivryn",
  enabled: true,
  sourcePath: "/plugins/release-tools",
  installedPath: "/home/.qivryn/plugins/installed/release-tools",
  installedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  contributions: { skills: 2, rules: 0, agents: 0, mcp: 0 },
};

describe("ExtensionsSection", () => {
  it("manages imported Codex MCP and reviewed hook state", async () => {
    const messenger = new MockIdeMessenger();
    const counts = {
      mcp: 1,
      plugin: 0,
      skill: 0,
      hook: 1,
      rule: 0,
      agent: 0,
      automation: 0,
    };
    const inventory = {
      version: 1 as const,
      sourceRoot: "/Users/user/.codex",
      scannedAt: "2026-07-12T00:00:00.000Z",
      counts,
      issues: [],
      items: [
        {
          id: "playwright",
          name: "playwright",
          kind: "mcp" as const,
          enabled: true,
          sourceEnabled: true,
          reviewed: true,
          canToggle: true,
          detail: "stdio",
          state: "imported" as const,
        },
        {
          id: "UserPromptSubmit:0:0",
          name: "guard.py",
          kind: "hook" as const,
          enabled: false,
          sourceEnabled: true,
          reviewed: false,
          canToggle: true,
          detail: "UserPromptSubmit · python3 guard.py",
          state: "needs-review" as const,
        },
      ],
    };
    messenger.responses["extensions/codexImportPreview"] = inventory;
    const changes: Array<{ kind: string; id: string; enabled: boolean }> = [];
    messenger.responseHandlers["extensions/codexImportSetEnabled"] = async (
      request,
    ) => {
      changes.push(request);
      const next = {
        ...inventory,
        items: inventory.items.map((item) =>
          item.kind === request.kind && item.id === request.id
            ? {
                ...item,
                enabled: request.enabled,
                reviewed: request.reviewed ?? item.reviewed,
                state: "imported" as const,
              }
            : item,
        ),
      };
      messenger.responses["extensions/codexImportPreview"] = next;
      return { inventory: next, imported: counts, issues: [] };
    };
    const { user } = await renderWithProviders(<ExtensionsSection />, {
      mockIdeMessenger: messenger,
    });

    await user.click(
      await screen.findByRole("button", { name: /MCP servers/ }),
    );
    await user.click(
      screen.getByRole("switch", { name: "Disable playwright" }),
    );
    await waitFor(() =>
      expect(changes).toContainEqual({
        kind: "mcp",
        id: "playwright",
        enabled: false,
      }),
    );

    await user.click(screen.getByRole("button", { name: /^Hooks/ }));
    await user.click(screen.getByRole("button", { name: "Review" }));
    await user.click(screen.getByRole("button", { name: "Trust and enable" }));
    await waitFor(() =>
      expect(changes).toContainEqual({
        kind: "hook",
        id: "UserPromptSubmit:0:0",
        enabled: true,
        reviewed: true,
      }),
    );
  });

  it("imports a local plugin and displays its contributions", async () => {
    const messenger = new MockIdeMessenger();
    let sourcePath: string | undefined;
    messenger.responseHandlers["extensions/pluginInstall"] = async (
      request,
    ) => {
      sourcePath = request.sourcePath;
      messenger.responses["extensions/plugins"] = [plugin];
      return plugin;
    };
    const { user } = await renderWithProviders(<ExtensionsSection />, {
      mockIdeMessenger: messenger,
    });

    await user.type(
      screen.getByRole("textbox", { name: "Local plugin directory" }),
      "/plugins/release-tools",
    );
    await user.click(screen.getByRole("button", { name: "Import or update" }));

    await waitFor(() => expect(sourcePath).toBe("/plugins/release-tools"));
    expect(await screen.findByText("Release Tools")).toBeInTheDocument();
    expect(screen.getByText(/2 skills/)).toBeInTheDocument();
  });

  it("disables and uninstalls a managed plugin", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["extensions/plugins"] = [plugin];
    let disabled = false;
    let uninstalled = false;
    messenger.responseHandlers["extensions/pluginSetEnabled"] = async (
      request,
    ) => {
      disabled = request.id === plugin.id && !request.enabled;
      return { ...plugin, enabled: request.enabled };
    };
    messenger.responseHandlers["extensions/pluginUninstall"] = async (
      request,
    ) => {
      uninstalled = request.id === plugin.id;
    };
    const { user } = await renderWithProviders(<ExtensionsSection />, {
      mockIdeMessenger: messenger,
    });

    const enabled = await screen.findByRole("checkbox", {
      name: "Enable Release Tools",
    });
    await user.click(enabled);
    await waitFor(() => expect(disabled).toBe(true));

    await user.click(
      screen.getByRole("button", { name: "Uninstall Release Tools" }),
    );
    await waitFor(() => expect(uninstalled).toBe(true));
    expect(screen.queryByText("Release Tools")).not.toBeInTheDocument();
  });

  it("creates a workspace skill through the shared core protocol", async () => {
    const messenger = new MockIdeMessenger();
    let saved: unknown;
    messenger.responseHandlers["extensions/skillSave"] = async (request) => {
      saved = request;
      return {
        ...request,
        path: ".qivryn/skills/release-review/SKILL.md",
        sourceFile: "file:///workspace/.qivryn/skills/release-review/SKILL.md",
        provenance: "Qivryn",
        readOnly: false,
        files: [],
      };
    };
    const { user } = await renderWithProviders(<ExtensionsSection />, {
      mockIdeMessenger: messenger,
    });

    await user.click(await screen.findByRole("button", { name: "New skill" }));
    await user.type(
      screen.getByRole("textbox", { name: "Skill name" }),
      "release-review",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Skill description" }),
      "Review release readiness",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Skill instructions" }),
      "Check tests, packaging, and rollback.",
    );
    await user.click(screen.getByRole("button", { name: "Save skill" }));

    await waitFor(() =>
      expect(saved).toEqual({
        name: "release-review",
        description: "Review release readiness",
        content: "Check tests, packaging, and rollback.",
        scope: "workspace",
      }),
    );
  });
});
