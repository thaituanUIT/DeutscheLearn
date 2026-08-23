import type { StimulusImageUploadTarget } from "../api/types";

const MAX_EDGE = 1600;
const WEBP_QUALITY = 0.82;

export type PreparedStimulusImage = {
  file: File;
  width: number;
  height: number;
};

export async function prepareStimulusImage(file: File): Promise<PreparedStimulusImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not process this image in the browser.");
  context.drawImage(bitmap, 0, 0, width, height);

  const webp = await canvasToBlob(canvas, "image/webp", WEBP_QUALITY);
  if (webp) {
    return {
      file: new File([webp], replaceExtension(file.name, "webp"), { type: "image/webp" }),
      width,
      height,
    };
  }

  const fallback = await canvasToBlob(canvas, file.type, WEBP_QUALITY);
  if (!fallback) return { file, width: bitmap.width, height: bitmap.height };
  return {
    file: new File([fallback], file.name, { type: file.type }),
    width,
    height,
  };
}

export async function uploadPreparedStimulusImage(
  target: StimulusImageUploadTarget,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  if (!target.upload_url) throw new Error("The server did not return an upload URL.");
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", target.upload_url);
    request.setRequestHeader("Content-Type", file.type);
    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(request.responseText || `Upload failed with status ${request.status}.`));
    });
    request.addEventListener("error", () => reject(new Error("Upload failed. Check the connection and try again.")));
    request.send(file);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function replaceExtension(name: string, extension: string): string {
  return `${name.replace(/\.[^.]+$/, "") || "stimulus"}.${extension}`;
}
