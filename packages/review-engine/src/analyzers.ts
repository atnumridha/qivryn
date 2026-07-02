import { createHash, randomUUID } from "node:crypto";
import type { ReviewFinding } from "@qivryn/agent-runtime";
import type { ReviewAnalyzer, ReviewAnalyzerContext } from "./contracts.js";

interface AddedLine {
  filepath: string;
  line: number;
  text: string;
}

interface SemanticFinding {
  severity?: unknown;
  title?: unknown;
  body?: unknown;
  filepath?: unknown;
  startLine?: unknown;
  endLine?: unknown;
  evidence?: unknown;
  proposedPatch?: unknown;
}

export type ReviewModelComplete = (
  prompt: string,
  signal: AbortSignal,
) => Promise<string>;

function addedLines(diff: string): AddedLine[] {
  const result: AddedLine[] = [];
  let filepath = "";
  let newLine = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const raw = line.slice(4).trim();
      filepath = raw.startsWith("b/") ? raw.slice(2) : raw;
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (!filepath || line.startsWith("diff --git")) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      result.push({ filepath, line: newLine, text: line.slice(1) });
      newLine++;
    } else if (!line.startsWith("-")) {
      newLine++;
    }
  }
  return result;
}

function finding(
  input: AddedLine,
  severity: ReviewFinding["severity"],
  title: string,
  body: string,
): ReviewFinding {
  const fingerprint = createHash("sha256")
    .update(`${input.filepath}:${input.text}:${title}`)
    .digest("hex");
  return {
    id: randomUUID(),
    requestId: "",
    severity,
    title,
    body,
    filepath: input.filepath,
    startLine: input.line,
    evidence: input.text.trim(),
    originalText: input.text,
    fingerprint,
    status: "open",
    updatedAt: new Date().toISOString(),
  };
}

export class DiffSafetyAnalyzer implements ReviewAnalyzer {
  readonly id = "builtin.diff-safety";

  async analyze(context: ReviewAnalyzerContext): Promise<ReviewFinding[]> {
    const findings: ReviewFinding[] = [];
    for (const input of addedLines(context.source.diff)) {
      if (/^(<{7}|={7}|>{7})/.test(input.text.trim())) {
        findings.push(
          finding(
            input,
            "error",
            "Unresolved merge conflict marker",
            "This added line is a Git conflict marker and will break or corrupt the resulting source file.",
          ),
        );
      }
      if (
        /(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"'\s]{8,}["']/i.test(
          input.text,
        ) &&
        !/(?:process\.env|os\.environ|getenv|secretRef|example|placeholder)/i.test(
          input.text,
        )
      ) {
        findings.push(
          finding(
            input,
            "error",
            "Possible hard-coded credential",
            "The changed line appears to embed a credential. Load secrets from the configured secret provider or environment instead.",
          ),
        );
      }
      if (
        /\b(?:eval|exec)\s*\(/.test(input.text) &&
        !/JSON\.parse/.test(input.text)
      ) {
        findings.push(
          finding(
            input,
            "warning",
            "Dynamic code execution added",
            "Dynamic evaluation is security-sensitive. Verify that no untrusted value can reach this call.",
          ),
        );
      }
    }
    return findings;
  }
}

function extractJsonArray(value: string): SemanticFinding[] {
  const start = value.indexOf("[");
  const end = value.lastIndexOf("]");
  if (start < 0 || end <= start) {
    throw new Error("Semantic review did not return a JSON array");
  }
  const parsed: unknown = JSON.parse(value.slice(start, end + 1));
  if (!Array.isArray(parsed)) {
    throw new Error("Semantic review result must be a JSON array");
  }
  return parsed.filter((item): item is SemanticFinding =>
    Boolean(item && typeof item === "object"),
  );
}

function patchOnlyTouchesFile(patch: string, filepath: string): boolean {
  const touched = [
    ...patch.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm),
  ].flatMap((match) => [match[1], match[2]]);
  return touched.length > 0 && touched.every((path) => path === filepath);
}

/**
 * Model-backed review constrained to added diff lines. Model output is treated
 * as untrusted data and re-anchored against the parsed diff before it reaches
 * the persisted report or autofix path.
 */
export class SemanticDiffAnalyzer implements ReviewAnalyzer {
  readonly id = "builtin.semantic-diff";

  constructor(private readonly complete: ReviewModelComplete) {}

  async analyze(context: ReviewAnalyzerContext): Promise<ReviewFinding[]> {
    if (context.request.mode === "fast" || !context.source.diff.trim())
      return [];
    const lines = addedLines(context.source.diff);
    const validLines = new Map(
      lines.map((line) => [`${line.filepath}:${line.line}`, line] as const),
    );
    if (validLines.size === 0) return [];

    const diffLimit = context.request.mode === "deep" ? 120_000 : 60_000;
    const diff = context.source.diff.slice(0, diffLimit);
    const prompt = `You are a senior code reviewer. Review only defects introduced on added lines in this diff.

Return only a JSON array. Each item must have: severity (info, warning, or error), title, body, filepath, startLine. Optional: endLine, evidence, proposedPatch.

Rules:
- Report concrete correctness, security, reliability, or maintainability defects; do not report preferences or unchanged-code issues.
- filepath and startLine must identify an added line in the diff.
- Keep titles and bodies concise and actionable.
- A proposedPatch must be a complete unified Git patch and may touch only the finding's filepath.
- Return [] when there are no findings.

Mode: ${context.request.mode}
Changed files: ${context.source.changedFiles.join(", ") || "none"}
Diff${context.source.diff.length > diff.length ? " (truncated)" : ""}:
\`\`\`diff
${diff}
\`\`\``;
    const output = await this.complete(prompt, context.signal);
    if (context.signal.aborted) return [];

    const findings: ReviewFinding[] = [];
    for (const candidate of extractJsonArray(output)) {
      if (
        typeof candidate.filepath !== "string" ||
        typeof candidate.startLine !== "number" ||
        typeof candidate.title !== "string" ||
        typeof candidate.body !== "string"
      ) {
        continue;
      }
      const input = validLines.get(
        `${candidate.filepath}:${Math.floor(candidate.startLine)}`,
      );
      if (!input) continue;
      const severity = ["info", "warning", "error"].includes(
        String(candidate.severity),
      )
        ? (candidate.severity as ReviewFinding["severity"])
        : "warning";
      const title = candidate.title.trim().slice(0, 160);
      const body = candidate.body.trim().slice(0, 2_000);
      if (!title || !body) continue;
      const fingerprint = createHash("sha256")
        .update(`${input.filepath}:${input.line}:${title}:${input.text}`)
        .digest("hex");
      const proposedPatch =
        typeof candidate.proposedPatch === "string" &&
        patchOnlyTouchesFile(candidate.proposedPatch, input.filepath)
          ? candidate.proposedPatch
          : undefined;
      findings.push({
        id: randomUUID(),
        requestId: "",
        severity,
        title,
        body,
        filepath: input.filepath,
        startLine: input.line,
        endLine:
          typeof candidate.endLine === "number" &&
          candidate.endLine >= input.line
            ? Math.floor(candidate.endLine)
            : undefined,
        evidence:
          typeof candidate.evidence === "string"
            ? candidate.evidence.slice(0, 1_000)
            : input.text.trim(),
        originalText: input.text,
        proposedPatch,
        fingerprint,
        status: "open",
        updatedAt: new Date().toISOString(),
      });
    }
    return findings;
  }
}
