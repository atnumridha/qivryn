# Qivryn Codex Desktop Parity Brief

## Reference

The primary reference is the standalone ChatGPT Codex desktop app, not the Codex VS Code extension. Qivryn should preserve the desktop app's interaction contract inside VS Code while adapting its outer shell to the available editor or secondary-sidebar width.

Reference capture: `screenshots/reference-chatgpt-codex-desktop.png`.

## Product Contract

1. Conversation is the canvas. Assistant prose is unframed and follows a centered reading rail in maximized mode.
2. User prompts remain compact, right-aligned surfaces with an edit action that does not compete with the message.
3. Tool calls, plans, terminal output, and reasoning are progressive disclosures. Summaries stay quiet; detailed output expands on demand.
4. The composer is a raised working surface with attachment, mode, model, reasoning, context, and send/stop controls on stable baselines.
5. Agents, scheduled tasks, browser/computer use, MCP tools, plugins, skills, and subagents are first-class destinations rather than hidden extension settings.
6. Concurrent tasks continue when the user navigates to another task. Running tasks are pinned first and expose live state in history and tabs.
7. Maximized chat and history do not show a persistent task list on the left. Navigation opens as an explicit overlay or dedicated view.
8. Narrow mode removes secondary labels before wrapping controls or clipping content.
9. Agent configuration is runtime-compatible across extension upgrades. Imported Codex hooks accept the Codex object schema, and read-only execution blocks writes without blocking the model endpoint.
10. Agent workspace navigation is explicit: the Command Palette and maximize flow preserve `/agents` rather than silently returning to chat.

## Visual Tokens

- UI font: OpenAI Sans with VS Code system-font fallbacks.
- Conversation type: `14px` with readable desktop-app line height.
- Maximized reading rail: `48rem`, yielding a measured `624px` inner rail after padding.
- Narrow canvas: the full available webview width with `12px` content insets.
- Controls: compact icon or icon-plus-label actions with 28-32px stable hit areas.
- Corners: 4-6px for compact controls and menus; larger radius only for user prompts and the composer.
- Borders: one-pixel VS Code theme borders; no decorative nested cards.
- Elevation: reserved for the composer, menus, dialogs, and temporary navigation surfaces.
- Color: VS Code semantic tokens for host consistency; accent is reserved for focus, selection, progress, and primary actions.

## Responsive Contract

- Sidebar target: `280-360px`, including the measured installed `299px` webview.
- Maximized target: `1280-1920px`, including the measured installed `1391px` webview.
- Menus must remain within the webview and may scroll internally.
- Composer controls must keep one optical baseline and never overlap the transcript.
- Chat, history, agents, scheduling, browser, plugins, MCP/tools, and settings must have useful narrow states.
- Body and root horizontal overflow must remain zero in both modes.

## Required States

- Empty chat, active streaming, backgrounded task, completed response, retry/error, and restored session.
- User edit/restart, attachment menu, model menu, proper-case reasoning menu, and `$` skill search.
- Collapsed and expanded tool groups, terminal previews, plans, browser/computer actions, and permission prompts.
- Running indicators, relative task times, scheduled-task creation, agent/subagent orchestration, plugin management, and MCP server/tool management.
- Keyboard focus, reduced motion, long labels, and VS Code high-contrast theme tokens.
