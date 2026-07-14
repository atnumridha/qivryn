import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadPortableSubagents } from "./load-agents.js";

const temporary: string[] = [];
const originalGlobalDir = process.env.QIVRYN_GLOBAL_DIR;
afterEach(() => {
  process.env.QIVRYN_GLOBAL_DIR = originalGlobalDir;
  for (const directory of temporary.splice(0))
    fs.rmSync(directory, { recursive: true });
});

describe("loadPortableSubagents", () => {
  it("loads Cursor-compatible definitions with workspace precedence", () => {
    const cwd = fs.mkdtempSync(
      path.join(os.tmpdir(), "qivryn-agent-workspace-"),
    );
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "qivryn-agent-home-"));
    temporary.push(cwd, home);
    fs.mkdirSync(path.join(cwd, ".cursor", "agents"), { recursive: true });
    fs.mkdirSync(path.join(home, ".cursor", "agents"), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, ".cursor", "agents", "review.md"),
      `---\nname: reviewer\ndescription: Review changes\ntools: [Read, Search]\nmodel: fast-model\npermission_mode: readonly\nis_background: true\n---\nReview the repository.`,
    );
    fs.writeFileSync(
      path.join(home, ".cursor", "agents", "review.md"),
      `---\nname: reviewer\n---\nGlobal duplicate.`,
    );

    expect(loadPortableSubagents(cwd, home)).toEqual([
      expect.objectContaining({
        name: "reviewer",
        prompt: "Review the repository.",
        tools: ["Read", "Search"],
        model: "fast-model",
        permissionMode: "readonly",
        background: true,
      }),
    ]);
  });

  it("loads enabled managed-plugin agents and ignores disabled plugins", () => {
    const cwd = fs.mkdtempSync(
      path.join(os.tmpdir(), "qivryn-agent-workspace-"),
    );
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "qivryn-agent-home-"));
    temporary.push(cwd, home);
    const qivrynHome = path.join(home, ".qivryn-test");
    process.env.QIVRYN_GLOBAL_DIR = qivrynHome;
    const installedPath = path.join(
      qivrynHome,
      "plugins",
      "installed",
      "review-plugin",
    );
    fs.mkdirSync(path.join(installedPath, ".codex-plugin"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(installedPath, "agents"), { recursive: true });
    fs.writeFileSync(
      path.join(installedPath, ".codex-plugin", "plugin.json"),
      JSON.stringify({
        name: "review-plugin",
        version: "1",
        agents: "./agents",
      }),
    );
    fs.writeFileSync(
      path.join(installedPath, "agents", "plugin-review.md"),
      "---\nname: plugin-reviewer\n---\nReview from plugin.",
    );
    const registryPath = path.join(qivrynHome, "plugins", "registry.json");
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    const writeRegistry = (enabled: boolean) =>
      fs.writeFileSync(
        registryPath,
        JSON.stringify({
          version: 1,
          plugins: [{ enabled, installedPath }],
        }),
      );

    writeRegistry(true);
    expect(loadPortableSubagents(cwd, home)).toEqual([
      expect.objectContaining({ name: "plugin-reviewer" }),
    ]);

    writeRegistry(false);
    expect(loadPortableSubagents(cwd, home)).toEqual([]);
  });

  it("does not scan dependency documentation as portable agents", () => {
    const cwd = fs.mkdtempSync(
      path.join(os.tmpdir(), "qivryn-agent-workspace-"),
    );
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "qivryn-agent-home-"));
    temporary.push(cwd, home);
    const agentsRoot = path.join(cwd, ".qivryn", "agents");
    fs.mkdirSync(path.join(agentsRoot, "node_modules", "prettier"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(agentsRoot, "review.md"),
      "---\nname: reviewer\n---\nReview the repository.",
    );
    fs.writeFileSync(
      path.join(agentsRoot, "node_modules", "prettier", "README.md"),
      "# Prettier\n\n---\n\n**Documentation:** package documentation",
    );

    expect(loadPortableSubagents(cwd, home).map(({ name }) => name)).toEqual([
      "reviewer",
    ]);
  });
});
