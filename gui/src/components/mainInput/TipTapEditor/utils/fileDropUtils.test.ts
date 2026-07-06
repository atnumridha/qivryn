import { describe, expect, it, vi } from "vitest";
import { MockIdeMessenger } from "../../../../context/MockIdeMessenger";
import {
  getDroppedFileContextItem,
  getDroppedFileUris,
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
