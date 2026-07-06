import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadWorkspacePolicy,
  mergeWorkspacePermissions,
  mostRestrictiveDecision,
  WorkspacePermissionDecision,
} from "../src/workspacePolicy.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("workspace policy", () => {
  it("selects the most restrictive decision", () => {
    expect(
      mostRestrictiveDecision(
        WorkspacePermissionDecision.Allow,
        WorkspacePermissionDecision.Ask,
      ),
    ).toBe(WorkspacePermissionDecision.Ask);
    expect(
      mostRestrictiveDecision(
        WorkspacePermissionDecision.Deny,
        WorkspacePermissionDecision.Allow,
      ),
    ).toBe(WorkspacePermissionDecision.Deny);
  });

  it("does not let workspace rules loosen user policy", () => {
    const merged = mergeWorkspacePermissions(
      {
        version: 1,
        default: WorkspacePermissionDecision.Deny,
        tools: { read_file: WorkspacePermissionDecision.Ask },
        filesystem: { write: ["src/**"] },
      },
      {
        version: 1,
        default: WorkspacePermissionDecision.Ask,
        tools: { read_file: WorkspacePermissionDecision.Allow },
        filesystem: { write: ["src/**", "docs/**"] },
      },
    );
    expect(merged?.default).toBe(WorkspacePermissionDecision.Deny);
    expect(merged?.tools?.read_file).toBe(WorkspacePermissionDecision.Ask);
    expect(merged?.filesystem?.write).toEqual(["src/**"]);
  });

  it("loads optional workspace files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qivryn-policy-"));
    roots.push(root);
    await mkdir(path.join(root, ".qivryn"));
    await writeFile(
      path.join(root, ".qivryn", "environment.json"),
      JSON.stringify({ version: 1, variables: { NODE_ENV: "test" } }),
    );
    await writeFile(
      path.join(root, ".qivryn", "permissions.json"),
      JSON.stringify({ version: 1, default: "ask" }),
    );
    await expect(loadWorkspacePolicy(root)).resolves.toMatchObject({
      environment: { variables: { NODE_ENV: "test" } },
      permissions: { default: "ask" },
    });
  });
});
