import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const ideDirectory = path.resolve(scriptDirectory, "..");
const repositoryRoot = path.resolve(ideDirectory, "..");
const source = path.join(repositoryRoot, "media", "brand", "qivryn-mark.png");
const outputDirectory = path.join(ideDirectory, "branding");
const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "qivryn-icons-"),
);

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

function resize(size) {
  const output = path.join(temporaryDirectory, `${size}.png`);
  run("sips", ["-z", String(size), String(size), source, "--out", output]);
  return fs.readFileSync(output);
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

function icnsEntry(type, png) {
  return Buffer.concat([
    Buffer.from(type, "ascii"),
    uint32(png.length + 8),
    png,
  ]);
}

function writeIcns(images) {
  const entries = [
    icnsEntry("icp4", images.get(16)),
    icnsEntry("icp5", images.get(32)),
    icnsEntry("icp6", images.get(64)),
    icnsEntry("ic07", images.get(128)),
    icnsEntry("ic08", images.get(256)),
    icnsEntry("ic09", images.get(512)),
    icnsEntry("ic10", images.get(1024)),
    icnsEntry("ic11", images.get(32)),
    icnsEntry("ic12", images.get(64)),
    icnsEntry("ic13", images.get(256)),
    icnsEntry("ic14", images.get(512)),
  ];
  const body = Buffer.concat(entries);
  fs.writeFileSync(
    path.join(outputDirectory, "qivryn.icns"),
    Buffer.concat([
      Buffer.from("icns", "ascii"),
      uint32(body.length + 8),
      body,
    ]),
  );
}

function writeIco(png) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt8(0, 6);
  header.writeUInt8(0, 7);
  header.writeUInt8(0, 8);
  header.writeUInt8(0, 9);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(header.length, 18);
  fs.writeFileSync(
    path.join(outputDirectory, "qivryn.ico"),
    Buffer.concat([header, png]),
  );
}

fs.mkdirSync(outputDirectory, { recursive: true });
const images = new Map(
  [16, 32, 64, 128, 256, 512, 1024].map((size) => [size, resize(size)]),
);
fs.writeFileSync(path.join(outputDirectory, "qivryn.png"), images.get(512));
writeIcns(images);
writeIco(images.get(256));
fs.rmSync(temporaryDirectory, { recursive: true, force: true });

console.log(`Generated Qivryn application icons in ${outputDirectory}`);
