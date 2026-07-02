import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ReviewFinding } from "@qivryn/agent-runtime";
import type { ReviewFixer } from "./engine.js";

const execFileAsync = promisify(execFile);

export class GitPatchReviewFixer implements ReviewFixer {
  async apply(repositoryPath: string, finding: ReviewFinding): Promise<void> {
    if (!finding.proposedPatch?.trim()) {
      throw new Error("This finding does not include a proposed patch");
    }
    const patchFile = path.join(
      os.tmpdir(),
      `qivryn-review-${randomUUID()}.patch`,
    );
    await writeFile(patchFile, finding.proposedPatch, { mode: 0o600 });
    try {
      await execFileAsync("git", [
        "-C",
        repositoryPath,
        "apply",
        "--check",
        patchFile,
      ]);
      await execFileAsync("git", ["-C", repositoryPath, "apply", patchFile]);
    } finally {
      await rm(patchFile, { force: true });
    }
  }

  async validate(repositoryPath: string): Promise<void> {
    await execFileAsync("git", ["-C", repositoryPath, "diff", "--check"]);
  }
}
