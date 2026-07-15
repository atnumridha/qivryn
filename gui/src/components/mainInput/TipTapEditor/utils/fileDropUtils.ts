import { ContextItemWithId } from "core";
import { v4 as uuidv4 } from "uuid";
import { IIdeMessenger } from "../../../../context/IdeMessenger";

const URI_LIST_TYPES = [
  "text/uri-list",
  "application/vnd.code.uri-list",
  "public.file-url",
  "ResourceURLs",
] as const;
const CODE_FILES_TYPE = "CodeFiles";
const DOWNLOAD_URL_TYPE = "DownloadURL";
const PLAIN_TEXT_TYPE = "text/plain";
const normalizeTransferType = (type: string): string => type.toLowerCase();
const FILE_TRANSFER_TYPES = new Set<string>(
  ["Files", CODE_FILES_TYPE, DOWNLOAD_URL_TYPE, ...URI_LIST_TYPES].map(
    normalizeTransferType,
  ),
);
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

function safeGetData(dataTransfer: DataTransfer, type: string): string {
  const normalizedType = normalizeTransferType(type);
  const advertisedType = Array.from(dataTransfer.types ?? []).find(
    (candidate) => normalizeTransferType(candidate) === normalizedType,
  );
  const candidates = [
    ...new Set([type, advertisedType, normalizedType]),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      const value = dataTransfer.getData(candidate);
      if (value) return value;
    } catch {
      // Drag data can remain protected until the final drop event.
    }
  }
  return "";
}

function hasFileItem(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.items ?? []).some(
    (item) => item.kind === "file",
  );
}

function downloadUrlToUri(value: string): string | undefined {
  const uri = value.split(":").slice(2).join(":").trim();
  return uri.startsWith("file:") ? uri : undefined;
}

function plainTextFileUris(value: string): string[] {
  return parseUriList(value).flatMap((entry) => {
    if (entry.startsWith("file:")) return [entry];
    if (entry.startsWith("/") || /^[A-Za-z]:[\\/]/.test(entry)) {
      return [pathToFileUri(entry)];
    }
    return [];
  });
}

function fileUrisFromTransferValue(type: string, value: string): string[] {
  if (!value) return [];

  const normalizedType = normalizeTransferType(type);
  if (normalizedType === normalizeTransferType("ResourceURLs")) {
    const resources = parseJsonStringArray(value);
    return resources.length > 0 ? resources : parseUriList(value);
  }
  if (normalizedType === normalizeTransferType(CODE_FILES_TYPE)) {
    return parseJsonStringArray(value).map(pathToFileUri);
  }
  if (normalizedType === normalizeTransferType(DOWNLOAD_URL_TYPE)) {
    const uri = downloadUrlToUri(value);
    return uri ? [uri] : [];
  }
  if (normalizedType === PLAIN_TEXT_TYPE) {
    return plainTextFileUris(value);
  }
  if (
    URI_LIST_TYPES.some(
      (uriType) => normalizeTransferType(uriType) === normalizedType,
    )
  ) {
    return parseUriList(value);
  }
  return [];
}

function uniqueFileUris(uris: string[]): string[] {
  return [...new Set(uris.filter((uri) => uri.startsWith("file:")))];
}

function readStringItem(item: DataTransferItem): Promise<string[]> {
  if (item.kind !== "string") return Promise.resolve([]);

  return new Promise((resolve) => {
    try {
      item.getAsString((value) => {
        resolve(fileUrisFromTransferValue(item.type, value));
      });
    } catch {
      resolve([]);
    }
  });
}

export function containsDroppedFiles(
  dataTransfer: DataTransfer | null,
): boolean {
  if (!dataTransfer) return false;
  return (
    hasFileItem(dataTransfer) ||
    getDroppedFiles(dataTransfer).length > 0 ||
    Array.from(dataTransfer.types ?? []).some((type) =>
      FILE_TRANSFER_TYPES.has(normalizeTransferType(type)),
    ) ||
    Array.from(dataTransfer.items ?? []).some(
      (item) =>
        item.kind === "string" &&
        FILE_TRANSFER_TYPES.has(normalizeTransferType(item.type)),
    ) ||
    getDroppedFileUris(dataTransfer).length > 0
  );
}

export function getDroppedFileUris(dataTransfer: DataTransfer): string[] {
  const transferTypes = [
    ...URI_LIST_TYPES,
    CODE_FILES_TYPE,
    DOWNLOAD_URL_TYPE,
    PLAIN_TEXT_TYPE,
  ];
  return uniqueFileUris(
    transferTypes.flatMap((type) =>
      fileUrisFromTransferValue(type, safeGetData(dataTransfer, type)),
    ),
  );
}

export async function getDroppedFileUrisAsync(
  dataTransfer: DataTransfer,
): Promise<string[]> {
  const synchronousUris = getDroppedFileUris(dataTransfer);
  const itemUris = await Promise.all(
    Array.from(dataTransfer.items ?? []).map(readStringItem),
  );
  return uniqueFileUris([...synchronousUris, ...itemUris.flat()]);
}

export function getDroppedFiles(dataTransfer: DataTransfer): File[] {
  const files = Array.from(dataTransfer.files ?? []);
  const itemFiles = Array.from(dataTransfer.items ?? []).flatMap((item) => {
    if (item.kind !== "file") return [];
    const file = item.getAsFile();
    return file ? [file] : [];
  });

  const uniqueFiles = new Map<string, File>();
  for (const file of [...files, ...itemFiles]) {
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (!uniqueFiles.has(key)) uniqueFiles.set(key, file);
  }
  return [...uniqueFiles.values()];
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
