# Qivryn VS Code Design Review

## Result

The chat surface now follows the supplied Codex-in-VS-Code references: assistant prose sits directly on the workbench canvas, user prompts remain compact right-aligned surfaces, tool activity is visually subordinate, and the composer is one raised full-width surface.

## Resolved Findings

- Removed the assistant-message card background, border, radius, and inset shadow.
- Reserved framed surfaces for user prompts, code, terminal output, plans, menus, and the composer.
- Replaced the animated rainbow composer border with the active VS Code progress/focus color.
- Unified mode, attach, model, and Send as 28px controls on one optical center line.
- Kept the model selector immediately left of Send and removed the redundant shortcut pill.
- Showed the compact model and proper-case reasoning value together (`5.5 Medium`) with a measured 5px gap.
- Made completed tool groups quiet disclosure rows and retained four-line terminal previews.
- Normalized tool rows to a 16px icon, 6px gap, and single-space status label.
- Constrained attachment, model, reasoning, and `$` skill menus to the webview viewport.
- Made the normal full-screen action open one maximized in-workbench Qivryn editor and reclaim the secondary-sidebar width.
- Removed the history/task rail from maximized chat while retaining session tabs.
- Rehydrated persisted session tabs from disk after a VS Code reload instead of showing an empty starter screen.
- Added a production VS Code fallback for hosts without the private `getContextKeyValue` command.

## Installed Runtime Evidence

| Check                             |           Sidebar |     Maximized |
| --------------------------------- | ----------------: | ------------: |
| Webview viewport                  |         299 x 808 |    1392 x 808 |
| Document/body horizontal overflow |             0 / 0 |         0 / 0 |
| Composer bounds                   |         264 x 100 |    1349 x 100 |
| Composer radius / border          |        25px / 1px |    25px / 1px |
| Chat type                         |     13px / 19.5px | 13px / 19.5px |
| Tool icon / gap                   |        16px / 6px |    16px / 6px |
| Model / reasoning gap             |               5px |           5px |
| Attachment menu within viewport   |              Pass |          Pass |
| Model menu within viewport        |              Pass |          Pass |
| `$ui` skill menu within viewport  |              Pass |          Pass |
| History/task rail                 | History view only |     0, hidden |
| Cold-start saved transcript       |              Pass |          Pass |

Final installed screenshots:

- `screenshots/installed-final-minimized-full.png`
- `screenshots/installed-final-maximized-full.png`

## Verification

- Complete GUI suite passed: 65 files, 531 tests.
- GUI and VS Code extension TypeScript checks passed.
- VS Code layout suites passed: 10 tests.
- Production GUI build passed; only the existing Vite large-chunk advisory remains.
- VSIX `1.3.46` was packaged, installed with `--force`, cold-started in an isolated Microsoft VS Code profile, and inspected through its real webview targets.
- Saved sessions were loaded locally for visual verification. No model request was sent solely to manufacture screenshots.
