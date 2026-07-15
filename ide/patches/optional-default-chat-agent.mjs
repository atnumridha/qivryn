export const targetFile =
  "src/vs/workbench/contrib/chat/common/chatService/chatServiceImpl.ts";

const marker =
  "// Qivryn uses contributed Chat Sessions without a default local chat agent";

export function applyOptionalDefaultChatAgent(source) {
  if (source.includes(marker)) return source;
  const anchor =
    /\t\tif \(!defaultAgentData\) \{\r?\n\t\t\tthrow new ErrorNoTelemetry\('No default agent contributed'\);\r?\n\t\t\}/;
  if (!anchor.test(source)) {
    throw new Error(
      "Pinned Code - OSS anchor not found for optional default chat agent",
    );
  }
  return source.replace(
    anchor,
    `		if (!defaultAgentData) {
			${marker}
			return;
		}`,
  );
}
