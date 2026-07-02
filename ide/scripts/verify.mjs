import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertProductOverlay } from "./product.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const ideDirectory = path.resolve(scriptDirectory, "..");
const vscodeDirectory = path.join(ideDirectory, ".build", "vscode");

function readJson(filepath) {
  return JSON.parse(fs.readFileSync(filepath, "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const upstream = readJson(path.join(ideDirectory, "upstream.json"));
const overlay = readJson(path.join(ideDirectory, "product.overlay.json"));
const product = readJson(path.join(vscodeDirectory, "product.json"));
const qivrynExtension = readJson(
  path.join(vscodeDirectory, "extensions", "qivryn", "package.json"),
);
const foundationExtension = readJson(
  path.join(vscodeDirectory, "extensions", "qivryn-foundation", "package.json"),
);
const license = fs.readFileSync(
  path.join(vscodeDirectory, "LICENSE.txt"),
  "utf8",
);

assertProductOverlay(product, overlay);

assert(qivrynExtension.name === "qivryn", "Qivryn extension was not staged");
assert(
  foundationExtension.name === "qivryn-foundation",
  "Qivryn foundation extension was not staged",
);
assert(
  license.includes("MIT License") && license.includes("Microsoft Corporation"),
  "The upstream Code - OSS MIT license is missing",
);

console.log(
  JSON.stringify(
    {
      product: product.nameLong,
      applicationName: product.applicationName,
      upstreamRef: upstream.ref,
      upstreamCommit: upstream.commit,
      qivrynExtension: qivrynExtension.version,
      foundationExtension: foundationExtension.version,
      license: upstream.license,
    },
    null,
    2,
  ),
);
