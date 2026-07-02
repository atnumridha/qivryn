import { ToolPolicy } from "@continuedev/terminal-security";
import { Tool } from "../..";
import { ResolvedPath, resolveInputPath } from "../../util/pathResolver";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";
import { evaluateFileAccessPolicy } from "../policies/fileAccess";

function workspaceMutationPolicy(
  basePolicy: ToolPolicy,
  _args: Record<string, unknown>,
  processedArgs?: Record<string, unknown>,
): ToolPolicy {
  const resolvedPath = processedArgs?.resolvedPath as
    | ResolvedPath
    | null
    | undefined;
  return resolvedPath
    ? evaluateFileAccessPolicy(basePolicy, resolvedPath.isWithinWorkspace)
    : basePolicy;
}

const fileMutationPreprocessor: Tool["preprocessArgs"] = async (
  args,
  { ide },
) => ({
  resolvedPath: await resolveInputPath(ide, String(args.filepath ?? "")),
});

export const writeFileTool: Tool = {
  type: "function",
  displayTitle: "Write File",
  wouldLikeTo: "write {{{ filepath }}}",
  isCurrently: "writing {{{ filepath }}}",
  hasAlready: "wrote {{{ filepath }}}",
  group: BUILT_IN_GROUP_NAME,
  readonly: false,
  isInstant: true,
  function: {
    name: BuiltInToolNames.WriteFile,
    description:
      "Create or replace a complete file. Prefer targeted edit tools for small changes.",
    parameters: {
      type: "object",
      required: ["filepath", "contents"],
      properties: {
        filepath: { type: "string", description: "Workspace file path" },
        contents: { type: "string", description: "Complete new file contents" },
      },
    },
  },
  defaultToolPolicy: "allowedWithPermission",
  preprocessArgs: fileMutationPreprocessor,
  evaluateToolCallPolicy: workspaceMutationPolicy,
};

export const deleteFileTool: Tool = {
  type: "function",
  displayTitle: "Delete File",
  wouldLikeTo: "delete {{{ filepath }}}",
  isCurrently: "deleting {{{ filepath }}}",
  hasAlready: "deleted {{{ filepath }}}",
  group: BUILT_IN_GROUP_NAME,
  readonly: false,
  isInstant: true,
  function: {
    name: BuiltInToolNames.DeleteFile,
    description: "Delete an existing file from the workspace.",
    parameters: {
      type: "object",
      required: ["filepath"],
      properties: {
        filepath: { type: "string", description: "Workspace file path" },
      },
    },
  },
  defaultToolPolicy: "allowedWithPermission",
  preprocessArgs: fileMutationPreprocessor,
  evaluateToolCallPolicy: workspaceMutationPolicy,
};

export const readLintsTool: Tool = {
  type: "function",
  displayTitle: "Read Diagnostics",
  wouldLikeTo: "read editor diagnostics",
  isCurrently: "reading editor diagnostics",
  hasAlready: "read editor diagnostics",
  group: BUILT_IN_GROUP_NAME,
  readonly: true,
  isInstant: true,
  function: {
    name: BuiltInToolNames.ReadLints,
    description:
      "Read current compiler, language-server, lint, and editor diagnostics.",
    parameters: {
      type: "object",
      properties: {
        filepath: {
          type: "string",
          description: "Optional file path; omit for all workspace diagnostics",
        },
      },
    },
  },
  defaultToolPolicy: "allowedWithoutPermission",
};

export const goToDefinitionTool: Tool = {
  type: "function",
  displayTitle: "Go to Definition",
  wouldLikeTo: "find a symbol definition",
  isCurrently: "finding a symbol definition",
  hasAlready: "found symbol definitions",
  group: BUILT_IN_GROUP_NAME,
  readonly: true,
  isInstant: true,
  function: {
    name: BuiltInToolNames.GoToDefinition,
    description: "Resolve language-server definitions at a file position.",
    parameters: {
      type: "object",
      required: ["filepath", "line", "column"],
      properties: {
        filepath: { type: "string" },
        line: { type: "number", description: "One-based line number" },
        column: { type: "number", description: "One-based column number" },
      },
    },
  },
  defaultToolPolicy: "allowedWithoutPermission",
};

export const searchSymbolsTool: Tool = {
  type: "function",
  displayTitle: "Search Symbols",
  wouldLikeTo: "search code symbols",
  isCurrently: "searching code symbols",
  hasAlready: "searched code symbols",
  group: BUILT_IN_GROUP_NAME,
  readonly: true,
  isInstant: true,
  function: {
    name: BuiltInToolNames.SearchSymbols,
    description:
      "Search language-server document symbols in a file or currently open files.",
    parameters: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", description: "Case-insensitive symbol query" },
        filepath: { type: "string", description: "Optional file path" },
      },
    },
  },
  defaultToolPolicy: "allowedWithoutPermission",
};
