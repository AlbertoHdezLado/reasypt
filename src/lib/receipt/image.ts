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

/** Thrown when a photo can't be decoded by any of the fallback paths below. */
export class UnsupportedImageFormatError extends Error {
  constructor() {
    super("Unsupported image format");
    this.name = "UnsupportedImageFormatError";
  }
}

/**
 * Decodes a photo into something drawable on a canvas. Tries
 * `createImageBitmap` first; some mobile browsers throw on certain
 * camera-roll photos (odd EXIF/ICC data, some HEIC variants), so on failure
 * this falls back to decoding via an `<img>` element, which is far more
 * permissive. iPhones default to saving photos as HEIC/HEIF, a format most
 * non-Safari browsers can't decode at all (neither path above works), so as
 * a last resort HEIC/HEIF files are transcoded to JPEG in-browser first.
 */
export async function loadDrawableImage(file: File | Blob): Promise<DrawableImage> {
  try {
    return await decodeWithImageBitmap(file);
  } catch {
    try {
      return await decodeWithImgElement(file);
    } catch {
      if (!isHeicFile(file)) throw new UnsupportedImageFormatError();
      try {
        const jpeg = await convertHeicToJpeg(file);
        return await decodeWithImgElement(jpeg);
      } catch {
        throw new UnsupportedImageFormatError();
      }
    }
  }
}

async function decodeWithImageBitmap(file: File | Blob): Promise<DrawableImage> {
  const bitmap = await createImageBitmap(file);
  return {
    source: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    close: () => bitmap.close(),
  };
}

async function decodeWithImgElement(file: File | Blob): Promise<DrawableImage> {
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

function isHeicFile(file: File | Blob): boolean {
  const type = file.type.toLowerCase();
  if (type === "image/heic" || type === "image/heif") return true;
  const name = file instanceof File ? file.name.toLowerCase() : "";
  return name.endsWith(".heic") || name.endsWith(".heif");
}

async function convertHeicToJpeg(file: File | Blob): Promise<Blob> {
  // Loaded on demand: it bundles a WASM decoder and is only needed for the
  // rare HEIC/HEIF upload that browsers can't decode natively.
  const heic2any = (await import("heic2any")).default;
  const result = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
  return Array.isArray(result) ? result[0] : result;
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
