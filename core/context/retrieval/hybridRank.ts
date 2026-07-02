import type { Chunk, ContinueConfig } from "../..";

export interface HybridSources {
  lexical: Chunk[];
  semantic: Chunk[];
  recent: Chunk[];
  symbols: Chunk[];
  tools?: Chunk[];
}

function key(chunk: Chunk): string {
  return `${chunk.filepath}:${chunk.startLine}:${chunk.endLine}:${chunk.digest}`;
}

export function rankHybridChunks(
  query: string,
  sources: HybridSources,
  gitRecentPaths: string[],
  limit: number,
): Chunk[] {
  const scores = new Map<string, { chunk: Chunk; score: number }>();
  const weighted: Array<[Chunk[], number]> = [
    [sources.semantic, 1],
    [sources.lexical, 0.9],
    [sources.symbols, 0.75],
    [sources.recent, 0.6],
    [sources.tools ?? [], 1],
  ];
  for (const [chunks, weight] of weighted) {
    chunks.forEach((chunk, index) => {
      const id = key(chunk);
      const current = scores.get(id) ?? { chunk, score: 0 };
      current.score += weight / (60 + index + 1);
      scores.set(id, current);
    });
  }
  const queryTokens = query
    .toLowerCase()
    .split(/[^a-z0-9_$]+/)
    .filter(Boolean);
  for (const value of scores.values()) {
    const signature = value.chunk.signature?.toLowerCase() ?? "";
    if (queryTokens.some((token) => signature.includes(token)))
      value.score += 0.02;
    const filepath = value.chunk.filepath.replace(/\\/g, "/");
    const gitIndex = gitRecentPaths.findIndex((candidate) =>
      filepath.endsWith(candidate),
    );
    if (gitIndex >= 0) value.score += 0.02 / (gitIndex + 1);
  }
  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((value) => value.chunk);
}

const LOCAL_PROVIDERS = new Set([
  "ollama",
  "llamacpp",
  "llama.cpp",
  "lmstudio",
  "llamafile",
  "mock",
  "transformers.js",
]);
function isLoopback(value?: string): boolean {
  if (!value) return false;
  try {
    return ["localhost", "127.0.0.1", "::1"].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}

export function assertLocalOnlyRetrieval(config: ContinueConfig): void {
  if (!config.experimental?.localOnly) return;
  for (const [role, model] of Object.entries(config.selectedModelByRole)) {
    if (!model) continue;
    const provider = (model.providerName ?? "").toLowerCase();
    const apiBase = (model as unknown as { apiBase?: string }).apiBase;
    if (!LOCAL_PROVIDERS.has(provider) && !isLoopback(apiBase)) {
      throw new Error(
        `Local-only mode blocked remote ${role} provider ${model.providerName}`,
      );
    }
  }
}
