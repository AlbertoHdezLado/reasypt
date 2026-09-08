import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import type { OcrResult, OcrWord } from "@/lib/ocr/types";

export const runtime = "nodejs";

// Server-only OCR provider: proxies to the Google Vision API using a secret
// key, and normalizes the response into the same shape as the Tesseract
// provider (words + bounding boxes) so the parser stays engine-agnostic.

interface VisionVertex {
  x?: number;
  y?: number;
}

interface VisionWord {
  boundingBox?: { vertices?: VisionVertex[] };
  symbols?: { text: string }[];
  confidence?: number;
}

interface VisionPage {
  blocks?: {
    paragraphs?: {
      words?: VisionWord[];
    }[];
  }[];
}

interface VisionResponse {
  responses?: {
    fullTextAnnotation?: {
      text?: string;
      pages?: VisionPage[];
    };
    error?: { message?: string };
  }[];
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { message?: string };
}

// Upper bound on accepted uploads: keeps a single request from abusing the
// (paid, quota-limited) Google Vision API with oversized or unexpected files.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  if (new URL(request.url).searchParams.get("provider") === "gemini") {
    return recognizeWithGemini(request);
  }

  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GOOGLE_VISION_API_KEY is not configured" },
      { status: 501 },
    );
  }

  const formData = await request.formData();
  const image = formData.get("image");
  if (!(image instanceof Blob)) {
    return NextResponse.json({ error: "Missing image" }, { status: 400 });
  }
  if (image.type && !image.type.startsWith("image/")) {
    return NextResponse.json(
      { error: "File must be an image" },
      { status: 400 },
    );
  }
  if (image.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Image is too large" }, { status: 413 });
  }

  const bytes = Buffer.from(await image.arrayBuffer());
  const base64 = bytes.toString("base64");

  logger.info("ocr_vision_request", { imageBytes: bytes.length });
  const visionResponse = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            image: { content: base64 },
            features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
            imageContext: { languageHints: ["es"] },
          },
        ],
      }),
    },
  );

  if (!visionResponse.ok) {
    logger.error("ocr_vision_request_failed", { status: visionResponse.status });
    return NextResponse.json(
      { error: `Google Vision request failed (${visionResponse.status})` },
      { status: 502 },
    );
  }

  const payload = (await visionResponse.json()) as VisionResponse;
  const annotation = payload.responses?.[0];

  if (annotation?.error) {
    logger.error("ocr_vision_response_error", { message: annotation.error.message });
    return NextResponse.json(
      { error: annotation.error.message ?? "Google Vision error" },
      { status: 502 },
    );
  }

  const result = toOcrResult(annotation?.fullTextAnnotation);
  logger.info("ocr_vision_success", { words: result.words.length });
  return NextResponse.json(result);
}

async function recognizeWithGemini(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY is not configured" },
      { status: 501 },
    );
  }

  const formData = await request.formData();
  const image = formData.get("image");
  if (!(image instanceof Blob)) {
    return NextResponse.json({ error: "Missing image" }, { status: 400 });
  }
  if (image.type && !image.type.startsWith("image/")) {
    return NextResponse.json(
      { error: "File must be an image" },
      { status: 400 },
    );
  }
  if (image.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Image is too large" }, { status: 413 });
  }

  const base64 = Buffer.from(await image.arrayBuffer()).toString("base64");
  logger.info("ocr_gemini_request", { imageBytes: image.size });
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL ?? "gemini-3.6-flash"}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: "Transcribe this Spanish restaurant receipt exactly, preserving one receipt line per output line. Receipt item lines usually include both a unit price and a total price. Preserve both prices; when distinguishing them, the total price is the amount furthest to the right on the receipt line. Return only the transcription.",
              },
              {
                inline_data: {
                  mime_type: image.type || "image/jpeg",
                  data: base64,
                },
              },
            ],
          },
        ],
      }),
    },
  );

  const payload = (await response.json().catch(() => null)) as GeminiResponse | null;
  if (!response.ok || payload?.error) {
    logger.error("ocr_gemini_request_failed", {
      status: response.status,
      message: payload?.error?.message,
    });
    return NextResponse.json(
      { error: payload?.error?.message ?? `Gemini request failed (${response.status})` },
      { status: 502 },
    );
  }

  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!text) {
    logger.error("ocr_gemini_empty_response");
    return NextResponse.json({ error: "Gemini returned no text" }, { status: 502 });
  }

  logger.info("ocr_gemini_success", { textLength: text.length });
  return NextResponse.json(textToOcrResult(text));
}

function textToOcrResult(text: string): OcrResult {
  const words: OcrWord[] = [];
  for (const [lineIndex, line] of text.split(/\r?\n/).entries()) {
    let x = 0;
    for (const word of line.match(/\S+/g) ?? []) {
      words.push({
        text: word,
        confidence: 1,
        bbox: {
          x0: x,
          y0: lineIndex * 24,
          x1: x + word.length * 10,
          y1: lineIndex * 24 + 16,
        },
      });
      x += word.length * 10 + 8;
    }
  }
  return { words, text };
}

function toOcrResult(fullTextAnnotation?: {
  text?: string;
  pages?: VisionPage[];
}): OcrResult {
  const words: OcrWord[] = [];

  for (const page of fullTextAnnotation?.pages ?? []) {
    for (const block of page.blocks ?? []) {
      for (const paragraph of block.paragraphs ?? []) {
        for (const word of paragraph.words ?? []) {
          const text = (word.symbols ?? []).map((s) => s.text).join("");
          if (!text.trim()) continue;

          const vertices = word.boundingBox?.vertices ?? [];
          const xs = vertices.map((v) => v.x ?? 0);
          const ys = vertices.map((v) => v.y ?? 0);

          words.push({
            text,
            confidence: word.confidence ?? 1,
            bbox: {
              x0: Math.min(...xs, 0),
              y0: Math.min(...ys, 0),
              x1: Math.max(...xs, 0),
              y1: Math.max(...ys, 0),
            },
          });
        }
      }
    }
  }

  return { words, text: fullTextAnnotation?.text ?? "" };
}
