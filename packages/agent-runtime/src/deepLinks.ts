export type QivrynDeepLink =
  | { type: "agent"; runId: string }
  | { type: "checkpoint"; runId: string; checkpointId: string }
  | { type: "review"; reviewId: string }
  | { type: "file"; path: string; line?: number }
  | { type: "settings"; section?: string };

export function formatQivrynDeepLink(
  link: QivrynDeepLink,
  base = "vscode://Qivryn.qivryn",
): string {
  const url = new URL(base);
  switch (link.type) {
    case "agent":
      url.pathname = `/agents/${encodeURIComponent(link.runId)}`;
      break;
    case "checkpoint":
      url.pathname = `/agents/${encodeURIComponent(link.runId)}/checkpoints/${encodeURIComponent(link.checkpointId)}`;
      break;
    case "review":
      url.pathname = `/reviews/${encodeURIComponent(link.reviewId)}`;
      break;
    case "file":
      url.pathname = "/files";
      url.searchParams.set("path", link.path);
      if (link.line !== undefined)
        url.searchParams.set("line", String(link.line));
      break;
    case "settings":
      url.pathname = "/settings";
      if (link.section) url.searchParams.set("section", link.section);
      break;
  }
  return url.toString();
}

export function parseQivrynDeepLink(value: string): QivrynDeepLink | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);
  if (segments[0] === "agents" && segments[1]) {
    if (segments[2] === "checkpoints" && segments[3]) {
      return {
        type: "checkpoint",
        runId: segments[1],
        checkpointId: segments[3],
      };
    }
    return { type: "agent", runId: segments[1] };
  }
  if (segments[0] === "reviews" && segments[1]) {
    return { type: "review", reviewId: segments[1] };
  }
  if (segments[0] === "files") {
    const path = url.searchParams.get("path");
    if (!path) return undefined;
    const rawLine = url.searchParams.get("line");
    const line = rawLine === null ? undefined : Number(rawLine);
    return {
      type: "file",
      path,
      line:
        line !== undefined && Number.isInteger(line) && line > 0
          ? line
          : undefined,
    };
  }
  if (segments[0] === "settings") {
    return {
      type: "settings",
      section: url.searchParams.get("section") ?? undefined,
    };
  }
  return undefined;
}
