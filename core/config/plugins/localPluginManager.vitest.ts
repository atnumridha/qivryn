import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalGlobalDir = process.env.QIVRYN_GLOBAL_DIR;

afterEach(() => {
  process.env.QIVRYN_GLOBAL_DIR = originalGlobalDir;
  vi.resetModules();
});

async function createBundle(root: string, version = "1.0.0") {
  const bundle = path.join(root, `bundle-${version}`);
  await mkdir(path.join(bundle, ".codex-plugin"), { recursive: true });
  await mkdir(path.join(bundle, "skills", "example"), { recursive: true });
  await mkdir(path.join(bundle, "rules"), { recursive: true });
  await mkdir(path.join(bundle, "agents"), { recursive: true });
  await mkdir(path.join(bundle, "mcp"), { recursive: true });
  await writeFile(
    path.join(bundle, ".codex-plugin", "plugin.json"),
    JSON.stringify({
      name: "example-plugin",
      version,
      description: "Example plugin",
      skills: "./skills",
      rules: "./rules",
      agents: "./agents",
      mcp: "./mcp",
      interface: { displayName: "Example Plugin", developerName: "Qivryn" },
    }),
  );
  await writeFile(
    path.join(bundle, "skills", "example", "SKILL.md"),
    "---\nname: example\ndescription: Example\n---\n\nInstructions\n",
  );
  await writeFile(path.join(bundle, "rules", "example.md"), "Rule\n");
  await writeFile(path.join(bundle, "agents", "example.md"), "Agent\n");
  await writeFile(path.join(bundle, "mcp", "example.json"), "{}\n");
  return bundle;
}

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "qivryn-plugin-test-"));
  process.env.QIVRYN_GLOBAL_DIR = path.join(root, "qivryn-home");
  vi.resetModules();
  return {
    root,
    manager: await import("./localPluginManager"),
  };
}

describe("localPluginManager", () => {
  it("installs, updates, disables, and uninstalls a local plugin", async () => {
    const { root, manager } = await setup();
    const firstBundle = await createBundle(root);
    const installed = await manager.installLocalPlugin(firstBundle);

    expect(installed).toMatchObject({
      id: "example-plugin",
      version: "1.0.0",
      enabled: true,
      contributions: { skills: 1, rules: 1, agents: 1, mcp: 1 },
    });
    expect(await manager.getEnabledLocalPluginContributionPaths()).toEqual({
      skills: [path.join(installed.installedPath, "skills")],
      rules: [path.join(installed.installedPath, "rules")],
      agents: [path.join(installed.installedPath, "agents")],
      mcp: [path.join(installed.installedPath, "mcp")],
    });
    expect(await manager.getEnabledLocalPluginSkillPaths()).toEqual([
      path.join(installed.installedPath, "skills"),
    ]);

    await manager.setLocalPluginEnabled(installed.id, false);
    expect(await manager.getEnabledLocalPluginContributionPaths()).toEqual({
      skills: [],
      rules: [],
      agents: [],
      mcp: [],
    });

    const secondBundle = await createBundle(root, "2.0.0");
    const updated = await manager.installLocalPlugin(secondBundle);
    expect(updated).toMatchObject({ version: "2.0.0", enabled: false });
    expect(await manager.listLocalPlugins()).toHaveLength(1);

    await manager.uninstallLocalPlugin(installed.id);
    expect(await manager.listLocalPlugins()).toEqual([]);
    await expect(readFile(updated.installedPath)).rejects.toThrow();
  });

  it("rejects contribution paths outside the bundle", async () => {
    const { root, manager } = await setup();
    const bundle = await createBundle(root);
    await writeFile(
      path.join(bundle, ".codex-plugin", "plugin.json"),
      JSON.stringify({
        name: "example-plugin",
        version: "1",
        skills: "../skills",
      }),
    );
    await expect(manager.installLocalPlugin(bundle)).rejects.toThrow(
      "escapes its bundle",
    );
  });

  it("rejects symbolic links in imported bundles", async () => {
    const { root, manager } = await setup();
    const bundle = await createBundle(root);
    await symlink(
      path.join(bundle, "skills"),
      path.join(bundle, "linked-skills"),
      "dir",
    );
    await expect(manager.installLocalPlugin(bundle)).rejects.toThrow(
      "may not contain symbolic links",
    );
  });
});
