# Qivryn Codex Desktop Parity Review

## Result

Qivryn now uses the standalone ChatGPT Codex desktop app as its reference. The VS Code implementation keeps the desktop conversation model, progressive disclosures, centered composer, and capability hierarchy while adapting navigation to the editor and narrow secondary-sidebar layouts.

This is a parity target, not a claim that the VS Code host and standalone Electron shell are pixel-identical. VS Code owns the title bar, workbench chrome, theme tokens, and available panel geometry.

## Resolved Findings

- Added OpenAI Sans assets and aligned conversation density, line height, reading measure, and whitespace with the desktop app.
- Kept assistant responses unframed, user prompts compact and right aligned, and detailed tool output behind quiet disclosures.
- Centered maximized conversation and composer content on a `48rem` rail.
- Removed the persistent left task/history rail from maximized chat, history, agents, browser, and settings flows.
- Preserved a compact narrow layout without wrapped or vertically staggered composer controls.
- Constrained attachment, model, reasoning, and skill menus to the live webview viewport.
- Kept model selection immediately left of Send and exposed reasoning values as Light, Medium, High, Extra High, and Ultra.
- Added durable concurrent agents, subagent handoff/restore, scheduled tasks, browser and computer-use surfaces, MCP/tool management, plugins, and skills.
- Kept background tasks alive across navigation and added running state plus relative recency in task history and tabs.
- Added first-class `Scheduled`, `MCP & tools`, and `Plugins` destinations and an opaque capability menu with desktop-style elevation.
- Rehydrated persisted sessions after VS Code reload and retained edit/restart-from-message behavior.
- Added `Qivryn: Open Agent Workspace` to the Command Palette and preserved `/agents` when VS Code opens or maximizes that surface.
- Migrated detached agent workers to protocol 6 so an extension update cannot reuse a daemon with an obsolete hook or sandbox contract.
- Accepted both native Qivryn hook arrays and imported Codex hook objects. Read-only agents deny filesystem writes while retaining the model transport they need to run.

## Installed Runtime Evidence

| Check                         |                Narrow sidebar |             Maximized |
| ----------------------------- | ----------------------------: | --------------------: |
| Qivryn webview                |                   `299 x 808` |          `1392 x 808` |
| Root/body horizontal overflow |                       `0 / 0` |               `0 / 0` |
| Chat scroll region            |                   `299 x 694` | Full remaining canvas |
| Composer layer                |                   `299 x 114` |          `1392 x 166` |
| Centered composer rail        |                    Full width |           `624 x 142` |
| Model menu                    | `282px` wide, internal scroll |       Within viewport |
| Attachment/reasoning menus    |               Within viewport |       Within viewport |
| Persistent left task list     |              Not used in chat |                Hidden |
| Saved-session restore         |                          Pass |                  Pass |
| Background task continuity    |                          Pass |                  Pass |

Representative installed screenshots:

- `screenshots/latest/installed-vscode-qivryn-conversation-narrow.png`
- `screenshots/latest/installed-vscode-qivryn-conversation-start.png`
- `screenshots/latest/installed-vscode-qivryn-history-maximized.png`
- `screenshots/latest/installed-vscode-qivryn-agents-patched.png`
- `screenshots/latest/installed-vscode-qivryn-scheduled-patched.png`
- `screenshots/latest/installed-vscode-qivryn-browser-narrow.png`
- `screenshots/latest/installed-vscode-qivryn-plugins-narrow.png`
- `screenshots/latest/installed-vscode-qivryn-mcp-final.png`
- `screenshots/latest/installed-vscode-qivryn-settings-final.png`
- `screenshots/latest/installed-vscode-agents-299px-live.png`
- `screenshots/latest/installed-vscode-agents-maximized-live.png`
- `screenshots/latest/installed-vscode-codex-import-299px-live.png`
- `screenshots/latest/installed-vscode-codex-import-maximized-live-loaded.png`
- `screenshots/latest/installed-vscode-codex-hook-review-299px-live.png`
- `screenshots/latest/installed-vscode-mode-menu-299px-live.png`

## Verification

- GUI suite: 65 files, 538 tests passed.
- VS Code extension suite: 23 files, 131 tests passed.
- Agent runtime: 14 files, 83 tests passed.
- Browser runtime: 8 tests passed.
- Config-YAML: 290 tests passed, 1 skipped; MCP conversion coverage is 37/37.
- Core plugin, MCP, and computer-use coverage: 27 passed, 2 skipped.
- Core, GUI, extension, agent-runtime, and browser-runtime TypeScript checks passed.
- Production GUI, agent-runtime, and browser-runtime builds passed. The GUI build retains only the existing Vite large-chunk advisory.
- VSIX `1.3.46` was packaged and installed with `--force` in the normal and isolated Microsoft VS Code profiles.
- Final VSIX SHA-256: `9337ad200a65cee021b6b8931827a78e78288804589a248c5b8246d326efa800`.
- Installed payload inspection confirmed `Scheduled tasks`, `MCP & tools`, and `Skills & plugins` in the deployed bundle.
- Installed protocol migration replaced the live protocol-4 daemon with protocol 6 without a manual kill.
- A real read-only agent run completed with `HOOK_RUNTIME_OK_V2`; all six imported Codex hooks completed, the Seatbelt profile retained `(deny file-write*)`, and the previous `fetch failed` network block was absent.
- The final installed webview was inspected through VS Code's Electron CDP target and Microsoft VS Code accessibility tree. Both the `299px` sidebar and `1392px` agent workspace had `clientWidth === scrollWidth`.
