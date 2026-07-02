import {
  ConfigValidationError,
  parseMarkdownRule,
} from "@continuedev/config-yaml";
import os from "os";
import path from "path";
import { mkdir } from "node:fs/promises";
import z from "zod";
import { IDE, Skill } from "../..";
import { walkDir } from "../../indexing/walkDir";
import { localPathToUri } from "../../util/pathToUri";
import { findUriInDirs, joinPathsToUri } from "../../util/uri";
import { getAllDotContinueDefinitionFiles } from "../loadLocalAssistants";
import { getEnabledLocalPluginSkillPaths } from "../plugins/localPluginManager";

const skillFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
});

const SKILLS_DIR = "skills";
const SKILL_CACHE_TTL_MS = 60_000;
type LoadSkillsResult = {
  skills: Skill[];
  errors: ConfigValidationError[];
};
const skillCatalogCache = new Map<
  string,
  { expiresAt: number; result: LoadSkillsResult }
>();
const skillCatalogLoads = new Map<string, Promise<LoadSkillsResult>>();

export interface SaveMarkdownSkillRequest {
  name: string;
  description: string;
  content: string;
  scope: "workspace" | "global";
  sourceFile?: string;
}

function skillProvenance(fileUri: string): string {
  if (
    fileUri.includes("/plugins/cache/") ||
    fileUri.includes("/.continue/plugins/installed/")
  )
    return "Plugin";
  if (fileUri.includes("/.cursor/")) return "Cursor";
  if (fileUri.includes("/.claude/")) return "Claude";
  if (fileUri.includes("/.codex/")) return "Codex";
  if (
    fileUri.includes("/.copilot/") ||
    fileUri.includes("/.config/github-copilot/")
  )
    return "Copilot";
  if (fileUri.includes("/.github/")) return "GitHub";
  if (fileUri.includes("/.agents/")) return "Agents";
  if (fileUri.includes("/.continue/")) return "Continue";
  return "Workspace";
}

function skillSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new Error("Skill name must contain a letter or number");
  return slug;
}

function serializeSkill(request: SaveMarkdownSkillRequest): string {
  const name = JSON.stringify(request.name.trim());
  const description = JSON.stringify(request.description.trim());
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${request.content.trim()}\n`;
}

const WORKSPACE_CROSS_AGENT_SKILL_DIRS = [
  [".cursor", SKILLS_DIR],
  [".claude", SKILLS_DIR],
  [".codex", SKILLS_DIR],
  [".github", SKILLS_DIR],
  [".copilot", SKILLS_DIR],
  [".agents", SKILLS_DIR],
] as const;

/**
 * Active global skill roots shared by common agent clients. Backups, temporary
 * downloads, and vendor-import catalogs are intentionally excluded.
 */
export function getGlobalCrossAgentSkillPaths(homeDir = os.homedir()) {
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

/**
 * Get skills from cross-agent workspace and active global directories.
 */
async function getCrossAgentSkillFiles(ide: IDE) {
  const workspaceDirs = await ide.getWorkspaceDirs();
  const fullDirs = workspaceDirs.flatMap((dir) =>
    WORKSPACE_CROSS_AGENT_SKILL_DIRS.map((segments) =>
      joinPathsToUri(dir, ...segments),
    ),
  );

  fullDirs.push(
    ...getGlobalCrossAgentSkillPaths().map((dir) => localPathToUri(dir)),
    ...(await getEnabledLocalPluginSkillPaths()).map((dir) =>
      localPathToUri(dir),
    ),
  );

  return (
    await Promise.all(
      fullDirs.map(async (dir) => {
        const exists = await ide.fileExists(dir);
        if (!exists) return [];
        const uris = await walkDir(dir, ide, {
          source: "get cross-agent skill files",
        });
        return uris.filter((uri) => uri.endsWith("SKILL.md"));
      }),
    )
  ).flat();
}

async function loadMarkdownSkillsUncached(ide: IDE): Promise<LoadSkillsResult> {
  const errors: ConfigValidationError[] = [];
  const skills: Skill[] = [];

  try {
    const yamlAndMarkdownFileUris = [
      ...(
        await getAllDotContinueDefinitionFiles(
          ide,
          {
            includeGlobal: true,
            includeWorkspace: true,
            fileExtType: "markdown",
          },
          SKILLS_DIR,
        )
      ).map((file) => file.path),
      ...(await getCrossAgentSkillFiles(ide)),
    ];

    const skillFiles = [
      ...new Set(
        yamlAndMarkdownFileUris.filter((path) => path.endsWith("SKILL.md")),
      ),
    ];

    const workspaceDirs = await ide.getWorkspaceDirs();
    const candidates = await Promise.all(
      skillFiles.map(async (fileUri) => {
        try {
          const content = await ide.readFile(fileUri);
          const { frontmatter, markdown } = parseMarkdownRule(
            content,
          ) as unknown as { frontmatter: Skill; markdown: string };

          const validatedFrontmatter =
            skillFrontmatterSchema.parse(frontmatter);

          const filesInSkillsDirectory = (
            await walkDir(fileUri.substring(0, fileUri.lastIndexOf("/")), ide, {
              source: "get skill files",
            })
          )
            // do not include SKILL.md as it is already in content
            .filter((file) => !file.endsWith("SKILL.md"));

          const foundRelativeUri = findUriInDirs(fileUri, workspaceDirs);

          return {
            ...validatedFrontmatter,
            content: markdown,
            sourceFile: fileUri,
            provenance: skillProvenance(fileUri),
            readOnly:
              fileUri.includes("/plugins/cache/") ||
              fileUri.includes("/.continue/plugins/installed/"),
            scope: foundRelativeUri.foundInDir ? "workspace" : "global",
            path: foundRelativeUri.foundInDir
              ? foundRelativeUri.relativePathOrBasename
              : fileUri,
            files: filesInSkillsDirectory,
          } satisfies Skill;
        } catch (error) {
          errors.push({
            fatal: false,
            message: `Failed to parse markdown skill file: ${error instanceof Error ? error.message : error}`,
          });
          return undefined;
        }
      }),
    );

    const seenSkillNames = new Set<string>();
    for (const candidate of candidates) {
      if (!candidate || seenSkillNames.has(candidate.name)) continue;
      // Promise.all preserves source order, so Continue/workspace definitions
      // still win over cross-agent workspace and global roots.
      seenSkillNames.add(candidate.name);
      skills.push(candidate);
    }
  } catch (err) {
    errors.push({
      fatal: false,
      message: `Error loading markdown skill files: ${err instanceof Error ? err.message : err}`,
    });
  }

  return { skills, errors };
}

export function invalidateMarkdownSkillsCache(): void {
  skillCatalogCache.clear();
  skillCatalogLoads.clear();
}

export async function loadMarkdownSkills(ide: IDE): Promise<LoadSkillsResult> {
  const workspaceKey = (await ide.getWorkspaceDirs()).join("|");
  const cached = skillCatalogCache.get(workspaceKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;
  const activeLoad = skillCatalogLoads.get(workspaceKey);
  if (activeLoad) return activeLoad;

  const load = loadMarkdownSkillsUncached(ide).then((result) => {
    skillCatalogCache.set(workspaceKey, {
      expiresAt: Date.now() + SKILL_CACHE_TTL_MS,
      result,
    });
    skillCatalogLoads.delete(workspaceKey);
    return result;
  });
  skillCatalogLoads.set(workspaceKey, load);
  return load;
}

/**
 * Create or update a local Markdown skill. Existing paths are accepted only
 * when they are part of the discovered catalog, preventing arbitrary writes.
 */
export async function saveMarkdownSkill(
  ide: IDE,
  request: SaveMarkdownSkillRequest,
): Promise<Skill> {
  if (!request.name.trim() || !request.description.trim()) {
    throw new Error("Skill name and description are required");
  }

  let targetUri: string;
  if (request.sourceFile) {
    const { skills } = await loadMarkdownSkills(ide);
    const existing = skills.find(
      (skill) => skill.sourceFile === request.sourceFile,
    );
    if (!existing) throw new Error("The selected skill is no longer available");
    if (existing.readOnly) throw new Error("Plugin cache skills are read-only");
    targetUri = existing.sourceFile!;
  } else {
    const workspaceDirs = await ide.getWorkspaceDirs();
    const baseUri =
      request.scope === "workspace"
        ? workspaceDirs[0]
        : localPathToUri(path.join(os.homedir(), ".continue"));
    if (!baseUri) throw new Error("Open a workspace before creating a skill");
    targetUri = joinPathsToUri(
      baseUri,
      ...(request.scope === "workspace" ? [".continue"] : []),
      SKILLS_DIR,
      skillSlug(request.name),
      "SKILL.md",
    );
  }

  // VS Code's writeFile API does not create parent directories. Local-first
  // skill roots can be prepared here; remote IDE implementations still use
  // their normal write bridge once the parent exists.
  if (targetUri.startsWith("file:")) {
    const { localPathOrUriToPath } = await import("../../util/pathToUri");
    await mkdir(path.dirname(localPathOrUriToPath(targetUri)), {
      recursive: true,
    });
  }
  await ide.writeFile(targetUri, serializeSkill(request));

  invalidateMarkdownSkillsCache();
  const { skills } = await loadMarkdownSkills(ide);
  const saved = skills.find((skill) => skill.sourceFile === targetUri);
  if (!saved) throw new Error("Skill was saved but could not be reloaded");
  return saved;
}
