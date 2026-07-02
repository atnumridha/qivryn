#!/usr/bin/env python3

import re
from pathlib import Path

# ==============================================================================
# Configuration
# ==============================================================================

DEFAULT_ROOT = Path("/Users/atanumridha/Downloads/CursorApp").expanduser()

if DEFAULT_ROOT.exists():
    ROOT = DEFAULT_ROOT
    print(f"Using default CursorApp directory:\n  {ROOT}\n")
else:
    while True:
        root = input(
            f"Enter CursorApp root directory [default: {DEFAULT_ROOT}]: "
        ).strip()

        if not root:
            root = str(DEFAULT_ROOT)

        ROOT = Path(root).expanduser().resolve()

        if ROOT.exists() and ROOT.is_dir():
            break

        print(f"\nDirectory not found: {ROOT}\n")

SCRIPT_DIR = Path(__file__).resolve().parent

OUTPUT_DIR = SCRIPT_DIR.parent / "external_rules"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

OUTPUT = OUTPUT_DIR / "all_cursor_prompts.txt"

FILES = [
    "extensions/cursor-agent-exec/dist/main.js",
    "extensions/cursor-always-local/dist/main.js",
    "extensions/git/dist/main.js",
    "extensions/ms-vscode.js-debug/src/extension.js",
    "extensions/ms-vscode.js-debug/src/watchdog.js",
    "extensions/php-language-features/dist/phpMain.js",
    "out/nls.messages.json",
    "out/vs/code/electron-utility/alwaysLocalSingleton/alwaysLocalSingletonMain.js",
    "out/vs/workbench/workbench.desktop.main.js",
    "out/vs/workbench/workbench.glass.main.js",
    "out/vs/workbench/react-runtime/chunk-DLHEHLV2.js",
    "out/vscode-dts/vscode.d.ts",
    "extensions/ms-vscode.vscode-js-profile-table/ThirdPartyNotices.txt",
]

# ==============================================================================
# Regex Patterns
# ==============================================================================

patterns = [

    # promptTemplate
    re.compile(r'promptTemplate\s*:\s*"((?:\\.|[^"])*)"', re.DOTALL),
    re.compile(r"promptTemplate\s*:\s*'((?:\\\\.|[^'])*)'", re.DOTALL),
    re.compile(r'promptTemplate\s*:\s*`((?:\\.|[^`])*)`', re.DOTALL),

    # systemPrompt / systemPromptOverride
    re.compile(r'systemPrompt(?:Override)?\s*:\s*"((?:\\.|[^"])*)"', re.DOTALL),
    re.compile(r"systemPrompt(?:Override)?\s*:\s*'((?:\\\\.|[^'])*)'", re.DOTALL),
    re.compile(r'systemPrompt(?:Override)?\s*:\s*`((?:\\.|[^`])*)`', re.DOTALL),

    # fallbackValues.promptTemplate
    re.compile(
        r'fallbackValues\s*:\s*\{.*?promptTemplate\s*:\s*\[\s*"((?:\\.|[^"])*)"',
        re.DOTALL,
    ),

    # React children
    re.compile(
        r'children\s*:\s*\[\s*"((?:\\.|[^"])*)"',
        re.DOTALL,
    ),

    # Generic long strings
    re.compile(r'"((?:\\.|[^"]){100,})"', re.DOTALL),
    re.compile(r"'((?:\\\\.|[^']){100,})'", re.DOTALL),
    re.compile(r"`((?:\\.|[^`]){100,})`", re.DOTALL),
]

KEYWORDS = [
    "you are",
    "assistant",
    "system",
    "prompt",
    "instructions",
    "your job",
    "help the user",
    "coding agent",
    "ai coding",
    "root orchestrator",
    "debug mode",
    "must",
    "always",
    "never",
    "follow",
    "conversation",
    "transcript",
    "analyze",
    "analysis",
]

# ==============================================================================
# Extraction
# ==============================================================================

seen = set()
total = 0

with open(OUTPUT, "w", encoding="utf-8") as out:

    for relative in FILES:

        file = ROOT / relative

        if not file.exists():
            print(f"[SKIP] {relative}")
            continue

        print(f"[SCAN] {relative}")

        try:
            text = file.read_text(
                encoding="utf-8",
                errors="ignore",
            )
        except Exception as e:
            print(f"Failed to read {relative}: {e}")
            continue

        file_count = 0

        for pattern in patterns:

            for match in pattern.finditer(text):

                s = match.group(1)

                try:
                    s = bytes(s, "utf-8").decode("unicode_escape")
                except Exception:
                    pass

                s = " ".join(s.split())

                if len(s) < 60:
                    continue

                lower = s.lower()

                if not any(keyword in lower for keyword in KEYWORDS):
                    continue

                if s in seen:
                    continue

                seen.add(s)

                total += 1
                file_count += 1

                out.write("=" * 120 + "\n")
                out.write(f"PROMPT #{total}\n")
                out.write(f"FILE: {relative}\n")
                out.write("=" * 120 + "\n\n")
                out.write(s)
                out.write("\n\n")

        print(f"       -> {file_count} prompts")

# ==============================================================================
# Summary
# ==============================================================================

print("\n" + "=" * 80)
print("Extraction Complete")
print("=" * 80)
print(f"Root Directory : {ROOT}")
print(f"Files Scanned  : {len(FILES)}")
print(f"Prompts Found  : {total}")
print(f"Output File    : {OUTPUT}")
print("=" * 80)