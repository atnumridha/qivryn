import {
  BlockType,
  ConfigYaml,
  createPromptMarkdown,
  createRuleMarkdown,
  sanitizeRuleName,
} from "@qivryn/config-yaml";
import * as YAML from "yaml";
import { IDE } from "../..";
import { getQivrynGlobalPath } from "../../util/paths";
import { localPathToUri } from "../../util/pathToUri";
import { joinPathsToUri } from "../../util/uri";

const BLOCK_TYPE_CONFIG: Record<
  BlockType,
  { singular: string; filename: string }
> = {
  context: { singular: "context", filename: "context" },
  models: { singular: "model", filename: "model" },
  rules: { singular: "rule", filename: "rule" },
  docs: { singular: "doc", filename: "doc" },
  prompts: { singular: "prompt", filename: "prompt" },
  mcpServers: { singular: "MCP server", filename: "mcp-server" },
  data: { singular: "data", filename: "data" },
};

export type RuleApplicationMode = "always" | "auto" | "agent" | "manual";

export interface NewRuleFileOptions {
  baseFilename?: string;
  ruleType?: RuleApplicationMode;
  description?: string;
  globs?: string;
}

function humanizeRuleName(baseFilename?: string): string {
  const trimmed = baseFilename?.trim();
  if (!trimmed) {
    return "New Rule";
  }

  const withoutExtension = trimmed.replace(/\.[^./\\]+$/, "");
  return withoutExtension
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function parseRulePatterns(patterns?: string): string | string[] | undefined {
  const parts = patterns
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (!parts || parts.length === 0) {
    return undefined;
  }

  return parts.length === 1 ? parts[0] : parts;
}

function getRuleFileContent(options?: NewRuleFileOptions): string {
  const name = humanizeRuleName(options?.baseFilename);
  const ruleType = options?.ruleType ?? "always";
  const description = options?.description?.trim();
  const globs = parseRulePatterns(options?.globs);

  switch (ruleType) {
    case "auto":
      return createRuleMarkdown(
        name,
        `# ${name}\n\n- Describe the guidance that should apply when the matched files are in context.\n- Include project-specific conventions, pitfalls, and validation expectations.`,
        {
          description:
            description ||
            "Guidance that applies when matching files are referenced.",
          globs: globs || "**/*.{ts,tsx,js,jsx}",
          alwaysApply: false,
        },
      );
    case "agent":
      return createRuleMarkdown(
        name,
        `# ${name}\n\n- Describe when the agent should request this rule.\n- Include the workflow, evidence, and validation standard for that situation.`,
        {
          description:
            description || "Use when this topic or workflow is relevant.",
          alwaysApply: false,
        },
      );
    case "manual":
      return createRuleMarkdown(
        name,
        `# ${name}\n\n- Add guidance that should only be used when this rule is explicitly mentioned.`,
        {
          alwaysApply: false,
        },
      );
    case "always":
    default:
      return createRuleMarkdown(
        name,
        `# ${name}\n\n- Add durable project guidance that should be included in every chat and agent request.\n- Prefer concrete constraints, conventions, and verification expectations over vague preferences.`,
        {
          description:
            description || "Always included in model context for this scope.",
          alwaysApply: true,
        },
      );
  }
}

function getContentsForNewBlock(blockType: BlockType): ConfigYaml {
  const configYaml: ConfigYaml = {
    name: `New ${BLOCK_TYPE_CONFIG[blockType]?.singular}`,
    version: "0.0.1",
    schema: "v1",
  };
  switch (blockType) {
    case "context":
      configYaml.context = [
        {
          provider: "file",
        },
      ];
      break;
    case "models":
      configYaml.models = [
        {
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          apiKey: "${{ secrets.ANTHROPIC_API_KEY }}",
          name: "Claude Sonnet 4.6",
          roles: ["chat", "edit"],
        },
      ];
      break;
    case "rules":
      configYaml.rules = ["Always give concise responses"];
      break;
    case "docs":
      configYaml.docs = [
        {
          name: "New docs",
          startUrl: "https://docs.qivryn.ai",
        },
      ];
      break;
    case "prompts":
      configYaml.prompts = [
        {
          name: "New prompt",
          description: "New prompt",
          prompt:
            "Please write a thorough suite of unit tests for this code, making sure to cover all relevant edge cases",
        },
      ];
      break;
    case "mcpServers":
      configYaml.mcpServers = [
        {
          name: "New MCP server",
          command: "npx",
          args: ["-y", "<your-mcp-server>"],
          env: {},
        },
      ];
      break;
  }

  return configYaml;
}

function getFileExtension(blockType: BlockType): string {
  if (blockType === "rules" || blockType === "prompts") {
    return "md";
  }
  return "yaml";
}

export function getFileContent(
  blockType: BlockType,
  options?: NewRuleFileOptions,
): string {
  if (blockType === "rules") {
    return getRuleFileContent(options);
  } else if (blockType === "prompts") {
    return createPromptMarkdown(
      "New prompt",
      "Please write a thorough suite of unit tests for this code, making sure to cover all relevant edge cases",
      {
        description: "New prompt",
        invokable: true,
      },
    );
  } else {
    return YAML.stringify(getContentsForNewBlock(blockType));
  }
}

export async function findAvailableFilename(
  baseDirUri: string,
  blockType: BlockType,
  fileExists: (uri: string) => Promise<boolean>,
  extension?: string,
  isGlobal?: boolean,
  baseFilenameOverride?: string,
): Promise<string> {
  const fileExtension = extension ?? getFileExtension(blockType);
  let baseFilename = "";

  const trimmedOverride = baseFilenameOverride?.trim();
  if (trimmedOverride) {
    if (blockType === "rules") {
      const withoutExtension = trimmedOverride.replace(/\.[^./\\]+$/, "");
      const sanitized = sanitizeRuleName(withoutExtension);
      baseFilename = sanitized;
    } else {
      baseFilename = trimmedOverride;
    }
  }
  if (!baseFilename) {
    baseFilename =
      blockType === "rules" && isGlobal
        ? "global-rule"
        : `new-${BLOCK_TYPE_CONFIG[blockType]?.filename}`;
  }

  let counter = 0;
  let fileUri: string;

  do {
    const suffix = counter === 0 ? "" : `-${counter}`;
    fileUri = joinPathsToUri(
      baseDirUri,
      `${baseFilename}${suffix}.${fileExtension}`,
    );
    counter++;
  } while (await fileExists(fileUri));

  return fileUri;
}

export async function createNewWorkspaceBlockFile(
  ide: IDE,
  blockType: BlockType,
  options?: string | NewRuleFileOptions,
): Promise<void> {
  const normalizedOptions: NewRuleFileOptions =
    typeof options === "string" ? { baseFilename: options } : (options ?? {});

  const workspaceDirs = await ide.getWorkspaceDirs();
  if (workspaceDirs.length === 0) {
    throw new Error(
      "No workspace directories found. Make sure you've opened a folder in your IDE.",
    );
  }

  const baseDirUri = joinPathsToUri(workspaceDirs[0], `.qivryn/${blockType}`);

  const fileUri = await findAvailableFilename(
    baseDirUri,
    blockType,
    ide.fileExists.bind(ide),
    undefined,
    false,
    normalizedOptions.baseFilename,
  );

  const fileContent = getFileContent(blockType, normalizedOptions);

  await ide.writeFile(fileUri, fileContent);
  await ide.openFile(fileUri);
}

export async function createNewGlobalRuleFile(
  ide: IDE,
  options?: string | NewRuleFileOptions,
): Promise<void> {
  const normalizedOptions: NewRuleFileOptions =
    typeof options === "string" ? { baseFilename: options } : (options ?? {});

  try {
    const globalDir = localPathToUri(getQivrynGlobalPath());

    // Create the rules subdirectory within the global directory
    const rulesDir = joinPathsToUri(globalDir, "rules");

    const fileUri = await findAvailableFilename(
      rulesDir,
      "rules",
      ide.fileExists.bind(ide),
      undefined,
      true, // isGlobal = true for global rules
      normalizedOptions.baseFilename,
    );

    const fileContent = getFileContent("rules", normalizedOptions);

    await ide.writeFile(fileUri, fileContent);

    await ide.openFile(fileUri);
  } catch (error) {
    throw error;
  }
}
