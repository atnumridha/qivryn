---
name: github-release-build
description: Build, push, and publish Qivryn VS Code GitHub release builds. Use when the user asks to push Qivryn changes, package a VSIX, upload or verify a GitHub release asset, regenerate a release build after a push, or make the GitHub Releases page show the latest qivryn VSIX.
---

# GitHub Release Build

## Purpose

Use this skill to repeat the Qivryn release path safely: validate the tree, build the VS Code extension package, push the rebased commits to `origin/main`, and upload/verify the VSIX on the matching GitHub release.

The workflow is project-specific to `atnumridha/qivryn` from `/Users/atanumridha/Documents/continue`.

## Guardrails

- Do not force-push `main`.
- Do not fetch tags by default; this repo has had local tag conflicts. Use `git fetch --no-tags origin main`.
- Do not print GitHub tokens. Prefer the helper script, which reads credentials from `GH_TOKEN`/`GITHUB_TOKEN` or macOS Keychain without echoing secrets.
- If the user asks for a direct `main` push with a large tracked VSIX, make the risk explicit if approval tooling requests it, then proceed only after explicit confirmation.
- Keep the release asset version aligned with `extensions/vscode/package.json`.
- Prefer release assets over committing VSIX files. If the user explicitly asks to “push the VSIX,” committing `extensions/vscode/build/qivryn-<version>.vsix` is allowed after confirmation.

## Standard workflow

Run commands from the repository root unless noted.

1. Inspect state.

   ```bash
   git status --short
   git branch --show-current
   node -p "require('./extensions/vscode/package.json').version"
   ```

2. Refresh `origin/main` without tags and rebase local commits onto it.

   ```bash
   git fetch --no-tags origin main
   git rebase origin/main
   git rev-list --left-right --count HEAD...origin/main
   ```

   Continue only when the branch is `N 0` ahead/behind before pushing. Resolve conflicts normally; do not use destructive reset unless the user explicitly asks.

3. Validate and build the GUI.

   ```bash
   cd gui
   npm run tsc:check
   npm run build
   ```

4. Validate and package the VS Code extension.

   ```bash
   cd extensions/vscode
   npx tsc -p tsconfig.json --noEmit
   env SKIP_INSTALLS=true npm run prepackage
   node scripts/package.js
   ```

5. Identify the VSIX.

   ```bash
   VERSION=$(node -p "require('./extensions/vscode/package.json').version")
   VSIX="extensions/vscode/build/qivryn-${VERSION}.vsix"
   shasum -a 256 "$VSIX"
   ```

6. Push source commits to `origin/main`.

   Use the normal push first:

   ```bash
   git push origin HEAD:main
   ```

   If this environment cannot find `credential-osxkeychain`, retry with the absolute helper:

   ```bash
   git -c credential.helper=/Library/Developer/CommandLineTools/usr/libexec/git-core/git-credential-osxkeychain push origin HEAD:main
   ```

   If GitHub rejects as non-fast-forward, repeat steps 2 and 6.

7. Upload and verify the release asset.

   The release tag convention is `v<version>-vscode`.

   ```bash
   VERSION=$(node -p "require('./extensions/vscode/package.json').version")
   node .agents/skills/github-release-build/scripts/github_release_asset.mjs \
     --repo atnumridha/qivryn \
     --tag "v${VERSION}-vscode" \
     --asset "extensions/vscode/build/qivryn-${VERSION}.vsix" \
     --create \
     --upload \
     --replace
   ```

   Verify after upload:

   ```bash
   node .agents/skills/github-release-build/scripts/github_release_asset.mjs \
     --repo atnumridha/qivryn \
     --tag "v${VERSION}-vscode" \
     --list
   ```

## Optional local install

Only install locally when the user asks:

```bash
/usr/local/bin/code --install-extension "$VSIX" --force
/usr/local/bin/code --list-extensions --show-versions | rg -i "qivryn"
```

## Final response checklist

Report:

- pushed branch and latest commit SHA;
- release tag;
- uploaded VSIX asset URL;
- SHA256 checksum;
- any GitHub large-file warning;
- whether the local VS Code install was updated.
