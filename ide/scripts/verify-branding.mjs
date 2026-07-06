import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const ideDirectory = path.join(repositoryRoot, "ide");
const preparedDirectory = path.join(ideDirectory, ".build", "vscode");
const packageDirectory = path.join(
  ideDirectory,
  ".build",
  "VSCode-darwin-arm64",
);
const forbiddenBrand = /(?:^|[._\s-])(cursor|codie)(?:$|[._\s-])/i;
const errors = [];

const overlay = readJson(path.join(ideDirectory, "product.overlay.json"));
for (const [key, value] of Object.entries(overlay.set ?? {})) {
  if (typeof value === "string" && forbiddenBrand.test(value)) {
    errors.push(`Product overlay ${key} contains forbidden branding: ${value}`);
  }
}

if (fs.existsSync(preparedDirectory)) {
  const product = readJson(path.join(preparedDirectory, "product.json"));
  for (const key of [
    "nameShort",
    "nameLong",
    "applicationName",
    "dataFolderName",
    "darwinBundleIdentifier",
    "linuxIconName",
    "urlProtocol",
  ]) {
    const value = product[key];
    if (typeof value === "string" && forbiddenBrand.test(value)) {
      errors.push(
        `Prepared product ${key} contains forbidden branding: ${value}`,
      );
    }
  }
}

for (const root of [
  path.join(ideDirectory, "branding"),
  path.join(ideDirectory, "builtin"),
]) {
  if (!fs.existsSync(root)) continue;
  walk(root, (filepath) => {
    if (forbiddenBrand.test(path.basename(filepath))) {
      errors.push(
        `Forbidden product asset filename: ${path.relative(repositoryRoot, filepath)}`,
      );
    }
  });
}

const packagedApp = path.join(packageDirectory, "Qivryn Agent IDE.app");
if (fs.existsSync(packagedApp)) {
  const infoPath = path.join(packagedApp, "Contents", "Info.plist");
  const info = fs.readFileSync(infoPath, "utf8");
  for (const brand of ["Cursor", "Codie"]) {
    if (new RegExp(`<string>[^<]*${brand}[^<]*</string>`, "i").test(info)) {
      errors.push(`Packaged Info.plist contains forbidden ${brand} identity`);
    }
  }
  const resources = path.join(packagedApp, "Contents", "Resources");
  const qivrynIcon = path.join(resources, "Qivryn.icns");
  if (!fs.existsSync(qivrynIcon)) {
    errors.push("Packaged macOS app is missing Qivryn.icns");
  }
  for (const entry of fs.readdirSync(resources, { withFileTypes: true })) {
    if (
      entry.isFile() &&
      /\.(?:icns|ico|png|svg)$/i.test(entry.name) &&
      forbiddenBrand.test(entry.name)
    ) {
      errors.push(`Forbidden packaged product asset: ${entry.name}`);
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    "Branding verification passed: product-facing identity and assets are Qivryn-only.",
  );
}

function readJson(filepath) {
  return JSON.parse(fs.readFileSync(filepath, "utf8"));
}

function walk(root, visit) {
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const filepath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(filepath);
      else visit(filepath);
    }
  }
}
