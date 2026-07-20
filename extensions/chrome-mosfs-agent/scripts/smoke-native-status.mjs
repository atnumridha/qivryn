#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const nativeHost = path.join(projectRoot, "src", "native-host", "index.mjs");

const child = spawn(process.execPath, [nativeHost], {
  cwd: projectRoot,
  stdio: ["pipe", "pipe", "pipe"],
});

let stdout = Buffer.alloc(0);
let stderr = "";

const timeout = setTimeout(() => {
  child.kill();
  console.error("Timed out waiting for native host status response.");
  if (stderr) console.error(stderr);
  process.exit(1);
}, 10000);

child.stderr.on("data", (chunk) => {
  stderr += chunk.toString("utf8");
});

child.stdout.on("data", (chunk) => {
  stdout = Buffer.concat([stdout, chunk]);
  if (stdout.length < 4) return;
  const length = stdout.readUInt32LE(0);
  if (stdout.length < 4 + length) return;
  clearTimeout(timeout);
  const response = JSON.parse(stdout.subarray(4, 4 + length).toString("utf8"));
  child.kill();
  console.log(JSON.stringify({
    ok: response.ok,
    workspaceRoot: response.workspaceRoot,
    defaultModel: response.defaultModel,
    defaultReasoningEffort: response.defaultReasoningEffort,
    qivrynAgentState: response.qivrynAgentState || "",
    qivrynAgentDescriptor: response.qivrynAgent?.descriptor ? {
      baseUrl: response.qivrynAgent.descriptor.baseUrl || "",
      protocolVersion: response.qivrynAgent.descriptor.protocolVersion || "",
    } : null,
    mcpServerCount: response.mcpServerCount,
    enabledPluginCount: response.enabledPluginCount,
    helperCount: response.helpers ? Object.keys(response.helpers).length : 0,
    error: response.error || "",
  }, null, 2));
  process.exit(response.ok ? 0 : 1);
});

child.on("error", (error) => {
  clearTimeout(timeout);
  console.error(error.message || String(error));
  process.exit(1);
});

const payload = Buffer.from(JSON.stringify({ id: "smoke", type: "status" }), "utf8");
const header = Buffer.alloc(4);
header.writeUInt32LE(payload.length, 0);
child.stdin.write(Buffer.concat([header, payload]));
