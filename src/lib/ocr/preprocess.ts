// Canvas preprocessing applied before OCR: this is what moves Tesseract's
// accuracy the most on phone photos of receipts (resize, grayscale, contrast).

import { loadDrawableImage } from "@/lib/receipt/image";

const TARGET_WIDTH = 1600;

export type ReceiptImageVariant = "contrast" | "threshold";

/**
 * Resizes the image to ~TARGET_WIDTH, converts it to grayscale and stretches
 * contrast, then re-encodes it as a JPEG blob ready to feed to an OCR engine.
 */
export async function preprocessReceiptImage(
  file: File | Blob,
  variant: ReceiptImageVariant = "contrast",
): Promise<Blob> {
  const { source, width: sourceWidth, height: sourceHeight, close } =
    await loadDrawableImage(file);

  const scale = Math.min(1, TARGET_WIDTH / sourceWidth);
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas context is not available in this environment");
  }

  ctx.drawImage(source, 0, 0, width, height);
  close();

  const imageData = ctx.getImageData(0, 0, width, height);
  grayscaleAndStretchContrast(imageData);
  if (variant === "threshold") {
    applyOtsuThreshold(imageData);
  }
  ctx.putImageData(imageData, 0, 0);

  return await canvasToBlob(canvas);
}

function grayscaleAndStretchContrast(imageData: ImageData) {
  const { data } = imageData;
  const gray = new Uint8ClampedArray(data.length / 4);

  let min = 255;
  let max = 0;

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    // Standard luma weights.
    const value = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    gray[p] = value;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  const range = Math.max(1, max - min);

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const stretched = ((gray[p] - min) / range) * 255;
    data[i] = stretched;
    data[i + 1] = stretched;
    data[i + 2] = stretched;
  }
}

function applyOtsuThreshold(imageData: ImageData) {
  const histogram = new Uint32Array(256);
  const { data } = imageData;

  for (let i = 0; i < data.length; i += 4) {
    histogram[data[i]]++;
  }

  const totalPixels = data.length / 4;
  const totalIntensity = histogram.reduce(
    (sum, count, intensity) => sum + intensity * count,
    0,
  );
  let backgroundPixels = 0;
  let backgroundIntensity = 0;
  let bestThreshold = 128;
  let bestVariance = 0;

  for (let threshold = 0; threshold < histogram.length; threshold++) {
    backgroundPixels += histogram[threshold];
    if (backgroundPixels === 0) continue;

    const foregroundPixels = totalPixels - backgroundPixels;
    if (foregroundPixels === 0) break;

    backgroundIntensity += threshold * histogram[threshold];
    const backgroundMean = backgroundIntensity / backgroundPixels;
    const foregroundMean =
      (totalIntensity - backgroundIntensity) / foregroundPixels;
    const variance =
      backgroundPixels *
      foregroundPixels *
      (backgroundMean - foregroundMean) ** 2;

    if (variance > bestVariance) {
      bestVariance = variance;
      bestThreshold = threshold;
    }
  }

  for (let i = 0; i < data.length; i += 4) {
    const value = data[i] > bestThreshold ? 255 : 0;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to encode preprocessed image"));
      },
      "image/jpeg",
      0.92,
    );
  });
}
