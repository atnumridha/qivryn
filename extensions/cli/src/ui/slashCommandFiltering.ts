import type { SlashCommand } from "../commands/commands.js";

export const MAX_VISIBLE_SLASH_COMMANDS = 12;

const isGeneratedSkillCommand = (command: SlashCommand): boolean =>
  command.name.startsWith("skill-");

export function filterAndSortSlashCommands(
  commands: SlashCommand[],
  filter: string,
): SlashCommand[] {
  const normalizedFilter = filter.trim().toLowerCase();

  return commands
    .filter((command) => {
      if (!normalizedFilter && isGeneratedSkillCommand(command)) return false;
      return command.name.toLowerCase().includes(normalizedFilter);
    })
    .sort((left, right) => {
      const leftStartsWith = left.name
        .toLowerCase()
        .startsWith(normalizedFilter);
      const rightStartsWith = right.name
        .toLowerCase()
        .startsWith(normalizedFilter);

      if (leftStartsWith && !rightStartsWith) return -1;
      if (!leftStartsWith && rightStartsWith) return 1;
      if (left.category !== right.category) {
        return left.category === "system" ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
}

export interface SlashCommandWindow {
  commands: SlashCommand[];
  startIndex: number;
  total: number;
}

export function getSlashCommandWindow(
  commands: SlashCommand[],
  selectedIndex: number,
  maximumVisible = MAX_VISIBLE_SLASH_COMMANDS,
): SlashCommandWindow {
  if (commands.length === 0 || maximumVisible <= 0) {
    return { commands: [], startIndex: 0, total: commands.length };
  }

  const safeSelectedIndex = Math.min(
    Math.max(selectedIndex, 0),
    commands.length - 1,
  );
  const maximumStart = Math.max(commands.length - maximumVisible, 0);
  const startIndex = Math.min(
    Math.max(safeSelectedIndex - maximumVisible + 1, 0),
    maximumStart,
  );

  return {
    commands: commands.slice(startIndex, startIndex + maximumVisible),
    startIndex,
    total: commands.length,
  };
}
