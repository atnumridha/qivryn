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
      `target = { type = "project", project_id = ${JSON.stringify(root)} }`,
      "created_at = 1700000000000",
      "updated_at = 1700000001000",
    ].join("\n"),
  );

  return { codexHome, qivrynHome, defaultQivrynHome, pluginRoot };
}

describe("Codex import manager", () => {
  it("previews and imports MCP, plugins, skills, hooks, rules, agents, and paused automations", async () => {
    const { codexHome, qivrynHome, defaultQivrynHome, pluginRoot } =
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
          args: ["server.mjs"],
          env: { TOKEN: "${TOKEN}" },
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
    ];

    const preview = await manager.scanCodexImport({ codexHome, mcpServers });
    expect(preview.counts).toMatchObject({
      mcp: 2,
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
      mcp: 1,
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
        args: ["server.mjs"],
        env: { TOKEN: "${TOKEN}" },
      },
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
    expect(disabledMcp.mcpServers).toEqual({});

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
    });
  });
});
