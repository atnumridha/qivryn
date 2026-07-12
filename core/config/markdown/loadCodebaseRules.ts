import { ConfigValidationError, markdownToRule } from "@qivryn/config-yaml";
import os from "os";
import path from "path";
import { IDE, RuleWithSource } from "../..";
import { walkDir, walkDirs } from "../../indexing/walkDir";
import { RULES_MARKDOWN_FILENAME } from "../../llm/rules/constants";
import { localPathToUri } from "../../util/pathToUri";
import { findUriInDirs, getUriPathBasename } from "../../util/uri";
import { getDisabledCodexImportSourcePaths } from "../codex/codexImportManager";

const PORTABLE_AGENT_RULE_FILES = new Set([
  ".cursorrules",
  "agents.md",
  "agent.md",
  "claude.md",
  "codex.md",
  "copilot-instructions.md",
]);

const PORTABLE_AGENT_RULE_DIR_SEGMENTS = [
  "/.cursor/rules/",
  "/.claude/rules/",
  "/.codex/rules/",
  "/.agents/rules/",
  "/.github/instructions/",
];

function isPortableAgentRuleDirFile(normalizedUri: string): boolean {
  const filename = getUriPathBasename(normalizedUri).toLowerCase();
  return (
    (filename.endsWith(".md") || filename.endsWith(".mdc")) &&
    PORTABLE_AGENT_RULE_DIR_SEGMENTS.some((segment) =>
      normalizedUri.includes(segment),
    )
  );
}

/** Cursor, Claude, Codex, Copilot and Qivryn rule files share one loader. */
export function isCrossAgentRuleFile(fileUri: string): boolean {
  const normalized = fileUri.replaceAll("\\", "/").toLowerCase();
  const filename = getUriPathBasename(normalized).toLowerCase();
  if (filename === RULES_MARKDOWN_FILENAME) return true;
  if (PORTABLE_AGENT_RULE_FILES.has(filename)) return true;
  return isPortableAgentRuleDirFile(normalized);
}

function portableRuleIsWorkspaceWide(fileUri: string): boolean {
  const normalized = fileUri.replaceAll("\\", "/").toLowerCase();
  const filename = getUriPathBasename(normalized).toLowerCase();
  return (
    filename === ".cursorrules" ||
    filename === "copilot-instructions.md" ||
    isPortableAgentRuleDirFile(normalized)
  );
}

export function getGlobalCrossAgentRulePaths(homeDir = os.homedir()) {
  return [
    path.join(homeDir, ".cursorrules"),
    path.join(homeDir, ".cursor", "rules"),
    path.join(homeDir, ".claude", "rules"),
    path.join(homeDir, ".codex", "rules"),
    path.join(homeDir, ".codex", "AGENTS.md"),
    path.join(homeDir, ".agents", "rules"),
  ];
}

async function getGlobalCrossAgentRuleFiles(ide: IDE): Promise<string[]> {
  const files = await Promise.all(
    getGlobalCrossAgentRulePaths().map(async (rulePath) => {
      const uri = localPathToUri(rulePath);
      if (!(await ide.fileExists(uri))) return [];
      if (
        getUriPathBasename(uri).toLowerCase() === ".cursorrules" ||
        getUriPathBasename(uri).toLowerCase() === "agents.md"
      ) {
        return [uri];
      }
      return (
        await walkDir(uri, ide, { source: "get global agent rules" })
      ).filter(isCrossAgentRuleFile);
    }),
  );
  return files.flat();
}

export class CodebaseRulesCache {
  private static instance: CodebaseRulesCache | null = null;
  private constructor() {}

  public static getInstance(): CodebaseRulesCache {
    if (CodebaseRulesCache.instance === null) {
      CodebaseRulesCache.instance = new CodebaseRulesCache();
    }
    return CodebaseRulesCache.instance;
  }
  rules: RuleWithSource[] = [];
  errors: ConfigValidationError[] = [];
  async refresh(ide: IDE) {
    const { rules, errors } = await loadCodebaseRules(ide);
    this.rules = rules;
    this.errors = errors;
  }
  async update(ide: IDE, uri: string) {
    const content = await ide.readFile(uri);
    const workspaceDirs = await ide.getWorkspaceDirs();
    const { relativePathOrBasename, foundInDir } = findUriInDirs(
      uri,
      workspaceDirs,
    );
    if (!foundInDir) {
      console.warn(
        `Failed to load codebase rule ${uri}: URI not found in workspace`,
      );
    }
    const rule = markdownToRule(
      content,
      {
        uriType: "file",
        fileUri: uri,
      },
      relativePathOrBasename,
    );
    const ruleWithSource: RuleWithSource = {
      ...rule,
      source: "colocated-markdown",
      sourceFile: uri,
    };
    const matchIdx = this.rules.findIndex((r) => r.sourceFile === uri);
    if (matchIdx === -1) {
      this.rules.push(ruleWithSource);
    } else {
      this.rules[matchIdx] = ruleWithSource;
    }
  }
  remove(uri: string) {
    this.rules = this.rules.filter((r) => r.sourceFile !== uri);
  }
}

/**
 * Loads rules from rules.md files colocated in the codebase
 */
export async function loadCodebaseRules(ide: IDE): Promise<{
  rules: RuleWithSource[];
  errors: ConfigValidationError[];
}> {
  const errors: ConfigValidationError[] = [];
  const rules: RuleWithSource[] = [];

  try {
    // Get all files from the workspace
    const allFiles = [
      ...(await walkDirs(ide)),
      ...(await getGlobalCrossAgentRuleFiles(ide)),
    ];

    const disabled = await getDisabledCodexImportSourcePaths("rule");
    const rulesMdFiles = allFiles.filter(
      (file) => isCrossAgentRuleFile(file) && !disabled.has(file),
    );

    // Process each rules.md file
    for (const filePath of rulesMdFiles) {
      try {
        const content = await ide.readFile(filePath);
        const { relativePathOrBasename, foundInDir, uri } = findUriInDirs(
          filePath,
          await ide.getWorkspaceDirs(),
        );
        if (foundInDir) {
          const lastSlashIndex = relativePathOrBasename.lastIndexOf("/");
          const parentDir = portableRuleIsWorkspaceWide(filePath)
            ? undefined
            : relativePathOrBasename.substring(0, lastSlashIndex);
          const rule = markdownToRule(
            content,
            {
              uriType: "file",
              fileUri: uri,
            },
            parentDir,
          );

          const filename = getUriPathBasename(filePath).toLowerCase();
          const portableAlwaysApply =
            PORTABLE_AGENT_RULE_FILES.has(filename) ||
            filename === ".cursorrules";
          const alwaysApply =
            rule.alwaysApply ?? (portableAlwaysApply ? true : undefined);

          rules.push({
            ...rule,
            ...(alwaysApply === undefined ? {} : { alwaysApply }),
            source: "colocated-markdown",
            sourceFile: filePath,
          });
        } else {
          const rule = markdownToRule(content, {
            uriType: "file",
            fileUri: filePath,
          });
          rules.push({
            ...rule,
            alwaysApply: rule.alwaysApply ?? true,
            source: "colocated-markdown",
            sourceFile: filePath,
          });
        }
      } catch (e) {
        errors.push({
          fatal: false,
          message: `Failed to parse colocated rule file ${filePath}: ${e instanceof Error ? e.message : e}`,
        });
      }
    }
  } catch (e) {
    errors.push({
      fatal: false,
      message: `Error loading colocated rule files: ${e instanceof Error ? e.message : e}`,
    });
  }

  return { rules, errors };
}
