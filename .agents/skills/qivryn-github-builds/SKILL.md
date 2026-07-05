---
name: qivryn-github-builds
description: Build, publish, and verify Qivryn GitHub artifacts. Use when the user asks to push Qivryn changes, generate GitHub builds, build/publish VSIX files, create all-platform desktop installers, trigger the Qivryn IDE installer workflow, create installer release tags, or check GitHub Actions build/release status for the atnumridha/qivryn repository.
---

# Qivryn GitHub Builds

Use this skill for repeatable Qivryn release/build operations. The goal is to ship artifacts through GitHub Actions, not by committing huge installer binaries into Git.

## Core rule

Never commit desktop installer archives into Git. Full IDE packages are hundreds of MB; GitHub Actions artifacts and release assets are the distribution path.

## Build surfaces

- VSIX artifact: `extensions/vscode/build/qivryn-<version>.vsix`
- Desktop installer workflow: `.github/workflows/qivryn-ide-installers.yml`
- Release tag pattern: `v<extension-version>-qivryn-ide`, for example `v1.3.42-qivryn-ide`
- Installer packager: `ide/scripts/package-artifacts.mjs`

Branch pushes to `main` or `codex/qivryn-ide-shell` create Actions artifacts. Tag pushes matching `v*-qivryn-ide` additionally publish release assets.

## Standard workflow

1. Inspect state:

   ```bash
   git status --short --branch
   git log -1 --oneline --decorate
   node -p "require('./extensions/vscode/package.json').version"
   ```

2. Run focused checks before pushing:

   ```bash
   node --check ide/scripts/package-artifacts.mjs
   npm exec prettier -- --check package.json ide/scripts/prepare.mjs ide/scripts/package-artifacts.mjs .github/workflows/qivryn-ide-installers.yml
   ```

3. Stage and commit only source/workflow changes:

   ```bash
   git add <changed-source-files>
   git commit -m "<message>"
   ```

4. Rebase before pushing if branch is behind:

   ```bash
   git pull --rebase origin codex/qivryn-ide-shell
   ```

5. Push the branch:

   ```bash
   git push origin codex/qivryn-ide-shell
   ```

6. For installer release assets, create and push the tag:

   ```bash
   VERSION="$(node -p "require('./extensions/vscode/package.json').version")"
   TAG="v${VERSION}-qivryn-ide"
   git tag -a "$TAG" -m "Qivryn IDE installers ${VERSION}"
   git push origin "$TAG"
   ```

7. Verify the GitHub Actions run:

   ```bash
   node .agents/skills/qivryn-github-builds/scripts/check-build-status.mjs --tag "$TAG"
   ```

## Expected platform artifacts

The installer workflow builds:

- `darwin-x64`
- `darwin-arm64`
- `linux-x64`
- `linux-arm64`
- `win32-x64`
- `win32-arm64` as experimental

Each job uploads a ZIP/TAR package plus SHA-256 metadata. Linux jobs also attempt `.deb` and `.rpm`; Windows jobs also attempt user/system setup `.exe` files.

## Failure handling

- If a platform setup installer fails but the archive package succeeds, report the partial installer result instead of retrying blindly.
- If GitHub rejects a file size, move that file to release assets or Actions artifacts; do not force it into Git.
- If `git credential-osxkeychain` warnings appear but push succeeds, treat them as non-blocking.
- If the branch diverges, rebase; do not force-push unless the user explicitly asks.
