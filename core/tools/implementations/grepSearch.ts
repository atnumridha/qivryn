import { ToolImpl } from ".";
import { ContextItem } from "../..";
import { ContinueError, ContinueErrorReason } from "../../util/errors";
import { formatGrepSearchResults } from "../../util/grepSearch";
import { prepareQueryForRipgrep } from "../../util/regexValidator";
import { getStringArg } from "../parseArgs";

const DEFAULT_GREP_SEARCH_RESULTS_LIMIT = 100;
const DEFAULT_GREP_SEARCH_CHAR_LIMIT = 7500; // ~1500 tokens, will keep truncation simply for now

function splitGrepResultsByFile(content: string): ContextItem[] {
  const matches = [...content.matchAll(/^\.\/([^\n]+)$/gm)];

  const contextItems: ContextItem[] = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const filepath = match[1];
    const startIndex = match.index!;
    const endIndex =
      i < matches.length - 1 ? matches[i + 1].index! : content.length;

    // Extract grepped content for this file
    const fileContent = content
      .substring(startIndex, endIndex)
      .replace(/^\.\/[^\n]+\n/, "") // remove the line with file path
      .trim();

    if (fileContent) {
      contextItems.push({
        name: `Search results in ${filepath}`,
        description: `Grep search results from ${filepath}`,
        content: fileContent,
        uri: { type: "file", value: filepath },
      });
    }
  }

  return contextItems;
}

export const grepSearchImpl: ToolImpl = async (args, extras) => {
  const rawQuery = getStringArg(args, "query");

  const prepared = prepareQueryForRipgrep(rawQuery);
  const query = args.fixed_strings === true ? rawQuery : prepared.query;
  const warning = args.fixed_strings === true ? undefined : prepared.warning;

  const outputMode = ["content", "files_with_matches", "count"].includes(
    String(args.output_mode),
  )
    ? (String(args.output_mode) as "content" | "files_with_matches" | "count")
    : "content";
  const headLimit = Math.min(
    1_000,
    Math.max(1, Number(args.head_limit) || DEFAULT_GREP_SEARCH_RESULTS_LIMIT),
  );
  const optionalNumber = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, Math.trunc(value))
      : undefined;

  let results: string;
  try {
    results = await extras.ide.getSearchResults(query, headLimit, {
      path: typeof args.path === "string" ? args.path : undefined,
      glob: typeof args.glob === "string" ? args.glob : undefined,
      outputMode,
      contextBefore: optionalNumber(args.context_before),
      contextAfter: optionalNumber(args.context_after),
      context: optionalNumber(args.context),
      caseInsensitive:
        typeof args.case_insensitive === "boolean"
          ? args.case_insensitive
          : true,
      fixedStrings: args.fixed_strings === true,
      fileType: typeof args.type === "string" ? args.type : undefined,
      multiline: args.multiline === true,
      sort:
        typeof args.sort === "string"
          ? (args.sort as "path" | "modified" | "accessed" | "created")
          : undefined,
      sortAscending:
        typeof args.sort_ascending === "boolean" ? args.sort_ascending : true,
      offset: optionalNumber(args.offset),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Helpful error for common ripgrep exit code
    if (errorMessage.includes("Process exited with code 2")) {
      return [
        {
          name: "Search error",
          description: "The search query could not be processed",
          content: `The search failed due to an invalid regex pattern.\n\nOriginal query: ${rawQuery}\nProcessed query: ${query}\n\nError: ${errorMessage}\n\nTip: If you're searching for literal text with special characters, the query was automatically escaped. If you need regex patterns, ensure they use proper regex syntax.`,
        },
      ];
    }

    throw new ContinueError(
      ContinueErrorReason.SearchExecutionFailed,
      errorMessage,
    );
  }

  if (outputMode !== "content") {
    return [
      {
        name:
          outputMode === "count" ? "Search result counts" : "Matching files",
        description: `Results for ${rawQuery}`,
        content: results.trim() || "The search returned no results.",
      },
    ];
  }

  const { formatted, numResults, truncated } = formatGrepSearchResults(
    results,
    DEFAULT_GREP_SEARCH_CHAR_LIMIT,
  );

  if (numResults === 0) {
    return [
      {
        name: "Search results",
        description: "Results from grep search",
        content: "The search returned no results.",
      },
    ];
  }

  const truncationReasons: string[] = [];
  if (numResults === headLimit) {
    truncationReasons.push(`the number of results reached ${headLimit}`);
  }
  if (truncated) {
    truncationReasons.push(
      `the number of characters exceeded ${DEFAULT_GREP_SEARCH_CHAR_LIMIT}`,
    );
  }

  let contextItems: ContextItem[];

  const splitByFile: boolean = args?.splitByFile || false;
  if (splitByFile) {
    contextItems = splitGrepResultsByFile(formatted);
  } else {
    contextItems = [
      {
        name: "Search results",
        description: "Results from grep search",
        content: formatted,
      },
    ];
  }

  // Add warnings about query modifications or truncation
  const warnings: string[] = [];
  if (warning) {
    warnings.push(warning);
  }
  if (truncationReasons.length > 0) {
    warnings.push(
      `Results were truncated because ${truncationReasons.join(" and ")}`,
    );
  }

  if (truncationReasons.length > 0) {
    contextItems.push({
      name: "Truncation warning",
      description: "",
      content: `The above search results were truncated because ${truncationReasons.join(" and ")}. If the results are not satisfactory, try refining your search query.`,
    });
  }
  return contextItems;
};
