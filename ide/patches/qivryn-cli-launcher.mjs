export const targetFile = "build/gulpfile.vscode.ts";

const marker = "// Qivryn product CLI launcher";

export function applyQivrynCliLauncher(source) {
  if (source.includes(marker)) return source;
  const anchor = `.pipe(rename('bin/code'));`;
  const replacement = `.pipe(rename('bin/' + product.applicationName)); ${marker}`;
  const index = source.indexOf(anchor);
  if (index < 0) {
    throw new Error(
      "Pinned Code - OSS anchor not found for the Qivryn macOS CLI launcher",
    );
  }
  return `${source.slice(0, index)}${replacement}${source.slice(index + anchor.length)}`;
}
