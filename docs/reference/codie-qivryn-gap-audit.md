# CodieApp parity audit

This audit compares Qivryn with the authorized Cursor 3.9.16 build stored at `/Users/atanumridha/Downloads/codieApp`. A feature is only complete when its observable acceptance criterion is implemented and verified. The [parity ledger](./cursor-parity-ledger.json) records the per-feature status. Slack and hosted/cloud capabilities are intentionally excluded from the target and do not count as parity gaps.

## Delivered in this pass

| Area                       | Result                                                                                                                                                                                                                              | Verification                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Agent output               | Selected runs stream through the daemon SSE endpoint, Core protocol, and webview. Polling is a compatibility fallback.                                                                                                              | Agent runtime transport tests and Agents UI tests                            |
| Worker recovery            | Core no longer reuses a stale daemon-start promise after the worker exits.                                                                                                                                                          | Core type check and daemon restart tests                                     |
| Extension runtime          | VSIX packaging includes the self-contained `qivryn` runtime and VS Code resolves the bundled path before using `PATH`.                                                                                                              | CLI-path unit tests and packaging file validation                            |
| Runtime UX                 | Agents show runtime readiness and actual stream state: Connecting, Live, or Reconnecting.                                                                                                                                           | Agents UI tests                                                              |
| Agent context              | New, multitask, and follow-up composers attach repository files, symbols, terminal and Git snapshots, configured providers including web, MCP resources, and MCP prompts. Payloads are bounded and file references remain portable. | Agents UI context test                                                       |
| Multimodal agent context   | Durable image attachments execute locally, through read-only Docker mounts, and through temporary SSH transfer with extension-preserving paths and cleanup.                                                                         | Attachment, lifecycle, Docker, SSH, and CLI tests                            |
| Nested subagents           | Parent runs render compact live child cards with status, model, diff counts, navigation, and independent cancellation through the shared runtime.                                                                                   | Agent runtime and Agents UI tests                                            |
| Context recovery           | Durable and CLI runs compact before overflow, recover once from provider token-count mismatches, bound completed tool payloads, and use a local continuity summary if model compaction cannot fit.                                  | CLI compaction, history, and stream tests                                    |
| Permission modes           | Autonomous now maps to the CLI's dynamic-security policy; only Full access uses the security-bypassing auto mode.                                                                                                                   | CLI policy and SSH runtime tests                                             |
| Semantic review            | Standard and deep IDE reviews combine deterministic checks with model findings constrained to added diff lines and validated patch scope.                                                                                           | Review-engine tests                                                          |
| Code intelligence settings | Removed the contradictory “deprecated” warning from an active indexing control.                                                                                                                                                     | GUI type check                                                               |
| Extension lifecycle        | Added a local managed plugin registry and shared settings controls to import/update, enable, disable, and uninstall trusted bundles; bundled skills activate with read-only provenance.                                             | Plugin manager and Extensions UI tests                                       |
| Rules and prompts          | Qivryn loads portable Cursor, Codex, Claude, Copilot, and Agents rules and uses the adapted Codie agent contracts in extension and CLI prompts.                                                                                     | Focused rule and CLI tests                                                   |
| Native desktop foundation  | Qivryn now contributes an in-box `qivryn-agent:` Chat Session provider, durable transcript projection, native session commands, tracked Code OSS patches, and native review, browser, and terminal editor inputs.                   | Core, CLI, extension type checks; protocol, layout, and patch tests          |
| Visual theme tokens        | Qivryn Dark, Midnight, Light, and High Contrast preserve the complete frozen CodieApp workbench, syntax, and semantic-token token sets under Qivryn names.                                                                          | Exact four-theme token comparison; packaged golden comparisons still pending |
| Host sandbox enforcement   | Read-only local runs use macOS Seatbelt or Linux Bubblewrap to deny writes and network access, and fail closed when the required launcher is unavailable.                                                                           | Host sandbox and process-executor tests                                      |
| Packaged worker lifecycle  | The actual VSIX is extracted and its bundled CLI list, authenticated daemon health, termination, descriptor cleanup, and temporary cleanup are exercised in the Linux, Windows, and macOS build matrix.                             | Package smoke script and real VSIX smoke run                                 |
| Async CLI lifecycle        | The CLI now awaits Commander async actions, preventing daemon and other asynchronous commands from exiting before initialization finishes.                                                                                          | Rebuilt CLI and packaged daemon smoke run                                    |

## Partial parity

| Area                              | Qivryn now                                                                                                                                                          | Remaining gate                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Native Agents hub                 | Durable runs project into Code OSS Chat Sessions with native rows, status, transcript, options, approvals, changed files, pin/read state, and `qivryn-agent:` URIs. | Build the full IDE and pass streaming, retry, approval, subagent, cancellation, accessibility, and CodieApp golden tests. |
| Agents Window                     | Native provider handoff, open/focus commands, and persisted session identity are implemented against the Code OSS Agents Window.                                    | Verify shared-session restoration and keyboard/focus behavior in packaged macOS, Linux, and Windows builds.               |
| Worktree tabs and SCM             | Tracked workbench patches add run/worktree identity and native Git repositories expose branches and checkpoints.                                                    | Verify native tab, graph, navigation, and diff behavior in the packaged IDE.                                              |
| Native review                     | Review reports open through Monaco multi-diff and expose accept, reject, and comment commands.                                                                      | Complete checkpoint restoration/navigation integration tests and packaged editor validation.                              |
| Native terminal and browser       | Durable terminal jobs and browser sessions open as native editor inputs and participate in layouts.                                                                 | Verify restart restoration, focus, takeover, permissions, and agent association in packaged Electron tests.               |
| Layouts and composer placement    | Agent, Editor, Zen, Browser, review, and maximized-chat command sequences persist Qivryn layout and composer context.                                               | Verify exact restoration and responsive behavior in packaged cross-platform tests.                                        |
| Visual system                     | Frozen theme tokens match and the native Agent Sessions patch applies CodieApp-derived hierarchy, width, density, radii, focus, and hover rules.                    | Capture all twelve reference states in four themes and meet the 2 px structural / 1.5% pixel-diff budget.                 |
| Onboarding, updates, and recovery | Stock Chat onboarding is disabled by the tracked patch and runtime recovery has bounded retries and explicit events.                                                | Verify first launch, updates, five-attempt retry, final-error display, and log actions in packaged builds.                |

## Excluded capabilities

- Slack integration is outside the requested parity target. Existing token-scoped channel read/write remains available.
- Hosted compute, credential brokering, and Codie-operated resolver services are outside the requested parity target.

## Platform boundaries

- Local runs enforce tool policy, approvals, terminal classification, workspace scoping, and fail-closed host process/network isolation through macOS Seatbelt or Linux Bubblewrap. Docker remains the portable isolation fallback, including on Windows.
- Browser sessions render in a native editor webview and provide navigation, screenshots, DOM, console, network inspection, recording, permissions, locking, and takeover.
- Docker and SSH use the shared durable runtime contract. Hosted cloud compute, credential brokering, and Codie-operated resolver services are intentionally excluded.
- Local plugin bundles are copied into Qivryn-managed storage with path-boundary, symlink, file-count, and size checks. Bundled skills are activated when enabled; rules, MCP definitions, and subagent definitions are surfaced by contribution count and remain managed in their dedicated settings/workspaces.
- Packaged worker lifecycle smoke coverage runs in the existing macOS, Linux, and Windows VSIX matrix and validates the artifact rather than only the source tree.

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

Codie-specific API names, telemetry, hosted service calls, feature gates, and proprietary sandbox binaries are not copied. Qivryn uses provider-neutral contracts and supported editor APIs.

## Attached architecture coverage

| Codie subsystem                       | Qivryn implementation                                                                                                                                             |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent orchestration                   | Durable runtime adapters, streamed events, queue, plans, checkpoints, worktrees, and the Agents workspace.                                                        |
| Local execution                       | Headless `qivryn` workers with structured tool events, permission modes, cancellation, hooks, and bounded output.                                                 |
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

1. Compile and package the pinned Code OSS 1.127 tree with the tracked native patches and in-box Qivryn extension.
2. Run deterministic native functional tests for sessions, approvals, retry, review, browser, terminal, layouts, and window handoff.
3. Record and compare the twelve frozen CodieApp states in all four themes, then promote only the entries that pass their acceptance gates.
