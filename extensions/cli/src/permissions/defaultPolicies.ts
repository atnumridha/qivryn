import { ToolPermissionPolicy } from "./types.js";

/**
 * Default permission policies for all built-in tools.
 * These policies are applied in order - first match wins.
 */
export function getDefaultToolPolicies(
  isHeadless = false,
): ToolPermissionPolicy[] {
  const policies: ToolPermissionPolicy[] = [
    // Write tools
    { tool: "Edit", permission: "ask" },
    { tool: "MultiEdit", permission: "ask" },
    { tool: "Write", permission: "ask" },
    { tool: "CheckBackgroundJob", permission: "allow" },
    { tool: "AskQuestion", permission: "allow" },
    { tool: "Checklist", permission: "allow" },
    { tool: "Diff", permission: "allow" },
    { tool: "Skills", permission: "allow" },
    { tool: "Exit", permission: "allow" }, // Exit tool is generally safe (headless mode only)
    { tool: "Fetch", permission: "allow" }, // Technically not read only but edge casey to post w query params
    { tool: "List", permission: "allow" },
    { tool: "Read", permission: "allow" },
    { tool: "Search", permission: "allow" },
    { tool: "Status", permission: "allow" },
    { tool: "ReportFailure", permission: "allow" },
    { tool: "UploadArtifact", permission: "allow" },
  ];

  // MCP and Bash are ask in TUI mode, auto in headless
  if (isHeadless) {
    policies.push({ tool: "Bash", permission: "allow" });
    policies.push({ tool: "*", permission: "allow" });
  } else {
    policies.push({ tool: "Bash", permission: "ask" });
    policies.push({ tool: "*", permission: "ask" });
  }

  return policies;
}

const PLAN_MODE_READ_ONLY_BASH_COMMANDS = [
  "ls",
  "ls -a",
  "ls -l",
  "ls -la",
  "ls -al",
  "pwd",
  "whoami",
  "hostname",
  "date",
  "uptime",
  "free",
  "jobs",
  "git status",
  "git status --short",
  "git status --short --branch",
  "git status --porcelain",
  "git status --porcelain=v1",
  "git log",
  "git log --oneline",
  "git log -5 --oneline",
  "git diff",
  "git diff --cached",
  "git diff --check",
  "git diff --staged",
  "git diff --stat",
  "git show",
  "git branch --show-current",
  "git remote -v",
  "git rev-parse --show-toplevel",
  "rg --files",
];

const PLAN_MODE_READ_ONLY_BASH_POLICIES: ToolPermissionPolicy[] =
  PLAN_MODE_READ_ONLY_BASH_COMMANDS.map((command) => ({
    tool: `Bash(${command})`,
    permission: "allow" as const,
  }));

// Plan mode: allow only direct read tools and shell commands that can be
// classified as read-only. Bash and unknown/MCP tools fail closed.
export const PLAN_MODE_POLICIES: ToolPermissionPolicy[] = [
  { tool: "Edit", permission: "exclude" },
  { tool: "MultiEdit", permission: "exclude" },
  { tool: "Write", permission: "exclude" },

  ...PLAN_MODE_READ_ONLY_BASH_POLICIES,
  {
    tool: "Bash",
    permission: "allow",
    argumentMatches: { command: undefined },
  },
  { tool: "Bash", permission: "exclude" },
  { tool: "CheckBackgroundJob", permission: "allow" },
  { tool: "AskQuestion", permission: "allow" },
  { tool: "Checklist", permission: "allow" },
  { tool: "Diff", permission: "allow" },
  { tool: "Exit", permission: "allow" },
  { tool: "Fetch", permission: "allow" },
  { tool: "List", permission: "allow" },
  { tool: "Read", permission: "allow" },
  { tool: "ReportFailure", permission: "allow" },
  { tool: "Search", permission: "allow" },
  { tool: "Skills", permission: "allow" },
  { tool: "Status", permission: "allow" },
  { tool: "UploadArtifact", permission: "allow" },

  { tool: "*", permission: "exclude" },
];

// Sandbox mode: strict read-only override. Terminal and unknown/MCP tools are
// excluded because their effects cannot be proven read-only ahead of time.
export const SANDBOX_MODE_POLICIES: ToolPermissionPolicy[] = [
  ...PLAN_MODE_POLICIES.filter(
    (policy) => !policy.tool.startsWith("Bash") && policy.tool !== "*",
  ),
  { tool: "Bash", permission: "exclude" },
  { tool: "*", permission: "exclude" },
];

// Autonomous mode: allow tools by default, while dynamic security evaluation
// can still escalate risky terminal commands to an approval prompt.
export const AUTONOMOUS_MODE_POLICIES: ToolPermissionPolicy[] = [
  { tool: "*", permission: "allow" },
];

// Auto mode is explicit full access: allow everything without Qivryn prompts.
export const AUTO_MODE_POLICIES: ToolPermissionPolicy[] = [
  { tool: "*", permission: "allow" },
];
