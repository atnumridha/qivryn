import { QivrynError, QivrynErrorReason } from "core/util/errors.js";

import { loadMarkdownSkills } from "../util/loadMarkdownSkills.js";
import { logger } from "../util/logger.js";

import { Tool } from "./types.js";

const DEFAULT_SKILL_LINE_COUNT = 220;
const MAX_SKILL_LINE_COUNT = 300;
const MAX_SKILL_CHARS = 24_000;
const MAX_SKILL_MATCHES = 20;

function matchingSkills(
  skills: Awaited<ReturnType<typeof loadMarkdownSkills>>["skills"],
  query: string,
) {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter(Boolean);
  return skills
    .map((skill) => {
      const name = skill.name.toLowerCase();
      const haystack = `${name} ${skill.description.toLowerCase()}`;
      const score = terms.reduce(
        (total, term) =>
          total +
          (name === term ? 8 : name.startsWith(term) ? 4 : 0) +
          (haystack.includes(term) ? 1 : 0),
        0,
      );
      return { skill, score };
    })
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.skill.name.localeCompare(right.skill.name),
    )
    .slice(0, MAX_SKILL_MATCHES)
    .map((entry) => entry.skill);
}

export const SKILLS_TOOL_META: Tool = {
  name: "Skills",
  displayName: "Skills",
  description:
    "Search installed skills by keyword or read one skill by exact name. Search first when the name is unknown. Skill content is returned in bounded ranges.",
  readonly: true,
  isBuiltIn: true,
  parameters: {
    type: "object",
    required: [],
    properties: {
      skill_name: {
        type: "string",
        description:
          "The name of the skill to read. This should match the name from the available skills.",
      },
      query: {
        type: "string",
        description:
          "Keywords used to find relevant skill names and descriptions. Use this instead of guessing a skill name.",
      },
      start_line: {
        type: "number",
        description: "Optional 1-based line where reading should begin.",
      },
      line_count: {
        type: "number",
        description: `Optional number of lines to read (maximum ${MAX_SKILL_LINE_COUNT}).`,
      },
    },
  },
  run: async () => "",
};

export const skillsTool = async (): Promise<Tool> => {
  const { skills } = await loadMarkdownSkills();

  return {
    ...SKILLS_TOOL_META,

    preprocess: async (args: any) => {
      const { query, skill_name, start_line } = args;

      return {
        args,
        preview: [
          {
            type: "text",
            content: skill_name
              ? `Reading skill: ${skill_name}${
                  Number.isFinite(Number(start_line))
                    ? ` from line ${Math.max(1, Math.trunc(Number(start_line)))}`
                    : ""
                }`
              : `Searching skills: ${String(query ?? "").trim() || "(no query)"}`,
          },
        ],
      };
    },

    run: async (args: any, context?: { toolCallId: string }) => {
      const skillName = String(args.skill_name ?? "").trim();
      const query = String(args.query ?? "").trim();

      logger.debug("skill args", { args, context });

      if (!skillName) {
        if (!query) {
          throw new QivrynError(
            QivrynErrorReason.SkillNotFound,
            "Provide query to search installed skills or skill_name to read one skill.",
          );
        }
        const matches = matchingSkills(skills, query);
        return [
          `<skill_matches query=${JSON.stringify(query)} count="${matches.length}">`,
          ...matches.map(
            (skill) =>
              `<skill name=${JSON.stringify(skill.name)}>${skill.description}</skill>`,
          ),
          "</skill_matches>",
          matches.length === 0
            ? "No matching skills were found. Refine the query instead of loading unrelated skills."
            : "Read one result with skill_name only if its instructions are relevant to the task.",
        ].join("\n");
      }

      const skill = skills.find((candidate) => candidate.name === skillName);
      if (!skill) {
        const suggestions = matchingSkills(skills, skillName)
          .slice(0, 5)
          .map((candidate) => candidate.name)
          .join(", ");
        throw new QivrynError(
          QivrynErrorReason.SkillNotFound,
          `Skill "${skillName}" not found.${suggestions ? ` Similar skills: ${suggestions}.` : ""} Search with query to find the exact name.`,
        );
      }

      const lines = skill.content.split(/\r?\n/);
      const requestedStart = Math.max(
        1,
        Math.trunc(Number(args.start_line) || 1),
      );
      const requestedCount = Math.min(
        MAX_SKILL_LINE_COUNT,
        Math.max(
          1,
          Math.trunc(Number(args.line_count) || DEFAULT_SKILL_LINE_COUNT),
        ),
      );
      const startIndex = Math.min(requestedStart - 1, lines.length);
      const selected: string[] = [];
      let selectedChars = 0;
      for (
        let index = startIndex;
        index < lines.length && selected.length < requestedCount;
        index++
      ) {
        const line = lines[index];
        const nextLength =
          selectedChars + line.length + (selected.length ? 1 : 0);
        if (selected.length > 0 && nextLength > MAX_SKILL_CHARS) break;
        selected.push(
          line.length > MAX_SKILL_CHARS
            ? `${line.slice(0, MAX_SKILL_CHARS)}\n[Line truncated]`
            : line,
        );
        selectedChars = nextLength;
      }
      const endLine = startIndex + selected.length;
      const hasMore = endLine < lines.length;
      const content = [
        `<skill_name>${skill.name}</skill_name>`,
        `<skill_description>${skill.description}</skill_description>`,
        `<skill_path>${skill.path}</skill_path>`,
        `<skill_content start_line="${startIndex + 1}" end_line="${endLine}" total_lines="${lines.length}">${selected.join("\n")}</skill_content>`,
      ];

      if (hasMore) {
        content.push(
          "<skill_truncated>true</skill_truncated>",
          `<next_start_line>${endLine + 1}</next_start_line>`,
          `<other_instructions>Only if the remaining instructions are needed, call Skills again with skill_name=${JSON.stringify(
            skill.name,
          )} and start_line=${endLine + 1}. Do not reload lines already returned.</other_instructions>`,
        );
      }

      if (skill.files.length > 0) {
        content.push(
          `<skill_files>${skill.files.join(",")}</skill_files>`,
          `<skill_file_instructions>Use the read file tool to access a listed skill file only when it is relevant.</skill_file_instructions>`,
        );
      }

      return content.join("\n");
    },
  };
};

export function buildImportSkillPrompt(identifier: string): string {
  return `
# Overview

The user wants to import skills.

User-provided skill identifier:
${identifier}

# Guidelines
- There can be multiple skills in a single repository.
- Use the available tools to fetch content and write files. When you are done, briefly summarize which skill you imported and where you saved it.
- Use the "AskQuestion" tool where required to clarify with the user.

# Process:

**Identifier can either be a URL or a skill name**

- If it looks like a URL (for example, it starts with http:// or https://), open that URL and inspect its contents to find the code or files that define the skill. 
- If the URL is a GitHub repository, look for the skills folder. There can be multiple skills within subdirectories.
- If it looks like a skill name, you should search for the most relevant open-source skill or repository that matches the skill identifier.
- Ask questions to the user to clarify which skill they are referring to if there are multiple options in your findings.

**Create the skill files**

- The skills should be created under the directory: ~/.qivryn/skills/<skill-name>
- The subdirectory name should match the name of the skill directory in the fetched repository.
- The relevant files and folders along with SKILL.md should be present inside the created skill subdirectory.
- If the skill already exists, ask question to the user to clarify whether they want to update it.
- Important: Before writing any files, ask the user if they want to proceed with the import.
`;
}
