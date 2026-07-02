import { Tool } from "../..";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const grepSearchTool: Tool = {
  type: "function",
  displayTitle: "Grep Search",
  wouldLikeTo: 'search for "{{{ query }}}"',
  isCurrently: 'searching for "{{{ query }}}"',
  hasAlready: 'searched for "{{{ query }}}"',
  readonly: true,
  isInstant: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.GrepSearch,
    description:
      "Performs a regular expression (regex) search over the repository using ripgrep. Will not include results for many build, cache, secrets dirs/files. Output may be truncated, so use targeted queries",
    parameters: {
      type: "object",
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description:
            "The regex pattern to search for within file contents. Use regex with alternation (e.g., 'word1|word2|word3') or character classes to find multiple potential words in a single search.",
        },
        path: {
          type: "string",
          description:
            "Optional workspace-relative directory or file to search. Never use an absolute path.",
        },
        glob: {
          type: "string",
          description: "Optional glob filter such as '**/*.{ts,tsx}'.",
        },
        output_mode: {
          type: "string",
          enum: ["content", "files_with_matches", "count"],
          description:
            "Return matching content (default), only matching file names, or counts by file.",
        },
        context_before: {
          type: "number",
          description: "Lines of context before each content match.",
        },
        context_after: {
          type: "number",
          description: "Lines of context after each content match.",
        },
        context: {
          type: "number",
          description: "Lines of context before and after each content match.",
        },
        case_insensitive: {
          type: "boolean",
          description: "Use case-insensitive matching (default true).",
        },
        fixed_strings: {
          type: "boolean",
          description: "Treat the query as literal text instead of regex.",
        },
        type: {
          type: "string",
          description:
            "Optional ripgrep file type filter such as ts, py, or rust.",
        },
        head_limit: {
          type: "number",
          description: "Maximum number of results to return (default 100).",
        },
        multiline: {
          type: "boolean",
          description: "Allow the pattern to match across line boundaries.",
        },
        sort: {
          type: "string",
          enum: ["path", "modified", "accessed", "created"],
          description: "Optional deterministic result ordering.",
        },
        sort_ascending: {
          type: "boolean",
          description:
            "Sort ascending (default true); false reverses the order.",
        },
        offset: {
          type: "number",
          description: "Skip results when using file-name or count output.",
        },
        splitByFile: {
          type: "boolean",
          description: "Return one context item per matching file.",
        },
      },
    },
  },
  defaultToolPolicy: "allowedWithoutPermission",
  systemMessageDescription: {
    prefix: `To perform a grep search within the project, call the ${BuiltInToolNames.GrepSearch} tool with the query pattern to match. For example:`,
    exampleArgs: [["query", ".*main_services.*"]],
  },
  toolCallIcon: "MagnifyingGlassIcon",
};
