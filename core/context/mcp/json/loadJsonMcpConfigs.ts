import {
  claudeCodeLikeConfigFileSchema,
  claudeDesktopLikeConfigFileSchema,
  ConfigValidationError,
  convertJsonMcpConfigToYamlMcpConfig,
  McpJsonConfig,
  mcpServersJsonSchema,
  RequestOptions,
} from "@qivryn/config-yaml";
import * as JSONC from "comment-json";
import ignore from "ignore";
import os from "node:os";
import path from "node:path";
import { IDE, InternalMcpOptions } from "../../..";
import { getEnabledLocalPluginContributionPaths } from "../../../config/plugins/localPluginManager";
import { convertYamlMcpConfigToInternalMcpOptions } from "../../../config/yaml/yamlToQivrynConfig";
import {
  DEFAULT_IGNORE_DIRS,
  DEFAULT_IGNORE_FILETYPES,
} from "../../../indexing/ignore";
import { walkDir } from "../../../indexing/walkDir";
import { deduplicateArray } from "../../../util";
import { getGlobalFolderWithName } from "../../../util/paths";
import { localPathToUri } from "../../../util/pathToUri";
import { getUriPathBasename, joinPathsToUri } from "../../../util/uri";

/**
 * Loads MCP configs from JSON files in ~/.qivryn/mcpServers and workspace .qivryn/mcpServers
 */
export async function loadJsonMcpConfigs(
  ide: IDE,
  includeGlobal: boolean,
  globalRequestOptions: RequestOptions | undefined = undefined,
): Promise<{
  mcpServers: InternalMcpOptions[];
  errors: ConfigValidationError[];
}> {
  const errors: ConfigValidationError[] = [];

  // Get dirs
  const workspaceDirs = await ide.getWorkspaceDirs();
  const mcpDirs = workspaceDirs.map((dir) =>
    joinPathsToUri(dir, ".qivryn", "mcpServers"),
  );
  if (includeGlobal) {
    mcpDirs.push(localPathToUri(getGlobalFolderWithName("mcpServers")));
    // Cursor and Copilot keep their user-level MCP files outside the project.
    // Read only these explicit config files rather than recursively scanning
    // their whole application state directories.
    mcpDirs.push(
      localPathToUri(path.join(os.homedir(), ".cursor", "mcp.json")),
      localPathToUri(
        path.join(
          os.homedir(),
          ".config",
          "github-copilot",
          "intellij",
          "mcp.json",
        ),
      ),
    );
    const { mcp: pluginMcpDirs } =
      await getEnabledLocalPluginContributionPaths();
    mcpDirs.push(...pluginMcpDirs.map((dir) => localPathToUri(dir)));
  }

  // Get json files and their contents
  const overrideDefaultIgnores = ignore()
    .add(
      DEFAULT_IGNORE_FILETYPES.filter(
        (val) => !["config.json", "settings.json"].includes(val),
      ),
    )
    .add(DEFAULT_IGNORE_DIRS);

  const jsonFiles: { uri: string; content: string }[] = [];

  await Promise.all(
    mcpDirs.map(async (dir) => {
      const exists = await ide.fileExists(dir);
      if (!exists) {
        return;
      }
      try {
        if (dir.endsWith(".json")) {
          jsonFiles.push({ uri: dir, content: await ide.readFile(dir) });
          return;
        }
        const uris = await walkDir(dir, ide, {
          overrideDefaultIgnores,
          source: "get mcp json files",
        });
        const jsonUris = uris.filter((uri) => uri.endsWith(".json"));
        await Promise.all(
          jsonUris.map(async (uri) => {
            try {
              const content = await ide.readFile(uri);
              jsonFiles.push({ uri, content });
            } catch (e) {
              errors.push({
                fatal: false,
                message: `Failed to read MCP server JSON file at ${uri}: ${e instanceof Error ? e.message : String(e)}`,
              });
            }
          }),
        );
      } catch (e) {
        errors.push({
          fatal: false,
          message: `Failed to check for MCP JSON files in ${dir}: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }),
  );

  const validJsonConfigs: {
    name: string;
    mcpJson: McpJsonConfig;
    uri: string;
  }[] = [];
  for (const { content, uri } of jsonFiles) {
    try {
      const json = JSONC.parse(content);
      // GitHub Copilot's local config uses `servers` instead of
      // `mcpServers`. Accept the compatible subset (stdio/SSE/HTTP server
      // definitions) and continue to validate each server before loading it.
      if (
        json &&
        typeof json === "object" &&
        "servers" in json &&
        json.servers &&
        typeof json.servers === "object"
      ) {
        for (const [name, server] of Object.entries(json.servers)) {
          const parsed = mcpServersJsonSchema.safeParse(server);
          if (parsed.success) {
            validJsonConfigs.push({ name, mcpJson: parsed.data, uri });
          } else {
            errors.push({
              fatal: false,
              message: `Copilot MCP server ${name} at ${uri} doesn't match a supported MCP configuration format`,
            });
          }
        }
        continue;
      }
      // Try parsing as a file with mcpServers and multiple servers (claude code/desktop-esque format)
      const claudeCodeFileParsed =
        claudeCodeLikeConfigFileSchema.safeParse(json);
      if (claudeCodeFileParsed.success) {
        if (claudeCodeFileParsed.data.mcpServers) {
          validJsonConfigs.push(
            ...Object.entries(claudeCodeFileParsed.data.mcpServers).map(
              ([name, mcpJson]) => ({
                name,
                mcpJson,
                uri,
              }),
            ),
          );
        }
        const projectServers = Object.values(
          claudeCodeFileParsed.data.projects,
        ).map((v) => v.mcpServers);
        for (const mcpServers of projectServers) {
          if (mcpServers) {
            validJsonConfigs.push(
              ...Object.entries(mcpServers).map(([name, mcpJson]) => ({
                name,
                mcpJson,
                uri,
              })),
            );
          }
        }
      } else {
        const claudeDesktopFileParsed =
          claudeDesktopLikeConfigFileSchema.safeParse(json);
        if (claudeDesktopFileParsed.success) {
          validJsonConfigs.push(
            ...Object.entries(claudeDesktopFileParsed.data.mcpServers).map(
              ([name, mcpJson]) => ({
                name,
                mcpJson,
                uri,
              }),
            ),
          );
        } else {
          // Try parsing as single JSON file
          const singleConfigParsed = mcpServersJsonSchema.safeParse(json);
          if (singleConfigParsed.success) {
            validJsonConfigs.push({
              mcpJson: singleConfigParsed.data,
              name: getUriPathBasename(uri).replace(".json", ""),
              uri,
            });
          } else {
            errors.push({
              fatal: false,
              message: `MCP JSON file at ${uri} doesn't match a supported MCP JSON configuration format`,
            });
          }
        }
      }
    } catch (e) {
      errors.push({
        fatal: false,
        message: `Error parsing MCP JSON file at ${uri}: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  // De-duplicate
  const deduplicatedJsonConfigs = deduplicateArray(
    validJsonConfigs,
    (a, b) => a.name === b.name,
  );

  // Two levels of conversion for now.
  const yamlConfigs = deduplicatedJsonConfigs.map((c) => {
    const { warnings, yamlConfig } = convertJsonMcpConfigToYamlMcpConfig(
      c.name,
      c.mcpJson,
    );
    return {
      warnings,
      yamlConfig: {
        ...yamlConfig,
        sourceFile: c.uri,
      },
    };
  });

  const mcpServers = yamlConfigs.map((c) => {
    errors.push(
      ...c.warnings.map((warning) => ({
        fatal: false,
        message: warning,
        uri: c.yamlConfig.sourceFile,
      })),
    );
    return convertYamlMcpConfigToInternalMcpOptions(
      c.yamlConfig,
      globalRequestOptions,
    );
  });
  // Parse and convert files
  return {
    mcpServers,
    errors,
  };
}
