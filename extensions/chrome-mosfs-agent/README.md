# MOSFS Chrome Agent

Chrome extension plus native host for Qivryn-backed MOSFS analysis and guarded updates.

The extension exposes a compact Qivryn-style transcript, quick tasks, and one composer. It captures the active Chrome tab context, fetches live SR evidence from the active MOSFS tab session when possible, and sends the task to the local native messaging host. The native host keeps sensitive work local:

- runs the Qivryn CLI agent from `/Users/amridha/Documents/qivryn` directly for popup prompts, so the answer is returned in the popup instead of waiting behind durable daemon queue backlog;
- keeps Qivryn daemon status visible for diagnostics through `~/.qivryn/agents/daemon.json`;
- defaults popup agent tasks to `gpt-5.5` with reasoning effort `medium`;
- passes MOSFS, AGENTS, evidence-first, and humanizer guardrails into the Qivryn run prompt;
- fetches SR evidence from the active MOSFS Chrome tab first, using the live browser session for read-only CRM REST calls;
- keeps daemon tokens, bearer tokens, cookies, and raw auth-like values inside the native host and redacts them before any response.

`/Users/amridha/Documents/CodexClone` was checked while building this package, but it is currently an empty Git repository with no committed files. The reusable local pattern is from `browser-cdp-recorder`: MV3 extension plus native messaging host.

`/Users/amridha/Downloads/CodexCloneApp` was used as the local Codex reference. The package identifies as `openai-codex-electron`, product `CodexCloneApp`, version `26.623.81905`, with `.vite/build/bootstrap.js` as the main bundle. Its bundled code shows the same high-level patterns this extension uses: `SKILL.md` discovery with frontmatter, plugin marketplace/config handling, `mcp_servers` config, tool-call UI metadata, `model_reasoning_effort`, and `gpt-5.5` model references.

The GPT backend contract follows the provided `GPT_API.md`: use `~/.codex/auth.json` `.tokens.access_token`, `~/.codex/installation_id`, `~/.codex/models_cache.json` `client_version`, GET `/backend-api/codex/models`, and POST streaming requests to `/backend-api/codex/responses`. The native host never uses refresh or id tokens.

## VS Code / Chrome Separation

The VS Code extension and the Chrome extension are maintained as separate surfaces.

- VS Code extension source and VSIX packaging live under `/Users/amridha/Documents/qivryn/extensions/vscode`.
- Chrome extension source and native host live under `/Users/amridha/Documents/qivryn/extensions/chrome-mosfs-agent`.
- Chrome-only behavior fixes belong in `extension/chrome/`, `src/native-host/`, or other files in this package.
- Chrome packaged Qivryn UI is copied from this package's Chrome-owned snapshot at `vendor/qivryn-gui-dist`.
- Do not change `/Users/amridha/Documents/qivryn/gui` or VS Code extension files for Chrome-only issues.

Build the Chrome extension from its existing Chrome-owned UI snapshot:

```sh
cd /Users/amridha/Documents/qivryn/extensions/chrome-mosfs-agent
npm run build:chrome-extension
```

Only when an intentional VS Code/shared Qivryn UI sync is required, refresh the Chrome-owned snapshot first:

```sh
cd /Users/amridha/Documents/qivryn/extensions/chrome-mosfs-agent
npm run refresh:chrome-qivryn-ui
```

That refresh is the explicit boundary between the VS Code/shared UI and the Chrome extension. It rebuilds `/Users/amridha/Documents/qivryn/gui`, copies the resulting `dist` into `vendor/qivryn-gui-dist`, then packages it into `extension/chrome/qivryn`.

## Install

1. Load the unpacked extension from:

```text
/Users/amridha/Documents/qivryn/extensions/chrome-mosfs-agent/extension/chrome
```

2. The manifest includes a stable Chrome extension key. The expected extension ID is:

```text
hpdgfngnaoadncbkjnbialeelmgnjkli
```

3. The native messaging host has been installed for that ID at:

```text
/Users/amridha/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.local.mosfs_chrome_agent.json
```

If the manifest needs to be regenerated, run:

```sh
cd /Users/amridha/Documents/qivryn/extensions/chrome-mosfs-agent
npm run install:native-hosts -- --chrome-extension-id hpdgfngnaoadncbkjnbialeelmgnjkli
```

4. Open an MOSFS SR tab and use the extension popup composer or quick tasks.

## Guardrails

- Every popup Send or quick-task interaction routes through a Qivryn backend agent process and returns the assistant response in the transcript.
- Active-tab SR evidence is read with the live Chrome session and returned as sanitized markdown.
- Customer-visible send/update/resolve/closure requests must follow the existing MOSFS dry-run, confirmation, and readback rules.
- The agent prompt forbids DOT wording in customer-visible text and forbids token/header/cookie disclosure.
- The native host validates the Qivryn daemon as loopback-only for diagnostics and never returns the daemon token to Chrome.
- Legacy direct native tool routes remain for compatibility, but the popup no longer exposes them.

## Native Host

The native host name is:

```text
com.local.mosfs_chrome_agent
```

Logs:

```text
/Users/amridha/Documents/MOS_Automations/artifacts/mosfs-chrome-agent/logs/native-host.log
```

Run artifacts:

```text
/Users/amridha/Documents/MOS_Automations/artifacts/mosfs-chrome-agent/runs/<run-id>/
```
