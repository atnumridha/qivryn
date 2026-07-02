export type CommitMessageCompleter = (prompt: string) => Promise<string>;

export function buildCommitMessagePrompt(diff: string): string {
  return `${diff}\n\nWrite a Git commit message for these changes. Use an imperative subject of at most 72 characters. Optionally add a blank line and up to five concise bullet points. Output only the commit message without quotes or Markdown fences.`;
}

export function normalizeCommitMessage(value: string): string {
  return value
    .trim()
    .replace(/^```(?:text)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function fallbackCommitMessage(diff: string): string {
  const files = [...diff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)].map(
    (match) => match[2],
  );
  const unique = [...new Set(files)];
  if (unique.length === 0) return "Update project files";
  const subject =
    unique.length === 1
      ? `Update ${unique[0]}`
      : `Update ${unique.length} project files`;
  const details = unique.slice(0, 5).map((file) => `- Update ${file}`);
  return details.length > 1 ? `${subject}\n\n${details.join("\n")}` : subject;
}

export async function generateCommitMessage(
  diff: string,
  complete?: CommitMessageCompleter,
): Promise<string> {
  if (!diff.trim()) throw new Error("No Git changes found");
  if (!complete) return fallbackCommitMessage(diff);
  const generated = normalizeCommitMessage(
    await complete(buildCommitMessagePrompt(diff)),
  );
  return generated || fallbackCommitMessage(diff);
}
