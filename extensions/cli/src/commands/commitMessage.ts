import { generateCommitMessage } from "@continuedev/agent-runtime";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function commitMessageCommand(options: {
  unstaged?: boolean;
  json?: boolean;
}): Promise<void> {
  const args = options.unstaged
    ? ["diff", "--binary", "HEAD", "--"]
    : ["diff", "--binary", "--cached", "--"];
  const { stdout } = await execFileAsync("git", args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  const message = await generateCommitMessage(stdout);
  console.log(options.json ? JSON.stringify({ message }, null, 2) : message);
}
