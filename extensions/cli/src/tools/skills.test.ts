import { QivrynError, QivrynErrorReason } from "core/util/errors.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Skill } from "../util/loadMarkdownSkills.js";

import { skillsTool } from "./skills.js";

vi.mock("../util/loadMarkdownSkills.js");
vi.mock("../util/logger.js");

const mockSkills: Skill[] = [
  {
    name: "test-skill",
    description: "A test skill",
    path: "/path/to/skill",
    content: "Skill content here",
    files: [],
  },
  {
    name: "skill-with-files",
    description: "Skill with extra files",
    path: "/path/to/skill2",
    content: "Another skill",
    files: ["/path/to/file1.ts", "/path/to/file2.ts"],
  },
];

describe("skillsTool", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { loadMarkdownSkills } = await import(
      "../util/loadMarkdownSkills.js"
    );
    vi.mocked(loadMarkdownSkills).mockResolvedValue({
      skills: mockSkills,
      errors: [],
    });
  });

  it("keeps the tool schema bounded instead of embedding every skill name", async () => {
    const tool = await skillsTool();
    expect(tool.description).not.toContain("test-skill");
    expect(tool.description).toContain("Search installed skills");
    expect(tool.readonly).toBe(true);
  });

  describe("preprocess", () => {
    it("should return preview with skill name", async () => {
      const tool = await skillsTool();
      const result = await tool.preprocess!({ skill_name: "test-skill" });
      expect(result.preview).toEqual([
        { type: "text", content: "Reading skill: test-skill" },
      ]);
    });
  });

  describe("run", () => {
    it("searches skill names and descriptions without loading their bodies", async () => {
      const tool = await skillsTool();
      const result = await tool.run({ query: "extra files" });
      expect(result).toContain('name="skill-with-files"');
      expect(result).not.toContain("Another skill");
      expect(result.length).toBeLessThan(2_000);
    });

    it("should return skill content when found", async () => {
      const tool = await skillsTool();
      const result = await tool.run({ skill_name: "test-skill" });
      expect(result).toContain("<skill_name>test-skill</skill_name>");
      expect(result).toContain(
        "<skill_description>A test skill</skill_description>",
      );
      expect(result).toContain(
        '<skill_content start_line="1" end_line="1" total_lines="1">Skill content here</skill_content>',
      );
    });

    it("should include files when skill has files", async () => {
      const tool = await skillsTool();
      const result = await tool.run({ skill_name: "skill-with-files" });
      expect(result).toContain("<skill_files>");
      expect(result).toContain("/path/to/file1.ts");
      expect(result).toContain("<skill_file_instructions>");
    });

    it("pages large skills without returning the whole document", async () => {
      const { loadMarkdownSkills } = await import(
        "../util/loadMarkdownSkills.js"
      );
      vi.mocked(loadMarkdownSkills).mockResolvedValue({
        skills: [
          {
            name: "large-skill",
            description: "Large instructions",
            path: "/path/to/large-skill",
            content: Array.from(
              { length: 500 },
              (_, index) => `Instruction ${index + 1}`,
            ).join("\n"),
            files: [],
          },
        ],
        errors: [],
      });
      const tool = await skillsTool();
      const result = await tool.run({
        skill_name: "large-skill",
        start_line: 101,
        line_count: 25,
      });
      expect(result).toContain('start_line="101" end_line="125"');
      expect(result).toContain("Instruction 101");
      expect(result).not.toContain("Instruction 100\n");
      expect(result).not.toContain("Instruction 126\n");
      expect(result).toContain("<next_start_line>126</next_start_line>");
      expect(result.length).toBeLessThan(4_000);
    });

    it("should throw QivrynError when skill not found", async () => {
      const tool = await skillsTool();
      const error = await tool
        .run({ skill_name: "nonexistent" })
        .catch((e) => e);
      expect(error).toBeInstanceOf(QivrynError);
      expect(error.reason).toBe(QivrynErrorReason.SkillNotFound);
      expect(error.message).toContain("nonexistent");
      expect(error.message).not.toContain("Available skills:");
    });
  });
});
