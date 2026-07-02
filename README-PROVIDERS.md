# Qivryn — GitHub Copilot & OCA Provider Integration

This document covers the **GitHub Copilot** and **Oracle Code Assist (OCA)**
provider additions to the Qivryn VS Code extension, how to build the
extension from source, and how to wire up auth so all paid models work
out of the box — with no local proxy, no daemon, and no background process.

---

## Table of Contents

- [How it works](#how-it-works)
- [Prerequisites](#prerequisites)
- [Build & Install the VS Code Extension](#build--install-the-vs-code-extension)
  - [1. Install root dependencies](#1-install-root-dependencies)
  - [2. Build the core library](#2-build-the-core-library)
  - [3. Build openai-adapters](#3-build-openai-adapters)
  - [4. Build the GUI](#4-build-the-gui)
  - [5. Build & package the VS Code extension](#5-build--package-the-vs-code-extension)
  - [6. Install the VSIX](#6-install-the-vsix)
- [Provider Setup](#provider-setup)
  - [GitHub Copilot](#github-copilot)
  - [Oracle Code Assist (OCA)](#oracle-code-assist-oca)
  - [Install the Qivryn config](#install-the-qivryn-config)
- [Available Models](#available-models)
- [Daily Use](#daily-use)
- [Token Refresh](#token-refresh)
- [Development Workflow](#development-workflow)
- [Repository Structure](#repository-structure)
- [Troubleshooting](#troubleshooting)

---

## How it works

```
┌──────────────────────────────────────────────────────────────────┐
│  VS Code — Qivryn extension                                    │
│                                                                  │
│  ~/.qivryn/config.yaml                                         │
│                                                                  │
│    provider: github-copilot  ──────────────────────────────────► │
│      Reads ~/.codex/copilot-auth.json                            │
│      Auto-refreshes bearer via GitHub OAuth token                │  HTTPS
│      Injects Copilot headers                                  ───►  api.githubcopilot.com
│                                                                  │
│    provider: oca  ─────────────────────────────────────────────► │
│      Reads ~/.codex/oca-secrets.json  (JWT written by login)     │  HTTPS
│      Falls back to OCA_API_KEY env / ~/.qivryn/.env         ───►  code-internal.aiservice…
└──────────────────────────────────────────────────────────────────┘
```

**Key design decisions:**

|                | GitHub Copilot                   | Oracle Code Assist                   |
| -------------- | -------------------------------- | ------------------------------------ |
| Provider key   | `github-copilot`                 | `oca`                                |
| Auth file      | `~/.codex/copilot-auth.json`     | `~/.codex/oca-secrets.json`          |
| Token refresh  | Automatic (Qivryn does it)       | Manual (`codex-oca-temp.sh refresh`) |
| Endpoint       | `https://api.githubcopilot.com/` | OCA LiteLLM HTTPS                    |
| Proxy / daemon | **None**                         | **None**                             |

---

## Prerequisites

| Requirement    | Version         | Notes                                                 |
| -------------- | --------------- | ----------------------------------------------------- |
| macOS          | 13+             | Linux works; Windows path handling is untested        |
| Node.js        | ≥ 20.20.1 (LTS) | `nvm use` in repo root selects the right version      |
| npm            | ≥ 10            | Bundled with Node 20                                  |
| VS Code        | ≥ 1.92.0        |                                                       |
| Git            | any             |                                                       |
| `jq`           | any             | Required by the setup script for OCA token reading    |
| codex-oca-tool | ≥ 0.2.25        | `~/Documents/codex-oca-tool` — the auth export bridge |

Install `jq` if missing:

```bash
brew install jq
```

Set the correct Node.js version (if using NVM):

```bash
cd ~/Documents/qivryn && nvm use
```

---

## Build & Install the VS Code Extension

All commands run from `~/Documents/qivryn` unless noted otherwise.

### 1. Install root dependencies

```bash
cd ~/Documents/qivryn
npm install
```

### 2. Build the core library

```bash
cd ~/Documents/qivryn/core
npm install
npm run build
```

Compiles `GitHubCopilot.ts`, `OracleCodeAssist.ts`, and the rest of core.
Output goes to `core/dist/`.

### 3. Build openai-adapters

```bash
cd ~/Documents/qivryn/packages/openai-adapters
npm install
npm run build
```

Compiles `GitHubCopilotApi` and `OracleCodeAssistApi`.

### 4. Build the GUI

```bash
cd ~/Documents/qivryn/gui
npm install
npm run build
```

Bundles the React UI into `gui/dist/`.

### 5. Build & package the VS Code extension

```bash
cd ~/Documents/qivryn/extensions/vscode
npm install
npm run package
```

On success:

```
vsce package completed - extension created at extensions/vscode/build/qivryn-<VERSION>.vsix
```

> **Watch mode (for development)**
>
> Open VS Code in the repo root → Command Palette →
> **Tasks: Run Task → install-all-dependencies**, then switch to
> **Run & Debug → Launch extension → ▶**. This starts a live-reload
> host window without packaging a VSIX.

### 6. Install the VSIX

**Option A — VS Code UI**

1. Open the Extensions panel (`Cmd+Shift+X`).
2. Click `...` → **Install from VSIX…**
3. Select `extensions/vscode/build/qivryn-<VERSION>.vsix`.
4. Reload VS Code when prompted.

**Option B — command line**

```bash
code --install-extension \
  ~/Documents/qivryn/extensions/vscode/build/qivryn-*.vsix
```

**Option C — VS Code task**

Command Palette → **Tasks: Run Task → vscode-extension:package**.

---

## Provider Setup

### GitHub Copilot

#### Step 1 — Export the VS Code Copilot session (once)

Install the codex-oca-bridge extension:

```bash
cd ~/Documents/codex-oca-tool
bash install.sh --copilot-setup
```

VS Code opens a setup URI. Accept the export prompt, or run from the
Command Palette:

```
Codex Copilot: Export Token and Enable
```

This writes `~/.codex/copilot-auth.json`. **Do not commit this file.**

The file contains:

- `github_token` — long-lived GitHub OAuth token (used for automatic renewal)
- `token` — short-lived Copilot bearer (~30 min, auto-refreshed by Qivryn)
- `capi_base` / `endpoints.api` — resolved Copilot API base URL

Verify:

```bash
test -f ~/.codex/copilot-auth.json && echo "✓ Copilot auth ready"
```

**That's it.** Qivryn reads and refreshes the bearer token automatically.
No proxy, no daemon, no port.

#### Step 2 — Re-export when the GitHub token expires

GitHub OAuth tokens eventually expire. Re-export from VS Code:

```bash
code --new-window \
  --open-url 'vscode://atanumridha.codex-oca-bridge/copilot-setup'
```

Or from the Command Palette: **Codex Copilot: Export Token and Enable**.

---

### Oracle Code Assist (OCA)

#### Step 1 — Log in (once)

```bash
bash ~/Documents/codex-oca-tool/codex-oca-temp.sh login
```

Opens a browser for the OCA OAuth PKCE flow. On success, writes
`~/.codex/oca-secrets.json`. **Do not commit this file.**

Verify:

```bash
bash ~/Documents/codex-oca-tool/codex-oca-temp.sh status
```

#### Step 2 — Refresh when the token expires

```bash
bash ~/Documents/codex-oca-tool/codex-oca-temp.sh refresh
bash ~/Documents/qivryn/scripts/setup-qivryn-providers.sh --env-only
# VS Code → Developer: Reload Window
```

---

### Install the Qivryn config

```bash
bash ~/Documents/qivryn/scripts/setup-qivryn-providers.sh
```

What this does:

1. Creates `~/.qivryn/` if it does not exist.
2. Copies `.qivryn-config/config.yaml` → `~/.qivryn/config.yaml`.
3. Reads `~/.codex/oca-secrets.json` and writes `OCA_API_KEY` to
   `~/.qivryn/.env` (mode 600).

Options:

```bash
# Regenerate ~/.qivryn/.env only (after OCA token refresh)
bash scripts/setup-qivryn-providers.sh --env-only

# Dry-run
bash scripts/setup-qivryn-providers.sh --dry-run

# Config only, skip OCA token check
bash scripts/setup-qivryn-providers.sh --copilot-only
```

**Reload VS Code** (`Developer: Reload Window`) after installation.

---

## Available Models

### GitHub Copilot (`provider: github-copilot`)

| Name                       | Model ID            | Roles                        |
| -------------------------- | ------------------- | ---------------------------- |
| Copilot: gpt-5.3-codex     | `gpt-5.3-codex`     | chat, edit, apply            |
| Copilot: gpt-4.1           | `gpt-4.1`           | chat, edit, apply, summarize |
| Copilot: gpt-4o            | `gpt-4o`            | chat, edit, apply, summarize |
| Copilot: gpt-4o-mini       | `gpt-4o-mini`       | chat, edit, apply, subagent  |
| Copilot: o3                | `o3`                | chat                         |
| Copilot: claude-sonnet-4.5 | `claude-sonnet-4.5` | chat, edit, apply            |
| Copilot: claude-sonnet-4.6 | `claude-sonnet-4.6` | chat, edit, apply            |
| Copilot: gemini-2.5-pro    | `gemini-2.5-pro`    | chat, edit, apply            |
| Copilot Autocomplete       | `gpt-4o-mini`       | autocomplete                 |

All Copilot models use `apiBase: https://api.githubcopilot.com/` resolved
from the auth file. No API key in the config — Qivryn reads and refreshes
the bearer token from `~/.codex/copilot-auth.json` automatically.

### Oracle Code Assist (`provider: oca`)

| Name               | Model ID            | Roles                        |
| ------------------ | ------------------- | ---------------------------- |
| OCA: gpt-5.3-codex | `oca/gpt-5.3-codex` | chat, edit, apply            |
| OCA: gpt-4.1       | `oca/gpt-4.1`       | chat, edit, apply, summarize |
| OCA: gpt-4o        | `oca/gpt-4o`        | chat, edit, apply            |
| OCA Autocomplete   | `oca/gpt-4o-mini`   | autocomplete                 |

Token is read at runtime from `~/.codex/oca-secrets.json`. No API key
needed in the config.

---

## Daily Use

1. Open VS Code with the Qivryn extension installed.
2. Open the Qivryn panel (`Cmd+Shift+'` or sidebar icon).
3. Click the model name in the chat input to open the picker.
4. Select any model from the **Copilot** or **OCA** group.

Both providers are available as long as:

- `~/.codex/copilot-auth.json` exists (Copilot models).
- `~/.codex/oca-secrets.json` exists and is not expired (OCA models).

Neither requires any running process.

---

## Token Refresh

### Copilot — fully automatic

Qivryn refreshes the Copilot bearer token itself using the GitHub OAuth
token stored in `copilot-auth.json`. You never need to restart anything.

If the **GitHub OAuth token** itself expires (rare — typically months):

```bash
# Re-export from VS Code
code --new-window \
  --open-url 'vscode://atanumridha.codex-oca-bridge/copilot-setup'
# Or: Command Palette → Codex Copilot: Export Token and Enable
```

### OCA — manual refresh

```bash
bash ~/Documents/codex-oca-tool/codex-oca-temp.sh refresh
bash ~/Documents/qivryn/scripts/setup-qivryn-providers.sh --env-only
# VS Code → Developer: Reload Window
```

---

## Development Workflow

### Watch mode

```bash
# Terminal 1 — core
cd ~/Documents/qivryn/core
npx tsc -p ./tsconfig.npm.json --watch

# Terminal 2 — openai-adapters
cd ~/Documents/qivryn/packages/openai-adapters
npx tsc --watch

# Terminal 3 — GUI dev server
cd ~/Documents/qivryn/gui
npm run dev

# VS Code: Run & Debug → Launch extension → ▶
```

### Type-check without building

```bash
npx tsc -p ~/Documents/qivryn/core/tsconfig.json --noEmit
npx tsc -p ~/Documents/qivryn/packages/openai-adapters/tsconfig.json --noEmit
npx tsc -p ~/Documents/qivryn/extensions/vscode/tsconfig.json --noEmit
```

### Run tests

```bash
cd ~/Documents/qivryn/core && npm run vitest
cd ~/Documents/qivryn/packages/openai-adapters && npm run test
cd ~/Documents/qivryn/extensions/vscode && npm run vitest
```

### Full rebuild from scratch

```bash
cd ~/Documents/qivryn
npm install
(cd core && npm install && npm run build)
(cd packages/config-yaml && npm install && npm run build)
(cd packages/openai-adapters && npm install && npm run build)
(cd gui && npm install && npm run build)
(cd extensions/vscode && npm install && npm run package)
echo "VSIX ready: $(ls extensions/vscode/build/qivryn-*.vsix)"
```

---

## Repository Structure

```
qivryn/
├── .qivryn-config/
│   └── config.yaml                       ← canonical config (copy to ~/.qivryn/)
├── core/
│   └── llm/
│       └── llms/
│           ├── GitHubCopilot.ts          ← NEW: direct Copilot provider (no proxy)
│           ├── OracleCodeAssist.ts       ← NEW: direct OCA provider
│           ├── CopilotProxy.ts           ← shim → GitHubCopilot (compat)
│           └── index.ts                  ← modified: registers both providers
├── packages/
│   └── openai-adapters/
│       └── src/
│           ├── apis/
│           │   ├── GitHubCopilot.ts      ← NEW: API adapter (token-refresh)
│           │   ├── OracleCodeAssist.ts   ← NEW: API adapter (OCI headers)
│           │   └── CopilotProxy.ts       ← shim → GitHubCopilot (compat)
│           ├── index.ts                  ← modified: routes github-copilot & oca
│           └── types.ts                  ← modified: adds provider literals
├── scripts/
│   └── setup-qivryn-providers.sh       ← installs config + .env
└── extensions/
    └── vscode/
        └── build/
            └── qivryn-<VERSION>.vsix   ← built output
```

---

## Troubleshooting

### Qivryn shows "No models configured"

```bash
bash ~/Documents/qivryn/scripts/setup-qivryn-providers.sh
# VS Code → Developer: Reload Window
```

---

### Copilot model returns 401

1. Check the auth file:
   ```bash
   test -f ~/.codex/copilot-auth.json && echo "present"
   ```
2. Re-export from VS Code:
   ```
   Codex Copilot: Export Token and Enable
   ```
3. Reload VS Code:
   ```
   Developer: Reload Window
   ```

---

### OCA model returns 401 or "token expired"

```bash
bash ~/Documents/codex-oca-tool/codex-oca-temp.sh refresh
bash ~/Documents/qivryn/scripts/setup-qivryn-providers.sh --env-only
# VS Code → Developer: Reload Window
```

Check token status:

```bash
bash ~/Documents/codex-oca-tool/codex-oca-temp.sh status
```

---

### Type errors after editing provider files

```bash
npx tsc -p ~/Documents/qivryn/packages/openai-adapters/tsconfig.json --noEmit
npx tsc -p ~/Documents/qivryn/core/tsconfig.json --noEmit
```

---

### VSIX build fails with "Missing GUI dist"

```bash
cd ~/Documents/qivryn/gui && npm install && npm run build
cd ~/Documents/qivryn/extensions/vscode && npm run package
```

---

## Related

- [codex-oca-tool macOS guide](../codex-oca-tool/docs/macos.md)
- [Qivryn upstream README](README.md)
- [Contributing guide](CONTRIBUTING.md)
- [Build dependencies & secrets](BUILD_DEPENDENCIES.md)
