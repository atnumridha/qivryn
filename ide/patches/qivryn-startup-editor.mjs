export const targetFile =
  "src/vs/workbench/contrib/welcomeGettingStarted/browser/gettingStarted.contribution.ts";

const marker = "// Qivryn opens the durable Agent workspace instead of Welcome";

export function applyQivrynStartupEditor(source) {
  if (source.includes(marker)) return source;
  const anchor = "\t\t\t'default': 'welcomePage',";
  if (!source.includes(anchor)) {
    throw new Error("Pinned Code - OSS startup editor anchor not found");
  }
  return source.replace(anchor, `\t\t\t${marker}\n\t\t\t'default': 'none',`);
}
