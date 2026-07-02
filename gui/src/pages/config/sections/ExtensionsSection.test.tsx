import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MockIdeMessenger } from "../../../context/MockIdeMessenger";
import { renderWithProviders } from "../../../util/test/render";
import { ExtensionsSection } from "./ExtensionsSection";

afterEach(() => {
  window.localStorage.removeItem("continue.skills.catalog.v2");
});

const plugin = {
  id: "release-tools",
  name: "release-tools",
  displayName: "Release Tools",
  version: "1.0.0",
  description: "Release workflow skills",
  developerName: "Continue",
  enabled: true,
  sourcePath: "/plugins/release-tools",
  installedPath: "/home/.continue/plugins/installed/release-tools",
  installedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  contributions: { skills: 2, rules: 0, agents: 0, mcp: 0 },
};

describe("ExtensionsSection", () => {
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
        path: ".continue/skills/release-review/SKILL.md",
        sourceFile:
          "file:///workspace/.continue/skills/release-review/SKILL.md",
        provenance: "Continue",
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
