export const targetFile =
  "src/vs/workbench/contrib/webview/browser/webviewWindowDragMonitor.ts";

const marker = "// Qivryn composer file drop";

export function applyQivrynWebviewFileDrop(source) {
  if (source.includes(marker)) {
    return source;
  }

  const anchor = `\t\tconst onDragStart = () => {\n\t\t\tgetWebview()?.windowDidDragStart();\n\t\t};`;
  if (!source.includes(anchor)) {
    throw new Error(
      "Pinned Code - OSS anchor not found for Qivryn webview file drop",
    );
  }

  return source.replace(
    anchor,
    `\t\tconst onDragStart = () => {\n\t\t\tconst webview = getWebview();\n\t\t\t${marker}\n\t\t\tif (webview?.providedViewType === 'qivryn.qivrynGUIView') {\n\t\t\t\treturn;\n\t\t\t}\n\t\t\twebview?.windowDidDragStart();\n\t\t};`,
  );
}
