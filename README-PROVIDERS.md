# Continue — Copilot & OCA Provider Integration

This document covers the **Copilot proxy** and **Oracle Code Assist (OCA)**
provider additions to the Continue VS Code extension, how to build the
extension from source, and how to wire up auth so all paid models work
seamlessly.

---

## Table of Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Build & Install the VS Code Extension](#build--install-the-vs-code-extension)
  - [1. Install root dependencies](#1-install-root-dependencies)
  - [2. Build the core library](#2-build-the-core-library)
  - [3. Build openai-adapters](#3-build-openai-adapters)
  - [4. Build the GUI](#4-build-the-gui)
  - [5. Build & package the VS Code extension](#5-build--package-the-vs-code-extension)
  - [6. Install the VSIX](#6-install-the-vsix)
- [Provider Setup](#provider-setup)
  - [GitHub Copilot (via local proxy)](#github-copilot-via-local-proxy)
  - [Oracle Code Assist (OCA)](#oracle-code-assist-oca)
  - [Install the Continue config](#install-the-continue-config)
- [Available Models](#available-models)
- [Daily Use](#daily-use)
- [Token Refresh](#token-refresh)
- [Development Workflow](#development-workflow)
- [Repository Structure](#repository-structure)
- [Troubleshooting](#troubleshooting)

---

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│  VS Code  →  Continue extension (VSIX)                     │
│                                                            │
│  ~/.continue/config.yaml                                   │
│       ├── provider: copilot-proxy  ──────────────────────► │
│       │      model: gpt-5.3-codex / gpt-4.1 / ...         │  Local proxy
│       │      apiBase: http://127.0.0.1:8787/v1/  ──────── ► │  (Node.js)
│       │                                                    │    │
│       └── provider: oca  ─────────────────────────────── ► │    │  GitHub
│              model: oca/gpt-5.3-codex / ...               │    │  Copilot API
│              apiKey: (reads ~/.codex/oca-secrets.json)     │    │
└────────────────────────────────────────────────────────────┘    │
                                                                   ▼
  codex-oca-tool bridge  ◄──────────────────────────────── VS Code Copilot session
  ~/Documents/codex-oca-tool                               ~/.codex/copilot-auth.json
       │
       └── OCA PKCE login ──► Oracle Code Assist LiteLLM
                               ~/.codex/oca-secrets.json
```

**Two providers, two auth paths:**

| Provider | `provider:` key | Auth file | Endpoint |
|---|---|---|---|
| GitHub Copilot (via proxy) | `copilot-proxy` | `~/.codex/copilot-auth.json` | `http://127.0.0.1:8787/v1/` |
| Oracle Code Assist | `oca` | `~/.codex/oca-secrets.json` | OCA LiteLLM HTTPS |

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| macOS | 13+ | Linux works; Windows untested for the proxy |
| Node.js | ≥ 20.20.1 (LTS) | `nvm use` in repo root sets the right version |
| npm | ≥ 10 | Bundled with Node 20 |
| VS Code | ≥ 1.92.0 | For the extension install |
| Git | any | |
| `jq` | any | Required by the codex-oca-tool shell scripts |
| `curl` | any | Used by proxy health checks |
| codex-oca-tool | ≥ 0.2.25 | `~/Documents/codex-oca-tool` — the auth bridge |

Install `jq` if missing:

```bash
brew install jq
```

Check Node.js version:

```bash
node --version   # should be v20.20.1 or higher
```

If you use NVM, run this once from the repo root to activate the correct version:

```bash
cd ~/Documents/continue
nvm use           # reads .nvmrc / .node-version
```

---

## Build & Install the VS Code Extension

All commands run from `~/Documents/continue` unless noted otherwise.

### 1. Install root dependencies

```bash
cd ~/Documents/continue
npm install
```

This installs shared tooling (TypeScript, esbuild, Vite, etc.) for the whole
monorepo.

### 2. Build the core library

```bash
cd ~/Documents/continue/core
npm install
npm run build        # tsc -p ./tsconfig.npm.json
```

The compiled output goes to `core/dist/`. The VS Code extension reads core as
a local dependency.

### 3. Build openai-adapters

```bash
cd ~/Documents/continue/packages/openai-adapters
npm install
npm run build        # tsc
```

This compiles the `CopilotProxyApi` and `OracleCodeAssistApi` adapter classes
together with all existing adapters.

### 4. Build the GUI

```bash
cd ~/Documents/continue/gui
npm install
npm run build        # tsc && vite build
```

The compiled React UI lands in `gui/dist/`. The VS Code extension copies it
into the extension bundle during the next step.

### 5. Build & package the VS Code extension

```bash
cd ~/Documents/continue/extensions/vscode
npm install
npm run package      # runs prepackage.js then vsce package
```

On success this prints:

```
vsce package completed - extension created at extensions/vscode/build/continue-<VERSION>.vsix
```

> **Tip — watch mode for development**
>
> Open VS Code in the repo root, open the Command Palette
> (`Cmd+Shift+P`), choose **Tasks: Run Task → install-all-dependencies**,
> then select **Launch extension** from the Run & Debug panel. This starts
> the extension in a live-reload host window without packaging.

### 6. Install the VSIX

**Option A — VS Code UI**

1. Open VS Code.
2. Open the Extensions panel (`Cmd+Shift+X`).
3. Click the `...` menu → **Install from VSIX…**
4. Select `~/Documents/continue/extensions/vscode/build/continue-<VERSION>.vsix`.
5. Reload VS Code when prompted.

**Option B — command line**

```bash
code --install-extension \
  ~/Documents/continue/extensions/vscode/build/continue-*.vsix
```

**Option C — VS Code task**

Open Command Palette → **Tasks: Run Task → vscode-extension:package**.
This packages and installs in one step.

---

## Provider Setup

### GitHub Copilot (via local proxy)

The proxy is part of [codex-oca-tool](../codex-oca-tool). It must be cloned
and installed before Copilot models work.

#### Step 1 — Install the bridge extension (once)

```bash
cd ~/Documents/codex-oca-tool
bash install.sh --copilot-setup
```

VS Code opens a setup URI. Accept the export prompt, or run from the Command
Palette:

```
Codex Copilot: Export Token and Enable
```

This writes `~/.codex/copilot-auth.json` (GitHub OAuth token + Copilot bearer
token). **Do not commit this file.**

Verify:

```bash
test -f ~/.codex/copilot-auth.json && echo "✓ auth file present"
```

#### Step 2 — Start the local proxy

```bash
bash ~/.codex/bin/codex-copilot enable
```

The proxy starts at `http://127.0.0.1:8787/v1` and auto-refreshes the Copilot
token using the stored GitHub OAuth token.

Check status:

```bash
bash ~/.codex/bin/codex-copilot status
```

Expected output includes:

```
Copilot config block: present
Auth export: present
Proxy health: ok
Model catalog entries: 11
```

Smoke-test the proxy and model list:

```bash
bash ~/.codex/bin/codex-copilot test
# or directly:
curl -s http://127.0.0.1:8787/v1/models | jq '[.data[].id]'
```

#### Step 3 — Keep the proxy running

The proxy must be running whenever you use Copilot models in Continue.

For convenience, use the double-click macOS launcher:

```bash
open ~/.codex/launchers/mac/launch-codex-copilot.command
```

Or start it in the background manually:

```bash
bash ~/.codex/bin/codex-copilot start-proxy
```

---

### Oracle Code Assist (OCA)

#### Step 1 — Log in (once)

```bash
bash ~/Documents/codex-oca-tool/codex-oca-temp.sh login
```

This opens a browser for the OCA OAuth PKCE flow and writes
`~/.codex/oca-secrets.json`. **Do not commit this file.**

Verify:

```bash
bash ~/Documents/codex-oca-tool/codex-oca-temp.sh status
```

#### Step 2 — Token auto-refresh

The `OracleCodeAssist` provider class reads `~/.codex/oca-secrets.json`
**at runtime** for every Continue reload. Tokens auto-refresh through the
codex-oca-tool helper before they expire.

If a token has expired, force-refresh it:

```bash
bash ~/Documents/codex-oca-tool/codex-oca-temp.sh refresh
```

Then re-run the config installer (see next section) to update
`~/.continue/.env`.

---

### Install the Continue config

Run once (and after any token refresh):

```bash
bash ~/Documents/continue/scripts/setup-continue-providers.sh
```

What this does:

1. Creates `~/.continue/` if it does not exist.
2. Copies `.continue-config/config.yaml` → `~/.continue/config.yaml`.
3. Reads `~/.codex/oca-secrets.json` and writes `OCA_API_KEY` to
   `~/.continue/.env` (`chmod 600`).

Options:

```bash
# Regenerate only the .env (e.g. after refreshing the OCA token)
bash scripts/setup-continue-providers.sh --env-only

# Dry-run (print what would happen without writing)
bash scripts/setup-continue-providers.sh --dry-run

# Install config only, skip OCA token check
bash scripts/setup-continue-providers.sh --copilot-only
```

After installation, **reload VS Code** (`Developer: Reload Window`) so
Continue picks up the new config.

---

## Available Models

The config at `.continue-config/config.yaml` provides these models:

### GitHub Copilot (provider: `copilot-proxy`)

| Name in Continue | Model ID | Roles | Capabilities |
|---|---|---|---|
| Copilot: gpt-5.3-codex | `gpt-5.3-codex` | chat, edit, apply | tool_use, image_input |
| Copilot: gpt-4.1 | `gpt-4.1` | chat, edit, apply, summarize | tool_use, image_input |
| Copilot: gpt-4o | `gpt-4o` | chat, edit, apply, summarize | tool_use, image_input |
| Copilot: gpt-4o-mini | `gpt-4o-mini` | chat, edit, apply, subagent | tool_use, image_input |
| Copilot: o3 | `o3` | chat | tool_use |
| Copilot: claude-sonnet-4.5 | `claude-sonnet-4.5` | chat, edit, apply | tool_use |
| Copilot: claude-sonnet-4.6 | `claude-sonnet-4.6` | chat, edit, apply | tool_use |
| Copilot: gemini-2.5-pro | `gemini-2.5-pro` | chat, edit, apply | tool_use, image_input |
| Copilot Autocomplete | `gpt-4o-mini` | autocomplete | — |

> **Claude and Gemini note:** These models are chat-only in Copilot. The local
> proxy transparently translates Continue's `/v1/responses` requests into
> `/chat/completions` and back, so they work without any special configuration.

### Oracle Code Assist (provider: `oca`)

| Name in Continue | Model ID | Roles | Capabilities |
|---|---|---|---|
| OCA: gpt-5.3-codex | `oca/gpt-5.3-codex` | chat, edit, apply | tool_use |
| OCA: gpt-4.1 | `oca/gpt-4.1` | chat, edit, apply, summarize | tool_use |
| OCA: gpt-4o | `oca/gpt-4o` | chat, edit, apply | tool_use |
| OCA Autocomplete | `oca/gpt-4o-mini` | autocomplete | — |

To get the live model list from OCA:

```bash
TOKEN=$(jq -r .ocaApiKey ~/.codex/oca-secrets.json)
curl -s \
  -H "Authorization: Bearer $TOKEN" \
  -H "client: Continue" \
  "https://code-internal.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm/v1/models" \
  | jq '[.data[].id]'
```

---

## Daily Use

### Select a model in Continue

1. Open VS Code.
2. Open the Continue panel (`Cmd+Shift+'` or click the Continue sidebar icon).
3. Click the model name at the bottom of the chat input to open the model
   picker.
4. Select any model from the Copilot or OCA group.

### Copilot quick-start

```bash
# Start the proxy (keep this running in a terminal or as a launcher)
bash ~/.codex/bin/codex-copilot start-proxy

# Check it is healthy
curl -s http://127.0.0.1:8787/health | jq .
```

### OCA quick-start

No daemon needed — the OCA provider reads the token directly from the secrets
file on each request.

```bash
# Verify token is valid
bash ~/Documents/codex-oca-tool/codex-oca-temp.sh status
```

### Switch between providers

Use the Continue model picker. Both providers are always available as long as:

- The Copilot proxy is running (for Copilot models).
- `~/.codex/oca-secrets.json` exists and is not expired (for OCA models).

---

## Token Refresh

### Copilot token

The proxy refreshes the Copilot bearer token automatically using the stored
GitHub OAuth token. If the GitHub token itself expires, re-export from VS Code:

```bash
code --new-window --open-url 'vscode://atanumridha.codex-oca-bridge/copilot-setup'
```

Or from the Command Palette: **Codex Copilot: Export Token and Enable**.

### OCA token

```bash
# Force-refresh the OCA access token
bash ~/Documents/codex-oca-tool/codex-oca-temp.sh refresh

# Propagate the new token into ~/.continue/.env
bash ~/Documents/continue/scripts/setup-continue-providers.sh --env-only

# Reload the Continue extension
# VS Code → Developer: Reload Window
```

---

## Development Workflow

### Watch mode (no VSIX packaging)

```bash
# Terminal 1 — rebuild core on changes
cd ~/Documents/continue/core && npm run build -- --watch 2>/dev/null || npx tsc -p ./tsconfig.npm.json --watch

# Terminal 2 — rebuild openai-adapters on changes
cd ~/Documents/continue/packages/openai-adapters && npx tsc --watch

# Terminal 3 — GUI dev server
cd ~/Documents/continue/gui && npm run dev

# VS Code — launch extension in debug host window
# Command Palette → Tasks: Run Task → install-all-dependencies
# Run & Debug panel → Launch extension → ▶
```

Any change to `core/` or `extensions/vscode/src/` reloads automatically in
the host window. GUI changes hot-reload via Vite.

### Type-check without building

```bash
# Check all packages
cd ~/Documents/continue
npx tsc -p core/tsconfig.json --noEmit
npx tsc -p packages/openai-adapters/tsconfig.json --noEmit
npx tsc -p extensions/vscode/tsconfig.json --noEmit
```

### Run tests

```bash
# core unit tests
cd ~/Documents/continue/core && npm run vitest

# openai-adapters tests
cd ~/Documents/continue/packages/openai-adapters && npm run test

# VS Code extension unit tests
cd ~/Documents/continue/extensions/vscode && npm run vitest
```

### Lint

```bash
cd ~/Documents/continue/core && npm run lint
cd ~/Documents/continue/extensions/vscode && npm run lint
```

### Full rebuild from scratch

```bash
cd ~/Documents/continue

# Root
npm install

# Core
cd core && npm install && npm run build && cd ..

# Packages
cd packages/config-yaml && npm install && npm run build && cd ../..
cd packages/openai-adapters && npm install && npm run build && cd ../..

# GUI
cd gui && npm install && npm run build && cd ..

# VS Code extension
cd extensions/vscode && npm install && npm run package && cd ../..

echo "VSIX ready at: extensions/vscode/build/continue-*.vsix"
```

---

## Repository Structure

```
continue/
├── .continue-config/
│   └── config.yaml                   ← canonical config (copy to ~/.continue/)
├── core/
│   └── llm/
│       └── llms/
│           ├── CopilotProxy.ts       ← NEW: copilot-proxy provider class
│           ├── OracleCodeAssist.ts   ← NEW: oca provider class
│           └── index.ts              ← modified: registers both new classes
├── packages/
│   └── openai-adapters/
│       └── src/
│           ├── apis/
│           │   ├── CopilotProxy.ts   ← NEW: API adapter
│           │   └── OracleCodeAssist.ts ← NEW: API adapter
│           ├── index.ts              ← modified: routes copilot-proxy & oca
│           └── types.ts              ← modified: adds provider literals
├── scripts/
│   └── setup-continue-providers.sh  ← NEW: installs config + .env
└── extensions/
    └── vscode/
        └── build/
            └── continue-<VERSION>.vsix  ← built output
```

---

## Troubleshooting

### Continue shows "No models configured"

Run the config installer and reload VS Code:

```bash
bash ~/Documents/continue/scripts/setup-continue-providers.sh
# VS Code → Developer: Reload Window
```

---

### Copilot model returns 401 or "auth not found"

1. Check the auth file exists:
   ```bash
   test -f ~/.codex/copilot-auth.json && echo "present"
   ```
2. Re-export from VS Code:
   ```
   Codex Copilot: Export Token and Enable
   ```
3. Restart the proxy:
   ```bash
   bash ~/.codex/bin/codex-copilot stop-proxy
   bash ~/.codex/bin/codex-copilot start-proxy
   ```

---

### Copilot proxy is not running

```bash
# Start it
bash ~/.codex/bin/codex-copilot enable

# Check health
curl -s http://127.0.0.1:8787/health | jq .
# Expected: { "ok": true, "version": "...", ... }

# View proxy logs
tail -f ~/.codex/copilot-proxy.log
```

---

### OCA returns 401 or "token expired"

```bash
bash ~/Documents/codex-oca-tool/codex-oca-temp.sh refresh
bash ~/Documents/continue/scripts/setup-continue-providers.sh --env-only
# VS Code → Developer: Reload Window
```

Check token expiry:

```bash
bash ~/Documents/codex-oca-tool/codex-oca-temp.sh status
```

---

### Claude / Gemini models via Copilot return an error

These models are chat-only. Pull the latest proxy code and reinstall:

```bash
cd ~/Documents/codex-oca-tool
git pull
bash install.sh --copilot-setup
bash ~/.codex/bin/codex-copilot stop-proxy
bash ~/.codex/bin/codex-copilot enable
```

---

### Type errors after editing provider files

Run a full type-check:

```bash
cd ~/Documents/continue
npx tsc -p packages/openai-adapters/tsconfig.json --noEmit
npx tsc -p core/tsconfig.json --noEmit
```

Common fix: ensure `"copilot-proxy"` and `"oca"` are in the provider union in
`packages/openai-adapters/src/types.ts` (they are — this is just a reminder if
you add more providers later).

---

### VSIX build fails with "Missing GUI dist"

The VS Code extension bundles the compiled GUI. Build the GUI first:

```bash
cd ~/Documents/continue/gui && npm install && npm run build
cd ~/Documents/continue/extensions/vscode && npm run package
```

---

## Related

- [codex-oca-tool docs (macOS)](../codex-oca-tool/docs/macos.md)
- [Continue upstream README](README.md)
- [Continue contribution guide](CONTRIBUTING.md)
- [Build dependencies & secrets](BUILD_DEPENDENCIES.md)
