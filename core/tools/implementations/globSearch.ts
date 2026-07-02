import { ToolImpl } from ".";
import { ContextItem } from "../..";
import { getStringArg } from "../parseArgs";

const MAX_AGENT_GLOB_RESULTS = 100;

export const fileGlobSearchImpl: ToolImpl = async (args, extras) => {
  let pattern = getStringArg(args, "pattern");
  const searchPath =
    typeof args.path === "string"
      ? args.path.trim().replace(/\\/g, "/").replace(/^\.\//, "")
      : "";
  if (
    searchPath.startsWith("/") ||
    /^[a-zA-Z]:\//.test(searchPath) ||
    searchPath.split("/").includes("..")
  ) {
    throw new Error("Glob search path must stay within the workspace");
  }
  if (searchPath) pattern = `${searchPath.replace(/\/$/, "")}/${pattern}`;
  const limit = Math.min(
    1_000,
    Math.max(1, Number(args.head_limit) || MAX_AGENT_GLOB_RESULTS),
  );
  const results = await extras.ide.getFileResults(pattern, limit);

  if (results.length === 0) {
    return [
      {
        name: "File results",
        description: "glob search",
        content: "The glob search returned no results.",
      },
    ];
  }
  const contextItems: ContextItem[] = [
    {
      name: "File results",
      description: "glob search",
      content: results.join("\n"),
    },
  ];

  // In case of truncation, add a warning
  if (results.length === limit) {
    contextItems.push({
      name: "Truncation warning",
      description: "",
      content: `Warning: the results above were truncated to the first ${limit} files. If the results are not satisfactory, refine your search pattern`,
    });
  }

  return contextItems;
};
