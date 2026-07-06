import { ContextItemWithId } from "core";
import { v4 as uuidv4 } from "uuid";
import { IIdeMessenger } from "../../../../context/IdeMessenger";

const URI_LIST_TYPES = [
  "text/uri-list",
  "application/vnd.code.uri-list",
  "ResourceURLs",
] as const;
const CODE_FILES_TYPE = "CodeFiles";
const MAX_EMBEDDED_FILE_BYTES = 5 * 1024 * 1024;

function parseUriList(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !entry.startsWith("#"));
}

function pathToFileUri(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const withLeadingSlash = normalized.startsWith("/")
    ? normalized
    : `/${normalized}`;
  return `file://${withLeadingSlash
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

function parseJsonStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

export function getDroppedFileUris(dataTransfer: DataTransfer): string[] {
  const uris = URI_LIST_TYPES.flatMap((type) => {
    const value = dataTransfer.getData(type);
    if (!value) return [];
    if (type === "ResourceURLs") {
      const resources = parseJsonStringArray(value);
      return resources.length > 0 ? resources : parseUriList(value);
    }
    return parseUriList(value);
  });

  const codeFiles = parseJsonStringArray(dataTransfer.getData(CODE_FILES_TYPE));
  uris.push(...codeFiles.map(pathToFileUri));

  return [...new Set(uris.filter((uri) => uri.startsWith("file:")))];
}

export function getDroppedFiles(dataTransfer: DataTransfer): File[] {
  return Array.from(dataTransfer.files ?? []);
}

export function isImageFile(file: File): boolean {
  return (
    file.type.startsWith("image/") ||
    /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(file.name)
  );
}

async function resolveFileContextItem(
  ideMessenger: IIdeMessenger,
  uri: string,
): Promise<ContextItemWithId | undefined> {
  const response = await ideMessenger.request("context/getContextItems", {
    name: "file",
    query: uri,
    fullInput: "",
    selectedCode: [],
    isInAgentMode: true,
  });
  return response.status === "success" ? response.content[0] : undefined;
}

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error("File read failed"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsText(file);
  });
}

async function createEmbeddedContextItem(
  file: File,
): Promise<ContextItemWithId> {
  if (file.size > MAX_EMBEDDED_FILE_BYTES) {
    throw new Error(
      `${file.name} is too large to embed directly. Drop it from the workspace explorer instead.`,
    );
  }

  return {
    id: {
      providerTitle: "dropped-file",
      itemId: uuidv4(),
    },
    name: file.name,
    description: `${file.type || "file"} · dropped attachment`,
    content: await readFileText(file),
  };
}

export async function getDroppedFileContextItem(
  ideMessenger: IIdeMessenger,
  options: { file?: File; uri?: string },
): Promise<ContextItemWithId> {
  if (options.uri) {
    try {
      const item = await resolveFileContextItem(ideMessenger, options.uri);
      if (item) return item;
    } catch {
      // External drops may expose a URI the extension host cannot read. In that
      // case, use the browser-provided File contents below.
    }
  }
  if (options.file) {
    return createEmbeddedContextItem(options.file);
  }
  throw new Error(`Could not read dropped file ${options.uri ?? ""}`.trim());
}
