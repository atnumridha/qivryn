export const targetFile = "build/gulpfile.vscode.ts";

const marker = "// Qivryn ships its own native agent runtime";

export function applyOptionalBuiltInCopilot(source) {
  if (source.includes(marker)) return source;
  const anchor = `\t\tconst builtInCopilotExtensionDir = path.join(appBase, 'extensions', 'copilot');
\t\tprepareBuiltInCopilotRipgrepShim(platform, arch, builtInCopilotExtensionDir, appNodeModulesDir);`;
  const replacement = `\t\tconst builtInCopilotExtensionDir = path.join(appBase, 'extensions', 'copilot');
\t\t${marker}
\t\tif (fs.existsSync(builtInCopilotExtensionDir)) {
\t\t\tprepareBuiltInCopilotRipgrepShim(platform, arch, builtInCopilotExtensionDir, appNodeModulesDir);
\t\t}`;
  const index = source.indexOf(anchor);
  if (index < 0) {
    throw new Error(
      "Pinned Code - OSS anchor not found for optional built-in Copilot packaging",
    );
  }
  return `${source.slice(0, index)}${replacement}${source.slice(index + anchor.length)}`;
}
