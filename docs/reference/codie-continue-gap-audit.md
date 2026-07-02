# CodieApp parity audit

This audit compares Continue with the authorized Cursor 3.9.16 build stored at `/Users/atanumridha/Downloads/codieApp`. A feature is only complete when its observable acceptance criterion is implemented and verified. The [parity ledger](./cursor-parity-ledger.json) records the per-feature status. Slack and hosted/cloud capabilities are intentionally excluded from the target and do not count as parity gaps.

## Delivered in this pass

| Area                       | Result                                                                                                                                                                                                                              | Verification                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Agent output               | Selected runs stream through the daemon SSE endpoint, Core protocol, and webview. Polling is a compatibility fallback.                                                                                                              | Agent runtime transport tests and Agents UI tests |
| Worker recovery            | Core no longer reuses a stale daemon-start promise after the worker exits.                                                                                                                                                          | Core type check and daemon restart tests          |
| Extension runtime          | VSIX packaging includes the self-contained `cn` runtime and VS Code resolves the bundled path before using `PATH`.                                                                                                                  | CLI-path unit tests and packaging file validation |
| Runtime UX                 | Agents show runtime readiness and actual stream state: Connecting, Live, or Reconnecting.                                                                                                                                           | Agents UI tests                                   |
| Agent context              | New, multitask, and follow-up composers attach repository files, symbols, terminal and Git snapshots, configured providers including web, MCP resources, and MCP prompts. Payloads are bounded and file references remain portable. | Agents UI context test                            |
| Multimodal agent context   | Durable image attachments execute locally, through read-only Docker mounts, and through temporary SSH transfer with extension-preserving paths and cleanup.                                                                         | Attachment, lifecycle, Docker, SSH, and CLI tests |
| Nested subagents           | Parent runs render compact live child cards with status, model, diff counts, navigation, and independent cancellation through the shared runtime.                                                                                   | Agent runtime and Agents UI tests                 |
| Context recovery           | Durable and CLI runs compact before overflow, recover once from provider token-count mismatches, bound completed tool payloads, and use a local continuity summary if model compaction cannot fit.                                  | CLI compaction, history, and stream tests         |
| Permission modes           | Autonomous now maps to the CLI's dynamic-security policy; only Full access uses the security-bypassing auto mode.                                                                                                                   | CLI policy and SSH runtime tests                  |
| Semantic review            | Standard and deep IDE reviews combine deterministic checks with model findings constrained to added diff lines and validated patch scope.                                                                                           | Review-engine tests                               |
| Code intelligence settings | Removed the contradictory “deprecated” warning from an active indexing control.                                                                                                                                                     | GUI type check                                    |
| Extension lifecycle        | Added a local managed plugin registry and shared settings controls to import/update, enable, disable, and uninstall trusted bundles; bundled skills activate with read-only provenance.                                             | Plugin manager and Extensions UI tests            |
| Rules and prompts          | Continue loads portable Cursor, Codex, Claude, Copilot, and Agents rules and uses the adapted Codie agent contracts in extension and CLI prompts.                                                                                   | Focused rule and CLI tests                        |

## Partial parity

| Area          | Continue now                                                                                                   | Remaining gap                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Agent hub     | Durable runs, search, chats, worktrees, queue, checkpoints, plans, automations, Docker, and SSH are available. | JetBrains and CLI do not expose the complete GUI action set.                                              |
| Worktree tabs | Files under agent worktrees receive branch- and run-aware decorations and tooltips.                            | A standard VS Code extension cannot replace native editor-tab titles with arbitrary worktree metadata.    |
| SCM graph     | Agent worktrees are opened in VS Code SCM.                                                                     | Native graph nodes for runs and checkpoints are not provided by the public VS Code API.                   |
| Saved layouts | Continue provides Agent, Editor, Zen, Browser, and maximized-chat presets plus workspace-saved aliases.        | Saved layouts currently reference a built-in arrangement rather than capturing arbitrary editor geometry. |

## Excluded capabilities

- Slack integration is outside the requested parity target. Existing token-scoped channel read/write remains available.
- Hosted compute, credential brokering, and Codie-operated resolver services are outside the requested parity target.

## Platform boundaries

- Local runs enforce tool policy, approvals, terminal classification, and workspace scoping, but do not bundle Codie’s proprietary OS sandbox helper. Docker provides the strongest local isolation and disables networking for read-only runs.
- Browser sessions provide navigation, screenshots, DOM, console, network inspection, permissions, locking, and takeover. A live embedded browser canvas requires a maintained editor fork rather than a standard extension.
- Docker and SSH use the shared durable runtime contract. Hosted cloud compute, credential brokering, and Codie-operated resolver services are intentionally excluded.
- Local plugin bundles are copied into Continue-managed storage with path-boundary, symlink, file-count, and size checks. Bundled skills are activated when enabled; rules, MCP definitions, and subagent definitions are surfaced by contribution count and remain managed in their dedicated settings/workspaces.
- Packaged worker lifecycle tests still need a macOS, Linux, and Windows CI matrix even though the runtime and package-level suites pass locally.

## Reference patterns retained from CodieApp

The following patterns were adapted because they are architectural behavior rather than branding or hosted-service coupling:

- persistent workers separated from the webview lifecycle;
- streamed structured agent events with resumable sequence cursors;
- local, Docker, and SSH execution behind one runtime contract;
- isolated Git worktrees for concurrent tasks;
- rule, skill, and subagent discovery across workspace and user scopes;
- background job control, notifications, deep links, and diagnostics;
- explicit permission modes and visible runtime state;
- debounced file watching and bounded event/output buffers.

Codie-specific API names, telemetry, hosted service calls, feature gates, and proprietary sandbox binaries are not copied. Continue uses provider-neutral contracts and supported editor APIs.

## Attached architecture coverage

| Codie subsystem                       | Continue implementation                                                                                                                                           |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent orchestration                   | Durable runtime adapters, streamed events, queue, plans, checkpoints, worktrees, and the Agents workspace.                                                        |
| Local execution                       | Headless `cn` workers with structured tool events, permission modes, cancellation, hooks, and bounded output.                                                     |
| Retrieval                             | Exact search, language-server symbols, indexed context providers, hybrid ranking, and repository-aware context.                                                   |
| Rules, skills, plugins, and subagents | Managed local plugin lifecycle, portable rule and skill discovery, plugin skill activation/provenance, MCP, persisted parent-child runs, and nested run controls. |
| MCP                                   | Existing server authentication, enablement, tools, resources, prompts, diagnostics, and durable Agent context.                                                    |
| Background workers                    | A self-contained daemon survives webview closure, streams with cursors, and recovers interrupted runs.                                                            |
| Remote execution                      | Local, Docker, and SSH adapters use one run contract. Hosted Codie infrastructure is intentionally excluded.                                                      |
| Shadow validation                     | Isolated shadow workspaces plus deterministic and model-backed review validate proposed changes.                                                                  |
| Git and review                        | Worktree branches, checkpoints, patch export, merge, attribution links, review reports, and SCM integration.                                                      |
| Safety                                | Shared permission modes, terminal classification, approvals, tool policy, MCP enablement, and Docker isolation.                                                   |
| Context lifecycle                     | Proactive compaction, bounded tool/context payloads, provider-mismatch recovery, and local fallback summaries prevent overflow loops.                             |

## Priority order

1. Enforce local OS sandbox and network policy at process launch, not only in tool policy.
2. Complete Agent Hub action and status parity across editor, VS Code, JetBrains, and CLI.
3. Add packaged VSIX lifecycle tests on macOS, Linux, and Windows for worker start, reconnect, multitask streaming, and cancellation.
4. Decide whether live browser canvas, native worktree tab titles, native SCM graph nodes, and arbitrary layout capture justify maintaining an editor fork; otherwise record supported extension-level equivalents.
