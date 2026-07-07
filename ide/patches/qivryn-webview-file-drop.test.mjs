import assert from "node:assert/strict";
import test from "node:test";

import { applyQivrynWebviewFileDrop } from "./qivryn-webview-file-drop.mjs";

const source = `export class WebviewWindowDragMonitor {
\tconstructor(targetWindow, getWebview) {
\t\tconst onDragStart = () => {
\t\t\tgetWebview()?.windowDidDragStart();
\t\t};
\t}
}`;

test("keeps Explorer drag events interactive over the Qivryn webview", () => {
  const transformed = applyQivrynWebviewFileDrop(source);

  assert.match(
    transformed,
    /webview\?\.providedViewType === 'qivryn\.qivrynGUIView'/,
  );
  assert.match(transformed, /webview\?\.windowDidDragStart\(\)/);
});

test("is idempotent", () => {
  const transformed = applyQivrynWebviewFileDrop(source);
  assert.equal(applyQivrynWebviewFileDrop(transformed), transformed);
});

test("preserves CRLF line endings in the Code OSS source", () => {
  const crlfSource = source.replaceAll("\n", "\r\n");
  const transformed = applyQivrynWebviewFileDrop(crlfSource);

  assert.match(
    transformed,
    /webview\?\.providedViewType === 'qivryn\.qivrynGUIView'/,
  );
  assert.match(transformed, /\r\n\t\t\twebview\?\.windowDidDragStart\(\);/);
});
