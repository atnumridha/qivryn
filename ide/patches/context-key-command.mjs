export const targetFile =
  "src/vs/workbench/browser/actions/layoutActions.ts";

const marker = "Qivryn layout snapshots need a read-only context bridge";

const anchor = `export const ToggleActivityBarVisibilityActionId = 'workbench.action.toggleActivityBarVisibility';`;

const command = `${anchor}

// Qivryn layout snapshots need a read-only context bridge. The extension host can
// set context keys through the public API, but Code - OSS does not expose reads.
registerAction2(class extends Action2 {
\tconstructor() {
\t\tsuper({
\t\t\tid: 'getContextKeyValue',
\t\t\ttitle: localize2('qivryn.getContextKeyValue', "Read Qivryn Workbench Context"),
\t\t\tf1: false,
\t\t});
\t}

\trun(accessor: ServicesAccessor, key: string): unknown {
\t\treturn accessor.get(IContextKeyService).getContextKeyValue(key);
\t}
});`;

export function applyContextKeyCommand(source) {
  if (source.includes(marker)) return source;

  const index = source.indexOf(anchor);
  if (index < 0) {
    throw new Error("Pinned Code - OSS anchor not found for context key command");
  }
  if (source.indexOf(anchor, index + anchor.length) >= 0) {
    throw new Error("Pinned Code - OSS anchor is ambiguous for context key command");
  }

  return `${source.slice(0, index)}${command}${source.slice(index + anchor.length)}`;
}
