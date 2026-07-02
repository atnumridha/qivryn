import * as fs from "fs";
import fsPromises from "fs/promises";
import * as path from "path";

import { parseMarkdownRule } from "@continuedev/config-yaml";
import { WalkerSync } from "ignore-walk";
import { z } from "zod";

import { env } from "../env.js";

export interface Skill {
  name: string;
  description: string;
  path: string;
  content: string;
  files: string[];
}

export interface LoadSkillsResult {
  skills: Skill[];
  errors: { fatal: boolean; message: string }[];
}

const skillFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
});

const SKILLS_DIR = "skills";

/**get the relative path if the filePath is within the current working directory
 * otherwise return the absolute path
 */
function getRelativePath(cwd: string, filePath: string) {
  return filePath.startsWith(cwd)
    ? path.join(".", path.relative(cwd, filePath))
    : filePath;
}

function getFilePathsInSkillDirectory(
  cwd: string,
  skillFilePath: string,
): string[] {
  const skillDir = path.dirname(skillFilePath);
  if (!fs.existsSync(skillDir)) return [];

  const walker = new WalkerSync({
    path: skillDir,
    includeEmpty: false,
    follow: false,
  });

  const files = walker.start().result as string[];
  return files
    .map((filePath) => path.join(skillDir, filePath))
    .filter((filePath) => !filePath.endsWith("SKILL.md"))
    .map((filePath) => getRelativePath(cwd, filePath));
}

/** Get SKILL.md files recursively from a skill root. */
async function getSkillFilesFromDir(dirPath: string): Promise<string[]> {
  try {
    await fsPromises.stat(dirPath);
  } catch {
    return [];
  }

  const walker = new WalkerSync({
    path: dirPath,
    includeEmpty: false,
    follow: false,
  });
  const files = walker.start().result as string[];
  return files
    .filter((filePath) => path.basename(filePath) === "SKILL.md")
    .map((filePath) => path.join(dirPath, filePath));
}

export function getGlobalCrossAgentSkillPaths(
  continueHome = env.continueHome,
): string[] {
  const homeDir = path.dirname(continueHome);
  return [
    path.join(homeDir, ".cursor", SKILLS_DIR),
    path.join(homeDir, ".cursor", "plugins"),
    path.join(homeDir, ".claude", SKILLS_DIR),
    path.join(homeDir, ".codex", SKILLS_DIR),
    path.join(homeDir, ".codex", "plugins", "cache"),
    path.join(homeDir, ".copilot", SKILLS_DIR),
    path.join(homeDir, ".agents", SKILLS_DIR),
    path.join(homeDir, ".config", "github-copilot", SKILLS_DIR),
  ];
}

export async function loadMarkdownSkills(): Promise<LoadSkillsResult> {
  const errors: { fatal: boolean; message: string }[] = [];
  const skills: Skill[] = [];

  const cwd = process.cwd();

  try {
    const skillsDirs = [
      path.join(cwd, ".continue", SKILLS_DIR),
      path.join(cwd, ".claude", SKILLS_DIR),
      path.join(cwd, ".codex", SKILLS_DIR),
      path.join(cwd, ".github", SKILLS_DIR),
      path.join(cwd, ".copilot", SKILLS_DIR),
      path.join(cwd, ".agents", SKILLS_DIR),
      path.join(env.continueHome, SKILLS_DIR),
      ...getGlobalCrossAgentSkillPaths(),
    ];

    const skillFilePaths = [
      ...new Set(
        (
          await Promise.all(
            skillsDirs.map((skillDir) => getSkillFilesFromDir(skillDir)),
          )
        ).flat(),
      ),
    ];

    const seenSkillNames = new Set<string>();
    for (const skillFilePath of skillFilePaths) {
      try {
        const content = await fsPromises.readFile(skillFilePath, "utf-8");
        const { frontmatter, markdown } = parseMarkdownRule(content) as {
          frontmatter: { name?: string; description?: string };
          markdown: string;
        };

        const validatedFrontmatter = skillFrontmatterSchema.parse(frontmatter);
        if (seenSkillNames.has(validatedFrontmatter.name)) {
          continue;
        }
        seenSkillNames.add(validatedFrontmatter.name);

        const filesInSkillsDirectory = getFilePathsInSkillDirectory(
          cwd,
          skillFilePath,
        );

        skills.push({
          ...validatedFrontmatter,
          content: markdown,
          path: getRelativePath(cwd, skillFilePath),
          files: filesInSkillsDirectory,
        });
      } catch (error) {
        errors.push({
          fatal: false,
          message: `Failed to parse markdown skill file: ${error instanceof Error ? error.message : error}`,
        });
      }
    }
  } catch (err) {
    errors.push({
      fatal: false,
      message: `Error loading markdown skill files: ${err instanceof Error ? err.message : err}`,
    });
  }

  return { skills, errors };
}

export function getSkillSlashCommandName(skill: Skill): string {
  // Normalize skill name to lowercase and sanitize for use as command name
  const base = skill.name.trim().toLowerCase();
  const safe = base
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");

  if (safe) {
    return `skill-${safe}`;
  }

  // Fallback to directory name if skill name is invalid
  const dirName = path
    .basename(path.dirname(skill.path))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");

  const fallback = dirName || "skill";
  return `skill-${fallback}`;
}
