export const targetFile =
  "src/vs/workbench/contrib/chat/common/constants.ts";

const marker = "// Qivryn native agent session default";

export function applyQivrynDefaultAgentSession(source) {
  if (source.includes(marker)) return source;
  const anchor = `): string {\n\tconst defaultProvider = configurationService.getValue<string>(ChatConfiguration.EditorDefaultProvider);`;
  if (!source.includes(anchor)) {
    throw new Error("Could not find the default chat session selection anchor");
  }
  return source.replace(
    anchor,
    `): string {\n\t${marker}\n\tconst qivrynAgentSessionType = 'qivryn-agent';\n\tif (chatSessionsService.getChatSessionContribution(qivrynAgentSessionType)) {\n\t\treturn qivrynAgentSessionType;\n\t}\n\n\tconst defaultProvider = configurationService.getValue<string>(ChatConfiguration.EditorDefaultProvider);`,
  );
}
