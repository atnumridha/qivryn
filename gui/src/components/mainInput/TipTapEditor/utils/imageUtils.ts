import { IIdeMessenger } from "../../../../context/IdeMessenger";

const IMAGE_RESOLUTION = 1024;

export function getDataUrlForFile(
  file: File,
  img: HTMLImageElement,
): string | undefined {
  const targetWidth = IMAGE_RESOLUTION;
  const targetHeight = IMAGE_RESOLUTION;
  const scaleFactor = Math.min(
    targetWidth / img.width,
    targetHeight / img.height,
  );

  const canvas = document.createElement("canvas");
  canvas.width = img.width * scaleFactor;
  canvas.height = img.height * scaleFactor;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    console.error("Error getting image data url: 2d context not found");
    return;
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const downsizedDataUrl = canvas.toDataURL("image/jpeg", 0.7);
  return downsizedDataUrl;
}

export async function handleImageFile(
  ideMessenger: IIdeMessenger,
  file: File,
): Promise<[HTMLImageElement, string] | undefined> {
  const filesize = file.size / 1024 / 1024; // filesize in MB
  const supportedImage =
    file.type.startsWith("image/") ||
    /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(file.name);
  if (supportedImage && filesize < 10) {
    // check dimensions
    const objectUrl = (window.URL || window.webkitURL).createObjectURL(file);
    const img = new window.Image();
    img.src = objectUrl;

    return await new Promise((resolve) => {
      const fail = () => {
        URL.revokeObjectURL(objectUrl);
        ideMessenger.post("showToast", [
          "error",
          `Could not read ${file.name} as an image.`,
        ]);
        resolve(undefined);
      };
      img.onerror = fail;
      img.onload = function () {
        URL.revokeObjectURL(objectUrl);
        const dataUrl = getDataUrlForFile(file, img);
        if (!dataUrl) {
          resolve(undefined);
          return;
        }

        const image = new window.Image();
        image.src = dataUrl;
        image.onerror = fail;
        image.onload = function () {
          resolve([image, dataUrl]);
        };
      };
    });
  } else {
    ideMessenger.post("showToast", [
      "error",
      "Images need to use a supported image format and be less than 10MB in size.",
    ]);
  }
}
