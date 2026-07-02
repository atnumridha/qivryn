import type { DiffLine } from "core";

export interface MaterializedBackgroundEdit {
  content: string;
  changedLines: number;
}

/** Materialize a streamed diff without requiring a visible editor. */
export async function materializeBackgroundEdit(
  originalContent: string,
  diffLines: AsyncIterable<DiffLine>,
): Promise<MaterializedBackgroundEdit> {
  const lines: string[] = [];
  let changedLines = 0;

  for await (const line of diffLines) {
    if (line.type !== "old") lines.push(line.line);
    if (line.type !== "same") changedLines++;
  }

  const lineEnding = originalContent.includes("\r\n") ? "\r\n" : "\n";
  let content = lines.join(lineEnding);
  if (
    /\r?\n$/.test(originalContent) &&
    content &&
    !content.endsWith(lineEnding)
  ) {
    content += lineEnding;
  }

  return { content, changedLines };
}
