// Turns a captured receipt photo into a small data URL, kept only in this
// device's storage so the "view original ticket" button has something to show.

const MAX_DIMENSION = 1000;
const JPEG_QUALITY = 0.7;

export interface DrawableImage {
  readonly source: CanvasImageSource;
  readonly width: number;
  readonly height: number;
  readonly close: () => void;
}

/**
 * Decodes a photo into something drawable on a canvas. Tries
 * `createImageBitmap` first; some mobile browsers throw on certain
 * camera-roll photos (odd EXIF/ICC data, some HEIC variants), so on failure
 * this falls back to decoding via an `<img>` element, which is far more
 * permissive.
 */
export async function loadDrawableImage(file: File | Blob): Promise<DrawableImage> {
  try {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to decode image"));
        img.src = url;
      });
      return {
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        close: () => {},
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export async function fileToPreviewDataUrl(file: File): Promise<string> {
  const { source, width: sourceWidth, height: sourceHeight, close } =
    await loadDrawableImage(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(sourceWidth, sourceHeight));
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(source, 0, 0, width, height);
  close();

  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}
