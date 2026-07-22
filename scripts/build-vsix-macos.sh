#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Build a macOS Qivryn VSIX.

Usage:
  scripts/build-vsix-macos.sh [--target darwin-arm64|darwin-x64] [--pre-release] [--skip-installs] [--skip-gui-build]

Options:
  --target VALUE     VS Code extension target. Defaults to the current Mac architecture.
  --pre-release     Pass --pre-release to vsce package.
  --skip-installs   Set SKIP_INSTALLS=true during prepackage.
  --skip-gui-build  Reuse the existing gui/dist build.
  -h, --help        Show this help.
EOF
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
target="${QIVRYN_VSIX_TARGET:-}"
pre_release=0
skip_installs=0
skip_gui_build=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      target="${2:-}"
      shift 2
      ;;
    --pre-release)
      pre_release=1
      shift
      ;;
    --skip-installs)
      skip_installs=1
      shift
      ;;
    --skip-gui-build)
      skip_gui_build=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script is for macOS. Use scripts/build-vsix-windows.ps1 on Windows." >&2
  exit 1
fi

if [[ -z "$target" ]]; then
  case "$(uname -m)" in
    arm64) target="darwin-arm64" ;;
    x86_64) target="darwin-x64" ;;
    *)
      echo "Unsupported macOS architecture: $(uname -m)" >&2
      exit 1
      ;;
  esac
fi

case "$target" in
  darwin-arm64 | darwin-x64) ;;
  *)
    echo "Unsupported macOS VSIX target: $target" >&2
    exit 1
    ;;
esac

command -v node >/dev/null || {
  echo "node is required but was not found on PATH." >&2
  exit 1
}
command -v npm >/dev/null || {
  echo "npm is required but was not found on PATH." >&2
  exit 1
}

if [[ "$skip_gui_build" -eq 0 ]]; then
  if [[ ! -x "$repo_root/gui/node_modules/.bin/tsc" ]]; then
    echo "[info] Installing GUI build dependencies (TypeScript CLI was not found)"
    npm --prefix "$repo_root/gui" ci
  fi
  npm --prefix "$repo_root/gui" run build
fi

pushd "$repo_root/extensions/vscode" >/dev/null

prepackage_args=(scripts/prepackage.js --target "$target")
package_args=(scripts/package.js --target "$target")
if [[ "$pre_release" -eq 1 ]]; then
  package_args+=(--pre-release)
fi

if [[ "$skip_installs" -eq 1 ]]; then
  SKIP_INSTALLS=true node "${prepackage_args[@]}"
else
  node "${prepackage_args[@]}"
fi
node "${package_args[@]}"

version="$(node -p "require('./package.json').version")"
vsix_path="$repo_root/extensions/vscode/build/qivryn-${version}.vsix"

popd >/dev/null

echo "VSIX created: $vsix_path"
