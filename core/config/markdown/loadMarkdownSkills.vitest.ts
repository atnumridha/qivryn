import path from "path";
import { describe, expect, it } from "vitest";

import { getGlobalCrossAgentSkillPaths } from "./loadMarkdownSkills";

describe("getGlobalCrossAgentSkillPaths", () => {
  it("includes active global skill roots for supported agent clients", () => {
    const home = path.parse(process.cwd()).root + "home/test-user";

    expect(getGlobalCrossAgentSkillPaths(home)).toEqual([
      path.join(home, ".cursor", "skills"),
      path.join(home, ".cursor", "skills-cursor"),
      path.join(home, ".cursor", "plugins"),
      path.join(home, ".claude", "skills"),
      path.join(home, ".codex", "skills"),
      path.join(home, ".codex", "plugins", "cache"),
      path.join(home, ".copilot", "skills"),
      path.join(home, ".agents", "skills"),
      path.join(home, ".config", "github-copilot", "skills"),
    ]);
  });
});
