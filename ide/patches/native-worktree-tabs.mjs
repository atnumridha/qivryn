export const targetFile =
  "src/vs/workbench/browser/parts/editor/multiEditorTabsControl.ts";

const marker = "interface IQivrynAgentWorktree";

const labelInterfaceAnchor = `interface IEditorInputLabel {
\treadonly editor: EditorInput;

\treadonly name?: string;
\tdescription?: string;
\treadonly forceDescription?: boolean;
\treadonly title?: string;
\treadonly ariaLabel?: string;
}`;

const qivrynWorktreeInterface = `${labelInterfaceAnchor}

interface IQivrynAgentWorktree {
\treadonly root: string;
\treadonly repository: string;
\treadonly branch: string;
\treadonly runId: string;
\treadonly title: string;
}`;

const labelLoopAnchor = `\t\tthis.tabsModel.getEditors(EditorsOrder.SEQUENTIAL).forEach((editor: EditorInput, tabIndex: number) => {
\t\t\tlabels.push({
\t\t\t\teditor,
\t\t\t\tname: editor.getName(),
\t\t\t\tdescription: editor.getDescription(verbosity),
\t\t\t\tforceDescription: editor.hasCapability(EditorInputCapabilities.ForceDescription),
\t\t\t\ttitle: editor.getTitle(Verbosity.LONG),
\t\t\t\tariaLabel: computeEditorAriaLabel(editor, tabIndex, this.groupView, this.editorPartsView.count)
\t\t\t});`;

const qivrynLabelLoop = `\t\tconst qivrynAgentWorktrees = this.contextKeyService.getContextKeyValue<readonly IQivrynAgentWorktree[]>('qivryn.agentWorktrees') ?? [];
\t\tthis.tabsModel.getEditors(EditorsOrder.SEQUENTIAL).forEach((editor: EditorInput, tabIndex: number) => {
\t\t\tconst resource = EditorResourceAccessor.getOriginalUri(editor, { supportSideBySide: SideBySideEditor.PRIMARY });
\t\t\tconst resourcePath = resource?.fsPath;
\t\t\tconst qivrynAgentWorktree = resourcePath ? qivrynAgentWorktrees.find(worktree => {
\t\t\t\tconst candidatePath = isWindows || isMacintosh ? resourcePath.toLowerCase() : resourcePath;
\t\t\t\tconst candidateRoot = isWindows || isMacintosh ? worktree.root.toLowerCase() : worktree.root;
\t\t\t\tconst relativePath = this.path.relative(candidateRoot, candidatePath);
\t\t\t\treturn relativePath === '' || (!relativePath.startsWith('..') && !this.path.isAbsolute(relativePath));
\t\t\t}) : undefined;
\t\t\tconst qivrynAgentLabel = qivrynAgentWorktree
\t\t\t\t? \`⚡ \${qivrynAgentWorktree.repository} · \${qivrynAgentWorktree.branch} · \${qivrynAgentWorktree.title}\`
\t\t\t\t: undefined;
\t\t\tconst editorTitle = editor.getTitle(Verbosity.LONG);
\t\t\tconst editorAriaLabel = computeEditorAriaLabel(editor, tabIndex, this.groupView, this.editorPartsView.count);
\t\t\tlabels.push({
\t\t\t\teditor,
\t\t\t\tname: editor.getName(),
\t\t\t\tdescription: qivrynAgentLabel ?? editor.getDescription(verbosity),
\t\t\t\tforceDescription: Boolean(qivrynAgentLabel) || editor.hasCapability(EditorInputCapabilities.ForceDescription),
\t\t\t\ttitle: qivrynAgentLabel ? \`\${editorTitle} — \${qivrynAgentLabel}\` : editorTitle,
\t\t\t\tariaLabel: qivrynAgentLabel ? \`\${editorAriaLabel}, \${qivrynAgentLabel}\` : editorAriaLabel
\t\t\t});`;

function replaceOnce(source, anchor, replacement, label) {
  const index = source.indexOf(anchor);
  if (index < 0) {
    throw new Error(`Pinned Code - OSS anchor not found for ${label}`);
  }
  if (source.indexOf(anchor, index + anchor.length) >= 0) {
    throw new Error(`Pinned Code - OSS anchor is ambiguous for ${label}`);
  }
  return `${source.slice(0, index)}${replacement}${source.slice(index + anchor.length)}`;
}

export function applyNativeWorktreeTabs(source) {
  if (source.includes(marker)) return source;
  return replaceOnce(
    replaceOnce(
      source,
      labelInterfaceAnchor,
      qivrynWorktreeInterface,
      "Qivryn worktree metadata",
    ),
    labelLoopAnchor,
    qivrynLabelLoop,
    "native worktree tab labels",
  );
}
