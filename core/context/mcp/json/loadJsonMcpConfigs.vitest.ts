import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";

const roots: string[] = [];
const originalGlobalDir = process.env.QIVRYN_GLOBAL_DIR;

afterEach(async () => {
  if (originalGlobalDir === undefined) delete process.env.QIVRYN_GLOBAL_DIR;
  else process.env.QIVRYN_GLOBAL_DIR = originalGlobalDir;
  vi.resetModules();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it("loads a Codex plugin MCP config contributed as a file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "qivryn-plugin-mcp-"));
  roots.push(root);
  process.env.QIVRYN_GLOBAL_DIR = path.join(root, "qivryn-home");
  vi.resetModules();

  const bundle = path.join(root, "computer-use");
  await mkdir(path.join(bundle, ".codex-plugin"), { recursive: true });
  await writeFile(
    path.join(bundle, ".codex-plugin", "plugin.json"),
    JSON.stringify({
      name: "computer-use",
      version: "1.0.0",
      mcpServers: "./.mcp.json",
    }),
  );
  await writeFile(
    path.join(bundle, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        "computer-use": {
          command: "./Computer Use.app/Contents/MacOS/client",
          args: ["mcp"],
          cwd: ".",
        },
      },
    }),
  );

  const manager = await import("../../../config/plugins/localPluginManager");
  const plugin = await manager.installLocalPlugin(bundle);
  const { loadJsonMcpConfigs } = await import("./loadJsonMcpConfigs");
  const ide = {
    getWorkspaceDirs: async () => [],
    fileExists: async (uri: string) => {
      try {
        await access(fileURLToPath(uri));
        return true;
      } catch {
        return false;
      }
    },
    readFile: async (uri: string) =>
      (await import("node:fs/promises")).readFile(fileURLToPath(uri), "utf8"),
  };

  const result = await loadJsonMcpConfigs(ide as never, true);
  expect(result.errors).toEqual([]);
  expect(result.mcpServers).toEqual([
    expect.objectContaining({
      id: "computer-use",
      command: "./Computer Use.app/Contents/MacOS/client",
      args: ["mcp"],
      cwd: ".",
      sourceFile: expect.stringContaining(`${plugin.installedPath}/.mcp.json`),
    }),
  ]);
});
