import { DocumentSymbol } from "../..";
import { throwIfFileIsSecurityConcern } from "../../indexing/ignore";
import { inferResolvedUriFromRelativePath } from "../../util/ideUtils";
import { resolveInputPath } from "../../util/pathResolver";
import { getCleanUriPath, getUriPathBasename } from "../../util/uri";
import { ContinueError, ContinueErrorReason } from "../../util/errors";
import { getStringArg } from "../parseArgs";
import { ToolImpl } from ".";

export const writeFileImpl: ToolImpl = async (args, extras) => {
  const filepath = getStringArg(args, "filepath");
  const contents = getStringArg(args, "contents", true);
  const uri = await inferResolvedUriFromRelativePath(filepath, extras.ide);
  if (!uri) {
    throw new ContinueError(
      ContinueErrorReason.PathResolutionFailed,
      `Could not resolve ${filepath}`,
    );
  }
  throwIfFileIsSecurityConcern(getCleanUriPath(uri));
  await extras.ide.writeFile(uri, contents);
  await extras.ide.saveFile(uri);
  void extras.codeBaseIndexer?.refreshCodebaseIndexFiles([uri]);
  return [
    {
      name: getUriPathBasename(uri),
      description: getCleanUriPath(uri),
      content: "File written successfully",
      uri: { type: "file", value: uri },
    },
  ];
};

export const deleteFileImpl: ToolImpl = async (args, extras) => {
  const filepath = getStringArg(args, "filepath");
  const resolved = await resolveInputPath(extras.ide, filepath);
  if (!resolved) {
    throw new ContinueError(
      ContinueErrorReason.FileNotFound,
      `File ${filepath} does not exist`,
    );
  }
  throwIfFileIsSecurityConcern(resolved.displayPath);
  await extras.ide.removeFile(resolved.uri);
  void extras.codeBaseIndexer?.refreshCodebaseIndexFiles([resolved.uri]);
  return [
    {
      name: getUriPathBasename(resolved.uri),
      description: resolved.displayPath,
      content: "File deleted successfully",
    },
  ];
};

export const readLintsImpl: ToolImpl = async (args, extras) => {
  const filepath =
    typeof args.filepath === "string" && args.filepath.trim()
      ? (await resolveInputPath(extras.ide, args.filepath))?.uri
      : undefined;
  const problems = await extras.ide.getProblems(filepath);
  return [
    {
      name: "Diagnostics",
      description: filepath ? getCleanUriPath(filepath) : "Workspace",
      content:
        problems.length === 0
          ? "No diagnostics found."
          : problems
              .map(
                (problem) =>
                  `${getCleanUriPath(problem.filepath)}:${problem.range.start.line + 1}:${problem.range.start.character + 1} ${problem.message}`,
              )
              .join("\n"),
    },
  ];
};

export const goToDefinitionImpl: ToolImpl = async (args, extras) => {
  const filepath = getStringArg(args, "filepath");
  const resolved = await resolveInputPath(extras.ide, filepath);
  if (!resolved) throw new Error(`File ${filepath} does not exist`);
  const line = Math.max(0, Number(args.line ?? 1) - 1);
  const column = Math.max(0, Number(args.column ?? 1) - 1);
  const definitions = await extras.ide.gotoDefinition({
    filepath: resolved.uri,
    position: { line, character: column },
  });
  return [
    {
      name: "Definitions",
      description: resolved.displayPath,
      content:
        definitions.length === 0
          ? "No definitions found."
          : definitions
              .map(
                (definition) =>
                  `${getCleanUriPath(definition.filepath)}:${definition.range.start.line + 1}:${definition.range.start.character + 1}`,
              )
              .join("\n"),
    },
  ];
};

function flattenSymbols(
  symbols: DocumentSymbol[],
  prefix = "",
): Array<{ name: string; detail?: string; line: number }> {
  return symbols.flatMap((symbol) => {
    const qualified = prefix ? `${prefix}.${symbol.name}` : symbol.name;
    return [
      {
        name: qualified,
        detail: symbol.detail,
        line: symbol.selectionRange.start.line + 1,
      },
      ...flattenSymbols(symbol.children ?? [], qualified),
    ];
  });
}

export const searchSymbolsImpl: ToolImpl = async (args, extras) => {
  const query = getStringArg(args, "query").toLowerCase();
  const explicit =
    typeof args.filepath === "string" && args.filepath.trim()
      ? await resolveInputPath(extras.ide, args.filepath)
      : undefined;
  const files = explicit ? [explicit.uri] : await extras.ide.getOpenFiles();
  const matches: string[] = [];
  for (const file of files.slice(0, 50)) {
    const symbols = flattenSymbols(await extras.ide.getDocumentSymbols(file));
    for (const symbol of symbols) {
      if (!symbol.name.toLowerCase().includes(query)) continue;
      matches.push(
        `${getCleanUriPath(file)}:${symbol.line} ${symbol.name}${symbol.detail ? ` — ${symbol.detail}` : ""}`,
      );
      if (matches.length >= 200) break;
    }
    if (matches.length >= 200) break;
  }
  return [
    {
      name: "Symbol search",
      description: `Query: ${query}`,
      content: matches.length
        ? matches.join("\n")
        : "No matching symbols found.",
    },
  ];
};
