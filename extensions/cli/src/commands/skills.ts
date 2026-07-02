import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../env.js";
import { loadMarkdownSkills } from "../util/loadMarkdownSkills.js";

interface SkillsCommandOptions {
  json?: boolean;
  name?: string;
  description?: string;
  instructions?: string;
  file?: string;
  workspace?: boolean;
}

function slug(name: string): string {
  const value = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!value) throw new Error("Skill name must contain a letter or number");
  return value;
}

export async function skillsCommand(
  action: string | undefined,
  identifier: string | undefined,
  options: SkillsCommandOptions,
): Promise<void> {
  const { skills, errors } = await loadMarkdownSkills();
  if (!action || action === "list") {
    if (options.json) {
      console.log(JSON.stringify({ skills, errors }, null, 2));
    } else {
      for (const skill of skills)
        console.log(`${skill.name}\t${skill.description}\t${skill.path}`);
    }
    return;
  }
  if (action === "show") {
    const skill = skills.find((candidate) => candidate.name === identifier);
    if (!skill) throw new Error(`Skill ${identifier ?? ""} was not found`);
    console.log(options.json ? JSON.stringify(skill, null, 2) : skill.content);
    return;
  }
  if (action !== "create" && action !== "edit") {
    throw new Error("Skill action must be list, show, create, or edit");
  }

  const existing =
    action === "edit"
      ? skills.find((candidate) => candidate.name === identifier)
      : undefined;
  if (action === "edit" && !existing)
    throw new Error(`Skill ${identifier ?? ""} was not found`);
  const name = options.name ?? existing?.name ?? identifier;
  const description = options.description ?? existing?.description;
  const instructions = options.file
    ? await readFile(path.resolve(options.file), "utf8")
    : (options.instructions ?? existing?.content);
  if (!name || !description || !instructions) {
    throw new Error(
      "--name, --description, and --instructions (or --file) are required",
    );
  }
  const target = existing
    ? path.resolve(existing.path)
    : path.join(
        options.workspace
          ? path.join(process.cwd(), ".continue")
          : env.continueHome,
        "skills",
        slug(name),
        "SKILL.md",
      );
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(
    target,
    `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n---\n\n${instructions.trim()}\n`,
    "utf8",
  );
  console.log(options.json ? JSON.stringify({ path: target }) : target);
}
