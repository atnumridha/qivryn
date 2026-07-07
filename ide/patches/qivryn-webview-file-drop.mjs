export const targetFile =
  "src/vs/workbench/contrib/webview/browser/webviewWindowDragMonitor.ts";

const marker = "// Qivryn composer file drop";

export function applyQivrynWebviewFileDrop(source) {
  if (source.includes(marker)) {
    return source;
  }

  const anchor =
    /(\t\tconst onDragStart = \(\) => \{)(\r?\n)(\t\t\tgetWebview\(\)\?\.windowDidDragStart\(\);)(\r?\n)(\t\t};)/;
  const match = source.match(anchor);
  if (!match) {
    throw new Error(
      "Pinned Code - OSS anchor not found for Qivryn webview file drop",
    );
  }

  const eol = match[2];
  return source.replace(
    anchor,
    [
      "\t\tconst onDragStart = () => {",
      "\t\t\tconst webview = getWebview();",
      `\t\t\t${marker}`,
      "\t\t\tif (webview?.providedViewType === 'qivryn.qivrynGUIView') {",
      "\t\t\t\treturn;",
      "\t\t\t}",
      "\t\t\twebview?.windowDidDragStart();",
      "\t\t};",
    ].join(eol),
  );
}
