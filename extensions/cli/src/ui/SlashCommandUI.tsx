import { type AssistantConfig } from "@qivryn/sdk";
import { Box, Text } from "ink";
import React, { useEffect, useState } from "react";

import {
  getAllSlashCommands,
  REMOTE_MODE_SLASH_COMMANDS,
  type SlashCommand,
} from "../commands/commands.js";

import {
  filterAndSortSlashCommands,
  getSlashCommandWindow,
} from "./slashCommandFiltering.js";

const MAX_DESCRIPTION_LENGTH = 80;
const FALLBACK_SLASH_COMMANDS: SlashCommand[] = [
  { name: "help", description: "Show help message", category: "system" },
  { name: "clear", description: "Clear the chat history", category: "system" },
  { name: "exit", description: "Exit the chat", category: "system" },
];

const truncateDescription = (description: string): string => {
  if (description.length <= MAX_DESCRIPTION_LENGTH) {
    return description;
  }
  return (
    Array.from(description).slice(0, MAX_DESCRIPTION_LENGTH).join("").trim() +
    "…"
  );
};

interface SlashCommandUIProps {
  assistant?: AssistantConfig;
  filter: string;
  selectedIndex: number;
  isRemoteMode?: boolean;
}

const SlashCommandUI: React.FC<SlashCommandUIProps> = ({
  assistant,
  filter,
  selectedIndex,
  isRemoteMode = false,
}) => {
  const [allCommands, setAllCommands] = useState<SlashCommand[]>(() =>
    isRemoteMode ? REMOTE_MODE_SLASH_COMMANDS : FALLBACK_SLASH_COMMANDS,
  );

  useEffect(() => {
    let stale = false;

    const loadCommands = async () => {
      if (!assistant) {
        setAllCommands(
          isRemoteMode ? REMOTE_MODE_SLASH_COMMANDS : FALLBACK_SLASH_COMMANDS,
        );
        return;
      }

      const commands = await getAllSlashCommands(assistant, { isRemoteMode });
      if (!stale) setAllCommands(commands);
    };

    void loadCommands();

    return () => {
      stale = true;
    };
  }, [assistant, isRemoteMode]);

  const filteredCommands = filterAndSortSlashCommands(allCommands, filter);
  const commandWindow = getSlashCommandWindow(filteredCommands, selectedIndex);

  if (filteredCommands.length === 0) {
    return (
      <Box paddingX={1} marginX={1} marginBottom={1}>
        <Text color="gray">No matching commands found</Text>
      </Box>
    );
  }

  return (
    <Box paddingX={1} marginX={1} marginBottom={1} flexDirection="column">
      {commandWindow.commands.map((command, index) => {
        const absoluteIndex = commandWindow.startIndex + index;
        const isSelected = absoluteIndex === selectedIndex;

        const maxCommandLength = Math.max(
          ...commandWindow.commands.map((cmd) => cmd.name.length),
        );
        const paddedCommandName = `/${command.name}`.padEnd(
          maxCommandLength + 1,
        );

        return (
          <Box key={command.name}>
            <Text color={isSelected ? "blue" : "white"} bold={isSelected}>
              {"  "}
              {paddedCommandName}
              <Text color={isSelected ? "blue" : "gray"}>
                {"    "}
                {truncateDescription(command.description)}
              </Text>
            </Text>
          </Box>
        );
      })}

      <Box marginTop={1}>
        <Text color="gray" dimColor>
          {commandWindow.total > commandWindow.commands.length
            ? `${commandWindow.startIndex + 1}-${commandWindow.startIndex + commandWindow.commands.length} of ${commandWindow.total} · `
            : ""}
          ↑/↓ to navigate, Enter to select, Tab to complete
          {!filter && !isRemoteMode ? " · Type /skill to search skills" : ""}
        </Text>
      </Box>
    </Box>
  );
};

export { SlashCommandUI };
