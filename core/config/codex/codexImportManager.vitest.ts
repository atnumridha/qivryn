import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as dotenv from "dotenv";
import { afterEach, describe, expect, it, vi } from "vitest";

const roots: string[] = [];
const originalQivrynHome = process.env.QIVRYN_GLOBAL_DIR;

afterEach(async () => {
  if (originalQivrynHome === undefined) delete process.env.QIVRYN_GLOBAL_DIR;
  else process.env.QIVRYN_GLOBAL_DIR = originalQivrynHome;
  vi.resetModules();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "qivryn-codex-import-"));
  roots.push(root);
  const codexHome = path.join(root, "codex");
  const qivrynHome = path.join(root, "qivryn");
  const defaultQivrynHome = path.join(root, "default-qivryn");
  process.env.QIVRYN_GLOBAL_DIR = defaultQivrynHome;

  await mkdir(path.join(codexHome, "skills", "review", "agents"), {
    recursive: true,
  });
  await writeFile(
    path.join(codexHome, "skills", "review", "SKILL.md"),
    "---\nname: review\ndescription: Review code\n---\n\nReview it.\n",
  );
  await writeFile(
    path.join(codexHome, "skills", "review", "agents", "openai.yaml"),
    "name: review\n",
  );
  await mkdir(path.join(codexHome, "agents"), { recursive: true });
  await writeFile(
    path.join(codexHome, "agents", "reviewer.md"),
    "---\nname: reviewer\ndescription: Review code\n---\n\nReview the requested code.\n",
  );
  await writeFile(path.join(codexHome, "AGENTS.md"), "Use evidence.\n");
  await writeFile(
    path.join(codexHome, ".env"),
    "BUGDB_OAUTH_TOKEN=codex-secret\nTRANSPORT_ONLY_SECRET=transport-secret\nSHARED_SETTING=codex-value\n",
    { mode: 0o600 },
  );
  await mkdir(qivrynHome, { recursive: true });
  await writeFile(
    path.join(qivrynHome, ".env"),
    "LOCAL_ONLY=preserved\nSHARED_SETTING=old-value\n",
    { mode: 0o600 },
  );
  const mcpScript = path.join(root, "bugdb-server.py");
  await writeFile(
    mcpScript,
    "import os\nTOKEN = os.environ.get('BUGDB_OAUTH_TOKEN')\n",
  );
  await writeFile(
    path.join(codexHome, "hooks.json"),
    JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          {
            matcher: "",
            hooks: [{ type: "command", command: "node hook.mjs", timeout: 5 }],
          },
        ],
      },
    }),
  );

  const pluginRoot = path.join(
    codexHome,
    "plugins",
    "cache",
    "openai-bundled",
    "example",
    "1.2.3",
  );
  await mkdir(path.join(pluginRoot, ".codex-plugin"), { recursive: true });
  await mkdir(path.join(pluginRoot, "skills", "plugin-skill"), {
    recursive: true,
  });
  await writeFile(
    path.join(pluginRoot, ".codex-plugin", "plugin.json"),
    JSON.stringify({
      name: "example",
      version: "1.2.3",
      skills: "./skills",
      interface: { displayName: "Example" },
    }),
  );
  await writeFile(
    path.join(pluginRoot, "skills", "plugin-skill", "SKILL.md"),
    "---\nname: plugin-skill\ndescription: Example\n---\n\nExample.\n",
  );
  await writeFile(
    path.join(codexHome, "config.toml"),
    '[plugins."example@openai-bundled"]\nenabled = true\n',
  );

  const automationRoot = path.join(codexHome, "automations", "daily-review");
  await mkdir(automationRoot, { recursive: true });
  await writeFile(
    path.join(automationRoot, "automation.toml"),
    [
      'id = "daily-review"',
      'name = "Daily review"',
      'prompt = "Review the repository"',
      'status = "PAUSED"',
      'rrule = "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0"',
      'model = "gpt-test"',
      'reasoning_effort = "high"',
      `target = { type = "project", project_id = ${JSON.stringify(root)} }`,
      "created_at = 1700000000000",
      "updated_at = 1700000001000",
    ].join("\n"),
  );

  return {
    codexHome,
    qivrynHome,
    defaultQivrynHome,
    pluginRoot,
    mcpScript,
  };
}

describe("Codex import manager", () => {
  it("does not import Codex Desktop's private Chrome-control bridges", async () => {
    const { codexHome, qivrynHome, mcpScript } = await fixture();
    vi.resetModules();
    const manager = await import("./codexImportManager");
    const mcpServers = [
      {
        name: "computer-use",
        enabled: true,
        transport: {
          type: "stdio" as const,
          command:
            "/Users/test/.codex/computer-use/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient",
          args: ["mcp"],
        },
      },
      {
        name: "node_repl",
        enabled: true,
        transport: {
          type: "stdio" as const,
          command:
            "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node_repl",
          env: { BROWSER_USE_AVAILABLE_BACKENDS: "chrome,iab" },
        },
      },
      {
        name: "portable-tools",
        enabled: true,
        transport: {
          type: "stdio" as const,
          command: "node",
          args: [mcpScript],
        },
      },
    ];

    const preview = await manager.scanCodexImport({ codexHome, mcpServers });
    expect(preview.items.filter((item) => item.kind === "mcp")).toEqual([
      expect.objectContaining({ id: "portable-tools" }),
    ]);

    const result = await manager.applyCodexImport(
      { kinds: ["mcp"] },
      { codexHome, qivrynHome, mcpServers },
    );
    expect(result.imported.mcp).toBe(1);
    const mcp = JSON.parse(
      await readFile(
        path.join(qivrynHome, "mcpServers", "codex-import.json"),
        "utf8",
      ),
    );
    expect(mcp.mcpServers).toEqual({
      "portable-tools": expect.objectContaining({
        type: "stdio",
        command: "node",
        args: [mcpScript],
      }),
    });
  });

  it("previews and imports MCP, plugins, skills, hooks, rules, agents, and paused automations", async () => {
    const { codexHome, qivrynHome, defaultQivrynHome, pluginRoot, mcpScript } =
      await fixture();
    vi.resetModules();
    const manager = await import("./codexImportManager");
    const mcpServers = [
      {
        name: "local-tools",
        enabled: true,
        transport: {
          type: "stdio" as const,
          command: "node",
          args: [mcpScript],
          env: {
            BUGDB_OAUTH_TOKEN: "raw-codex-token",
            INLINE_ONLY_TOKEN: "raw-inline-token",
            TRANSPORT_ONLY_SECRET: "raw-transport-secret",
            TOKEN: "${TOKEN}",
          },
        },
      },
      {
        name: "disabled-tools",
        enabled: false,
        transport: {
          type: "streamable_http" as const,
          url: "https://example.test/mcp",
        },
      },
      {
        name: "relative-codex-tool",
        enabled: true,
        transport: {
          type: "stdio" as const,
          command: "./tools/server.mjs",
          args: ["mcp"],
          cwd: ".",
        },
      },
    ];

    const preview = await manager.scanCodexImport({ codexHome, mcpServers });
    expect(preview.counts).toMatchObject({
      mcp: 3,
      plugin: 1,
      skill: 1,
      hook: 1,
      rule: 1,
      agent: 1,
      automation: 1,
    });
    expect(preview.issues).toEqual([]);

    const result = await manager.applyCodexImport(
      {},
      { codexHome, qivrynHome, mcpServers },
    );
    expect(result.imported).toMatchObject({
      mcp: 2,
      plugin: 1,
      skill: 1,
      hook: 1,
      rule: 1,
      agent: 1,
      automation: 1,
    });
    expect(result.issues).toEqual([]);

    const mcp = JSON.parse(
      await readFile(
        path.join(qivrynHome, "mcpServers", "codex-import.json"),
        "utf8",
      ),
    );
    expect(mcp.mcpServers).toEqual({
      "local-tools": {
        type: "stdio",
        command: "node",
        args: [mcpScript],
        env: {
          BUGDB_OAUTH_TOKEN: "${BUGDB_OAUTH_TOKEN}",
          INLINE_ONLY_TOKEN: "${INLINE_ONLY_TOKEN}",
          TRANSPORT_ONLY_SECRET: "${TRANSPORT_ONLY_SECRET}",
          TOKEN: "${TOKEN}",
        },
      },
      "relative-codex-tool": {
        type: "stdio",
        command: path.join(codexHome, "tools", "server.mjs"),
        args: ["mcp"],
        cwd: codexHome,
      },
    });
    const importedEnvironment = dotenv.parse(
      await readFile(path.join(qivrynHome, ".env"), "utf8"),
    );
    expect(importedEnvironment).toEqual({
      BUGDB_OAUTH_TOKEN: "codex-secret",
      INLINE_ONLY_TOKEN: "raw-inline-token",
      LOCAL_ONLY: "preserved",
      SHARED_SETTING: "codex-value",
      TRANSPORT_ONLY_SECRET: "transport-secret",
    });

    const plugins = JSON.parse(
      await readFile(path.join(qivrynHome, "plugins", "registry.json"), "utf8"),
    );
    expect(plugins.plugins[0]).toMatchObject({
      id: "example",
      enabled: true,
      installedPath: await realpath(pluginRoot),
      sourceKind: "codex",
      installMode: "linked",
    });
    await expect(
      readFile(path.join(defaultQivrynHome, "plugins", "registry.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const hooks = JSON.parse(
      await readFile(path.join(qivrynHome, "hooks.json"), "utf8"),
    );
    expect(hooks.hooks.UserPromptSubmit).toHaveLength(1);
    expect(hooks.hooks.UserPromptSubmit[0].hooks[0].enabled).toBe(false);

    await expect(
      manager.setCodexImportItemEnabled(
        {
          kind: "hook",
          id: "UserPromptSubmit:0:0",
          enabled: true,
        },
        { codexHome, qivrynHome, mcpServers },
      ),
    ).rejects.toThrow(/Review this hook command/);
    await manager.setCodexImportItemEnabled(
      {
        kind: "hook",
        id: "UserPromptSubmit:0:0",
        enabled: true,
        reviewed: true,
      },
      { codexHome, qivrynHome, mcpServers },
    );
    const enabledHooks = JSON.parse(
      await readFile(path.join(qivrynHome, "hooks.json"), "utf8"),
    );
    expect(enabledHooks.hooks.UserPromptSubmit[0].hooks[0].enabled).toBe(true);

    await manager.setCodexImportItemEnabled(
      { kind: "mcp", id: "local-tools", enabled: false },
      { codexHome, qivrynHome, mcpServers },
    );
    const disabledMcp = JSON.parse(
      await readFile(
        path.join(qivrynHome, "mcpServers", "codex-import.json"),
        "utf8",
      ),
    );
    expect(disabledMcp.mcpServers).toEqual({
      "relative-codex-tool": {
        type: "stdio",
        command: path.join(codexHome, "tools", "server.mjs"),
        args: ["mcp"],
        cwd: codexHome,
      },
    });

    const automations = JSON.parse(
      await readFile(
        path.join(qivrynHome, "agents", "automations.json"),
        "utf8",
      ),
    );
    expect(automations[0]).toMatchObject({
      id: "daily-review",
      enabled: false,
      trigger: {
        type: "rrule",
        rrule: "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
      },
      model: "gpt-test",
      reasoningEffort: "high",
    });
  });
});
