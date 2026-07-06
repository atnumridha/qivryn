import { readFile } from "node:fs/promises";
import path from "node:path";

export enum WorkspacePermissionDecision {
  Allow = "allow",
  Ask = "ask",
  Deny = "deny",
}

type RestrictiveDecision =
  | WorkspacePermissionDecision.Ask
  | WorkspacePermissionDecision.Deny;

export interface WorkspaceEnvironment {
  version: 1;
  variables?: Record<string, string>;
  inherit?: string[];
  unset?: string[];
  workingDirectory?: string;
  runtime?: "local" | "container" | "ssh";
}

export interface WorkspacePermissions {
  version: 1;
  default?: RestrictiveDecision;
  tools?: Record<string, WorkspacePermissionDecision>;
  terminal?: {
    allow?: string[];
    deny?: string[];
    network?: RestrictiveDecision;
    elevation?: RestrictiveDecision;
  };
  filesystem?: { read?: string[]; write?: string[]; deny?: string[] };
  browser?: {
    origins?: string[];
    downloads?: RestrictiveDecision;
    authentication?: RestrictiveDecision;
  };
  mcp?: Record<string, WorkspacePermissionDecision>;
}

export interface WorkspacePolicy {
  environment?: WorkspaceEnvironment;
  permissions?: WorkspacePermissions;
}

const rank: Record<WorkspacePermissionDecision, number> = {
  [WorkspacePermissionDecision.Allow]: 0,
  [WorkspacePermissionDecision.Ask]: 1,
  [WorkspacePermissionDecision.Deny]: 2,
};

export function mostRestrictiveDecision(
  ...decisions: Array<WorkspacePermissionDecision | undefined>
): WorkspacePermissionDecision | undefined {
  return decisions
    .filter(
      (value): value is WorkspacePermissionDecision => value !== undefined,
    )
    .sort((left, right) => rank[right] - rank[left])[0];
}

export function mergeWorkspacePermissions(
  base: WorkspacePermissions | undefined,
  workspace: WorkspacePermissions | undefined,
): WorkspacePermissions | undefined {
  if (!base) return workspace;
  if (!workspace) return base;
  return {
    ...base,
    ...workspace,
    version: 1,
    default: mostRestrictiveDecision(base.default, workspace.default) as
      | WorkspacePermissions["default"]
      | undefined,
    tools: mergeDecisionMaps(base.tools, workspace.tools),
    mcp: mergeDecisionMaps(base.mcp, workspace.mcp),
    terminal: {
      ...base.terminal,
      ...workspace.terminal,
      allow: intersect(base.terminal?.allow, workspace.terminal?.allow),
      deny: union(base.terminal?.deny, workspace.terminal?.deny),
      network: mostRestrictiveDecision(
        base.terminal?.network,
        workspace.terminal?.network,
      ) as RestrictiveDecision | undefined,
      elevation: mostRestrictiveDecision(
        base.terminal?.elevation,
        workspace.terminal?.elevation,
      ) as RestrictiveDecision | undefined,
    },
    filesystem: {
      ...base.filesystem,
      ...workspace.filesystem,
      read: intersect(base.filesystem?.read, workspace.filesystem?.read),
      write: intersect(base.filesystem?.write, workspace.filesystem?.write),
      deny: union(base.filesystem?.deny, workspace.filesystem?.deny),
    },
    browser: {
      ...base.browser,
      ...workspace.browser,
      origins: intersect(base.browser?.origins, workspace.browser?.origins),
      downloads: mostRestrictiveDecision(
        base.browser?.downloads,
        workspace.browser?.downloads,
      ) as RestrictiveDecision | undefined,
      authentication: mostRestrictiveDecision(
        base.browser?.authentication,
        workspace.browser?.authentication,
      ) as RestrictiveDecision | undefined,
    },
  };
}

export async function loadWorkspacePolicy(
  workspaceRoot: string,
): Promise<WorkspacePolicy> {
  const directory = path.join(workspaceRoot, ".qivryn");
  const [environment, permissions] = await Promise.all([
    readJson<WorkspaceEnvironment>(path.join(directory, "environment.json")),
    readJson<WorkspacePermissions>(path.join(directory, "permissions.json")),
  ]);
  return { environment, permissions };
}

function mergeDecisionMaps(
  base: Record<string, WorkspacePermissionDecision> | undefined,
  workspace: Record<string, WorkspacePermissionDecision> | undefined,
): Record<string, WorkspacePermissionDecision> | undefined {
  const keys = new Set([
    ...Object.keys(base ?? {}),
    ...Object.keys(workspace ?? {}),
  ]);
  if (keys.size === 0) return undefined;
  return Object.fromEntries(
    [...keys].map((key) => [
      key,
      mostRestrictiveDecision(base?.[key], workspace?.[key]),
    ]),
  ) as Record<string, WorkspacePermissionDecision>;
}

function intersect(
  left: string[] | undefined,
  right: string[] | undefined,
): string[] | undefined {
  if (!left) return right;
  if (!right) return left;
  const values = new Set(right);
  return left.filter((value) => values.has(value));
}

function union(
  left: string[] | undefined,
  right: string[] | undefined,
): string[] | undefined {
  if (!left && !right) return undefined;
  return [...new Set([...(left ?? []), ...(right ?? [])])];
}

async function readJson<T>(filepath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filepath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
