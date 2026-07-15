import { describe, expect, it, vi } from "vitest";
import { MockIdeMessenger } from "../../../../context/MockIdeMessenger";
import {
  containsDroppedFiles,
  getDroppedFileContextItem,
  getDroppedFiles,
  getDroppedFileUris,
  getDroppedFileUrisAsync,
  isImageFile,
} from "./fileDropUtils";

function dataTransferWith(entries: Record<string, string>): DataTransfer {
  return {
    files: [] as unknown as FileList,
    getData: (type: string) => entries[type] ?? "",
  } as DataTransfer;
}

describe("composer file drops", () => {
  it("extracts and deduplicates VS Code and URI-list file resources", () => {
    const dataTransfer = dataTransferWith({
      "text/uri-list":
        "# files\nfile:///workspace/a.ts\nfile:///workspace/b.ts",
      ResourceURLs: JSON.stringify([
        "file:///workspace/a.ts",
        "https://example.com/not-a-file",
      ]),
      CodeFiles: JSON.stringify(["/workspace/c.ts"]),
    });

    expect(getDroppedFileUris(dataTransfer)).toEqual([
      "file:///workspace/a.ts",
      "file:///workspace/b.ts",
      "file:///workspace/c.ts",
    ]);
  });

  it("recognizes protected VS Code Explorer drags by normalized transfer type", () => {
    const dataTransfer = {
      files: [] as unknown as FileList,
      types: ["codefiles"],
      getData: () => "",
    } as unknown as DataTransfer;

    expect(containsDroppedFiles(dataTransfer)).toBe(true);
  });

  it("reads lowercased VS Code transfer names", () => {
    const values: Record<string, string> = {
      resourceurls: JSON.stringify(["file:///workspace/lowercase.ts"]),
      codefiles: JSON.stringify(["/workspace/code-file.ts"]),
    };
    const dataTransfer = {
      files: [] as unknown as FileList,
      types: Object.keys(values),
      getData: (type: string) => values[type] ?? "",
    } as unknown as DataTransfer;

    expect(getDroppedFileUris(dataTransfer)).toEqual([
      "file:///workspace/lowercase.ts",
      "file:///workspace/code-file.ts",
    ]);
  });

  it("reads file items when the webview leaves DataTransfer.files empty", () => {
    const file = new File(["from item"], "item-only.txt", {
      type: "text/plain",
    });
    const dataTransfer = {
      files: [] as unknown as FileList,
      items: [
        {
          kind: "file",
          type: "text/plain",
          getAsFile: () => file,
        },
      ] as unknown as DataTransferItemList,
      types: [],
      getData: () => "",
    } as unknown as DataTransfer;

    expect(containsDroppedFiles(dataTransfer)).toBe(true);
    expect(getDroppedFiles(dataTransfer)).toEqual([file]);
  });

  it("reads URI data exposed only through asynchronous string items", async () => {
    const dataTransfer = {
      files: [] as unknown as FileList,
      items: [
        {
          kind: "string",
          type: "resourceurls",
          getAsString: (callback: (value: string) => void) => {
            queueMicrotask(() =>
              callback(JSON.stringify(["file:///workspace/item-uri.ts"])),
            );
          },
        },
      ] as unknown as DataTransferItemList,
      types: [],
      getData: () => "",
    } as unknown as DataTransfer;

    await expect(getDroppedFileUrisAsync(dataTransfer)).resolves.toEqual([
      "file:///workspace/item-uri.ts",
    ]);
  });

  it("ignores ordinary text exposed through asynchronous string items", async () => {
    const dataTransfer = {
      files: [] as unknown as FileList,
      items: [
        {
          kind: "string",
          type: "text/plain",
          getAsString: (callback: (value: string) => void) =>
            callback("ordinary text"),
        },
      ] as unknown as DataTransferItemList,
      types: ["text/plain"],
      getData: () => "",
    } as unknown as DataTransfer;

    await expect(getDroppedFileUrisAsync(dataTransfer)).resolves.toEqual([]);
  });

  it("parses Codex-compatible public file URL and DownloadURL payloads", () => {
    const dataTransfer = dataTransferWith({
      "public.file-url": "file:///workspace/public.ts",
      DownloadURL: "text/plain:download.ts:file:///workspace/download.ts",
    });

    expect(getDroppedFileUris(dataTransfer)).toEqual([
      "file:///workspace/public.ts",
      "file:///workspace/download.ts",
    ]);
  });

  it("uses plain-text absolute paths without treating ordinary text as files", () => {
    const dataTransfer = dataTransferWith({
      "text/plain": "/workspace/plain.ts\nordinary text",
    });

    expect(getDroppedFileUris(dataTransfer)).toEqual([
      "file:///workspace/plain.ts",
    ]);
    expect(containsDroppedFiles(dataTransfer)).toBe(true);
    expect(
      containsDroppedFiles(dataTransferWith({ "text/plain": "ordinary text" })),
    ).toBe(false);
  });

  it("tolerates protected drag data before the drop event", () => {
    const dataTransfer = {
      files: [] as unknown as FileList,
      getData: () => {
        throw new DOMException("Drag data is protected");
      },
    } as unknown as DataTransfer;

    expect(getDroppedFileUris(dataTransfer)).toEqual([]);
  });

  it("recognizes image files when the browser omits the MIME type", () => {
    expect(isImageFile(new File(["image"], "capture.png"))).toBe(true);
    expect(isImageFile(new File(["text"], "notes.txt"))).toBe(false);
  });

  it("resolves workspace drops through the existing file provider", async () => {
    const messenger = new MockIdeMessenger();
    const request = vi.spyOn(messenger, "request");

    const item = await getDroppedFileContextItem(messenger, {
      uri: "file:///workspace/app.ts",
    });

    expect(request).toHaveBeenCalledWith("context/getContextItems", {
      name: "file",
      query: "file:///workspace/app.ts",
      fullInput: "",
      selectedCode: [],
      isInAgentMode: true,
    });
    expect(item.uri?.value).toBe("file:///Users/test/mock-file.ts");
  });

  it("embeds external files when no IDE URI is available", async () => {
    const file = new File(["hello from disk"], "notes.txt", {
      type: "text/plain",
    });

    const item = await getDroppedFileContextItem(new MockIdeMessenger(), {
      file,
    });

    expect(item.id.providerTitle).toBe("dropped-file");
    expect(item.name).toBe("notes.txt");
    expect(item.content).toBe("hello from disk");
  });

  it("rejects external files above the direct-embedding limit", async () => {
    const file = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.bin");

    await expect(
      getDroppedFileContextItem(new MockIdeMessenger(), { file }),
    ).rejects.toThrow("too large to embed directly");
  });
});
