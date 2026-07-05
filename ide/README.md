# Qivryn IDE

Qivryn IDE is a branded Code - OSS distribution with the Qivryn agent runtime and extension included in the product. The upstream source is pinned so native workbench patches remain reviewable and repeatable.

## Prerequisites

- Node.js and npm versions supported by the pinned Code - OSS release
- Git
- The platform build tools required by [Microsoft's VS Code contribution guide](https://github.com/microsoft/vscode/wiki/How-to-Contribute)
- Qivryn workspace dependencies installed
- At least 2 GiB free for the shallow source checkout; a complete dependency install and build requires substantially more

## Prepare the source tree

```bash
npm run ide:prepare
npm run ide:verify
```

The command clones the pinned Code - OSS source into `ide/.build/vscode`, applies the Qivryn product configuration, auditable native workbench patches, and icons, packages the Qivryn extension, and stages both Qivryn extensions as in-box extensions.

Use a clean upstream checkout when changing the pinned version:

```bash
npm run ide:prepare:reset
```

## Build and run

Install upstream dependencies once:

```bash
npm run ide:install
```

Start the Code - OSS compiler in one terminal:

```bash
npm run ide:watch
```

For a one-shot native workbench build that intentionally excludes the stock
Copilot/Chat extension, run:

```bash
npm run ide:compile
```

Launch Qivryn IDE in another terminal:

```bash
npm run ide:run -- /path/to/workspace
```

## Architecture

The distribution has four layers:

1. `microsoft/vscode` supplies the MIT-licensed editor, workbench, terminal, SCM, extension host, and platform integrations.
2. `ide/product.overlay.json` defines the Qivryn application identity, data directories, protocol, telemetry policy, and platform identifiers.
3. `ide/builtin/qivryn-foundation` supplies the original Qivryn theme and safe workbench defaults.
4. `extensions/vscode` supplies Qivryn chat, editing, background agents, reviews, worktrees, browser control, and runtime integration.

Native workbench changes are tracked in `ide/patches/manifest.json`. Each patch is tied to an observable acceptance criterion and a pinned upstream version.

The native worktree-tab patch consumes the bounded `qivryn.agentWorktrees` host context published by the in-box extension. Agent files retain their normal filename while the native tab description and tooltip identify the repository, branch, and agent run.

CodieApp is used only to observe workflows and interaction patterns. Its code, binaries, branding, credentials, hosted endpoints, and proprietary sandbox helpers are not copied.

## Upstream updates

Update `ide/upstream.json`, regenerate the prepared tree, and rebase each native patch against the new Code - OSS tag. Preserve `LICENSE.txt` and `ThirdPartyNotices.txt` in every source and binary distribution.
