const { exec } = require("child_process");
const fs = require("fs");

const version = JSON.parse(
  fs.readFileSync("./package.json", { encoding: "utf-8" }),
).version;

const args = process.argv.slice(2);
let target;

if (args[0] === "--target") {
  target = args[1];
}

if (!fs.existsSync("build")) {
  fs.mkdirSync("build");
}

const isPreRelease = args.includes("--pre-release");

const outputPath = `./build/qivryn-${version}.vsix`;
let command = isPreRelease
  ? `npx @vscode/vsce package --out ${outputPath} --pre-release --no-dependencies` // --yarn"
  : `npx @vscode/vsce package --out ${outputPath} --no-dependencies`; // --yarn";

if (target) {
  command += ` --target ${target}`;
}

exec(command, (error) => {
  if (error) {
    throw error;
  }
  console.log(
    `vsce package completed - extension created at extensions/vscode/build/qivryn-${version}.vsix`,
  );
});
