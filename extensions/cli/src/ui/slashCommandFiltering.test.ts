import { describe, expect, it } from "vitest";

import type { SlashCommand } from "../commands/commands.js";

import {
  filterAndSortSlashCommands,
  getSlashCommandWindow,
} from "./slashCommandFiltering.js";

const command = (
  name: string,
  category: SlashCommand["category"] = "assistant",
): SlashCommand => ({ name, description: `${name} description`, category });

describe("filterAndSortSlashCommands", () => {
  const commands = [
    command("skill-documents"),
    command("update", "system"),
    command("skills", "system"),
    command("review"),
    command("skill-imagegen"),
  ];

  it("keeps generated skill commands out of the unfiltered menu", () => {
    expect(
      filterAndSortSlashCommands(commands, "").map(({ name }) => name),
    ).toEqual(["skills", "update", "review"]);
  });

  it("makes generated skills available through a skill query", () => {
    expect(
      filterAndSortSlashCommands(commands, "skill-").map(({ name }) => name),
    ).toEqual(["skill-documents", "skill-imagegen"]);
  });

  it("ranks system commands before assistant commands", () => {
    expect(
      filterAndSortSlashCommands(commands, "e").map(({ name }) => name),
    ).toEqual(["update", "review", "skill-documents", "skill-imagegen"]);
  });
});

describe("getSlashCommandWindow", () => {
  const commands = Array.from({ length: 20 }, (_, index) =>
    command(`command-${index}`),
  );

  it("shows the first page for the initial selection", () => {
    const result = getSlashCommandWindow(commands, 0, 5);

    expect(result.startIndex).toBe(0);
    expect(result.commands.map(({ name }) => name)).toEqual([
      "command-0",
      "command-1",
      "command-2",
      "command-3",
      "command-4",
    ]);
  });

  it("moves the window to keep the selected command visible", () => {
    const result = getSlashCommandWindow(commands, 8, 5);

    expect(result.startIndex).toBe(4);
    expect(result.commands.at(-1)?.name).toBe("command-8");
  });

  it("clamps the final page and invalid selections", () => {
    expect(getSlashCommandWindow(commands, 100, 5).startIndex).toBe(15);
    expect(getSlashCommandWindow(commands, -1, 5).startIndex).toBe(0);
  });

  it("returns an empty window for non-positive limits", () => {
    expect(getSlashCommandWindow(commands, 0, 0)).toEqual({
      commands: [],
      startIndex: 0,
      total: 20,
    });
  });
});
