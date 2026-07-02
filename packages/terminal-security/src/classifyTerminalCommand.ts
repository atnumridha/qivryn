import { parse } from "shell-quote";
import { evaluateTerminalCommandSecurity } from "./evaluateTerminalCommandSecurity.js";
import type {
  TerminalCommandClassification,
  TerminalCommandSegment,
  ToolPolicy,
} from "./types.js";

interface OperatorToken {
  op: string;
}

interface GlobToken {
  op: "glob";
  pattern: string;
}

function isOperator(value: unknown): value is OperatorToken {
  return Boolean(value && typeof value === "object" && "op" in value);
}

function tokenText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (isOperator(value) && value.op === "glob") {
    return (value as GlobToken).pattern;
  }
  return undefined;
}

export function splitTerminalCommand(
  command: string,
): TerminalCommandSegment[] {
  const segments: TerminalCommandSegment[] = [];
  let words: string[] = [];
  const flush = (operatorAfter?: string) => {
    if (words.length > 0) {
      segments.push({
        executable: words[0],
        args: words.slice(1),
        operatorAfter,
      });
      words = [];
    } else if (operatorAfter && segments.length > 0) {
      segments[segments.length - 1].operatorAfter = operatorAfter;
    }
  };
  for (const line of command.split(/\r?\n|\r/)) {
    for (const token of parse(line)) {
      if (isOperator(token) && token.op !== "glob") flush(token.op);
      else {
        const value = tokenText(token);
        if (value !== undefined) words.push(value);
      }
    }
    flush(segments.length > 0 && words.length > 0 ? "newline" : undefined);
  }
  if (segments.at(-1)?.operatorAfter === "newline") {
    delete segments[segments.length - 1].operatorAfter;
  }
  return segments;
}

export function quoteShellArgument(value: string): string {
  if (value.length === 0) return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function buildShellCommand(executable: string, args: string[]): string {
  return [executable, ...args].map(quoteShellArgument).join(" ");
}

export function classifyTerminalCommand(
  basePolicy: ToolPolicy,
  command: string,
  options: { sandboxed?: boolean } = {},
): TerminalCommandClassification {
  const policy = evaluateTerminalCommandSecurity(basePolicy, command);
  const segments = splitTerminalCommand(command);
  const executables = segments.map((segment) =>
    segment.executable.toLowerCase(),
  );
  const elevated = executables.some((value) =>
    ["sudo", "su", "doas", "pkexec", "runas"].includes(value),
  );
  const commandWords = segments.flatMap((segment) => [
    segment.executable,
    ...segment.args,
  ]);
  const requiresNetwork = commandWords.some((word) =>
    /^(curl|wget|fetch|ssh|scp|rsync|gh|npm|pnpm|yarn|pip|pip3|brew|apt|apt-get|dnf|yum|docker|podman)$/i.test(
      word,
    ),
  );
  const mutatesFilesystem = commandWords.some((word) =>
    /^(rm|mv|cp|touch|mkdir|rmdir|install|chmod|chown|git|npm|pnpm|yarn|pip|pip3|sed|tee|dd|mkfs(?:\..*)?)$/i.test(
      word,
    ),
  );
  const hasInterpolation = /\$[({A-Za-z_`]|`/.test(command);
  const hasRedirection = /(^|[^\\])[<>]/.test(command);
  const sandboxed = Boolean(options.sandboxed) && !elevated;
  const reasons: string[] = [];
  if (policy === "disabled")
    reasons.push("Blocked by terminal security policy");
  else if (policy === "allowedWithPermission")
    reasons.push("Requires explicit approval");
  else reasons.push("Allowed by the active policy");
  if (elevated) reasons.push("Requests elevated host privileges");
  if (options.sandboxed && elevated)
    reasons.push("Elevation cannot run inside the sandbox");
  if (requiresNetwork) reasons.push("May access the network");
  if (mutatesFilesystem) reasons.push("May modify files or repository state");
  if (hasInterpolation)
    reasons.push("Contains shell interpolation or substitution");
  if (hasRedirection) reasons.push("Contains shell redirection");
  return {
    command,
    policy,
    segments,
    sandboxed,
    elevated,
    requiresNetwork,
    mutatesFilesystem,
    hasInterpolation,
    hasRedirection,
    reasons,
  };
}
