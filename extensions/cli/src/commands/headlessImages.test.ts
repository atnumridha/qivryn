import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatHeadlessMessageWithImages } from "./headlessImages.js";

const temporaryDirectories: string[] = [];

async function temporaryImage(contents: Buffer): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cn-image-test-"));
  temporaryDirectories.push(directory);
  const filepath = path.join(directory, "image.png");
  await writeFile(filepath, contents);
  return filepath;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("formatHeadlessMessageWithImages", () => {
  it("creates a multimodal user message from image paths", async () => {
    const filepath = await temporaryImage(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]),
    );

    const item = await formatHeadlessMessageWithImages("Inspect this", [
      filepath,
    ]);

    expect(item.message.role).toBe("user");
    expect(item.message.content).toEqual([
      { type: "text", text: "Inspect this\n\n" },
      {
        type: "imageUrl",
        imageUrl: { url: expect.stringMatching(/^data:image\/png;base64,/) },
      },
    ]);
  });

  it("rejects missing image paths", async () => {
    await expect(
      formatHeadlessMessageWithImages("Inspect this", [
        "/definitely/missing/image.png",
      ]),
    ).rejects.toThrow();
  });
});
