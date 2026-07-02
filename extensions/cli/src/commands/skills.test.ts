import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { skillsCommand } from "./skills.js";

describe("skillsCommand", () => {
  const originalCwd = process.cwd();
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    process.chdir(originalCwd);
    for (const directory of temporaryDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it("creates a workspace skill that is discoverable by the CLI", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "continue-skill-command-"),
    );
    temporaryDirectories.push(directory);
    process.chdir(directory);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await skillsCommand("create", undefined, {
      name: "release-review",
      description: "Review release readiness",
      instructions: "Check tests and rollback steps.",
      workspace: true,
    });

    const skillFile = path.join(
      directory,
      ".continue",
      "skills",
      "release-review",
      "SKILL.md",
    );
    expect(fs.readFileSync(skillFile, "utf8")).toContain(
      "Check tests and rollback steps.",
    );
  });
});
