import {
  getOcrProvider,
  preprocessReceiptImage,
  type ReceiptImageVariant,
  type OcrProvider,
} from "@/lib/ocr";
import { parseReceipt } from "@/lib/receipt/parser";
import { logger } from "@/lib/logger";
import {
  newItemId,
  type EditableExtras,
  type EditableItem,
} from "@/lib/receipt/editable";
import type { ParsedReceipt } from "@/lib/receipt/types";

export type ScanStage = "preprocessing" | "recognizing" | "parsing";

export interface ScanOutcome {
  readonly items: EditableItem[];
  readonly extras: EditableExtras;
  readonly providerId: OcrProvider["id"];
}

/**
 * Thrown instead of a generic error when OCR ran without a technical failure
 * but found nothing usable on the photo — the fix is a better photo, not a
 * retry of the same one.
 */
export class LowQualityScanError extends Error {
  constructor() {
    super("low-quality-scan");
    this.name = "LowQualityScanError";
  }
}

const OCR_PASSES = 2;

export async function scanReceipt(
  file: File,
  onStage: (stage: ScanStage, progress: number) => void,
): Promise<ScanOutcome> {
  const startedAt = Date.now();
  onStage("preprocessing", 0);
  const provider = getOcrProvider();
  logger.info("scan_receipt_start", { provider: provider.id, fileBytes: file.size });
  const variants: ReceiptImageVariant[] = ["contrast", "threshold"];
  const parsedResults: { receipt: ParsedReceipt; confidence: number }[] = [];

  for (let pass = 0; pass < variants.length; pass++) {
    const processed = await preprocessReceiptImage(file, variants[pass]);
    onStage("recognizing", pass / OCR_PASSES);
    const result = await provider.recognize(processed, (p) => {
      if (p.status === "recognizing text") {
        onStage("recognizing", (pass + p.progress) / OCR_PASSES);
      }
    });
    const confidence =
      result.words.length === 0
        ? 0
        : result.words.reduce((sum, word) => sum + word.confidence, 0) /
          result.words.length;
    logger.debug("scan_receipt_pass_done", {
      pass,
      variant: variants[pass],
      words: result.words.length,
      confidence,
    });
    parsedResults.push({
      receipt: parseReceipt(result.words),
      confidence,
    });
  }

  onStage("parsing", 1);
  const parsed = parsedResults.reduce(
    (best, candidate) =>
      scoreParsedReceipt(candidate) > scoreParsedReceipt(best)
        ? candidate
        : best,
    parsedResults[0],
  ).receipt;

  // Nothing usable was found on any pass: OCR itself worked, the photo just
  // didn't contain readable text (blur, glare, wrong crop…).
  if (parsed.items.length === 0 && parsed.detectedTotalCents === null) {
    logger.warn("scan_receipt_low_quality", { durationMs: Date.now() - startedAt });
    throw new LowQualityScanError();
  }

  logger.info("scan_receipt_done", {
    items: parsed.items.length,
    mismatch: parsed.mismatch,
    durationMs: Date.now() - startedAt,
  });

  return {
    items: parsed.items.map((item) => ({
      id: newItemId(),
      name: item.name,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      state: "leido",
    })),
    extras: {
      merchantName: "",
      receiptHeader: [],
      taxCents: parsed.taxIncludedInItems ? 0 : sumByKind(parsed.summary, "tax"),
      tipCents: sumByKind(parsed.summary, "tip"),
      serviceCents: sumByKind(parsed.summary, "service"),
      discountCents: sumByKind(parsed.summary, "discount"),
      detectedTotalCents: parsed.detectedTotalCents,
    },
    providerId: provider.id,
  };
}

function scoreParsedReceipt(candidate: {
  receipt: ParsedReceipt;
  confidence: number;
}): number {
  const { receipt } = candidate;
  return (
    (receipt.mismatch ? 0 : 1000) +
    (receipt.detectedTotalCents === null ? 0 : 100) +
    receipt.items.length * 10 -
    receipt.unmatchedLines.length +
    candidate.confidence
  );
}

function sumByKind(
  summary: readonly { kind: string; amountCents: number }[],
  kind: string,
): number {
  return summary
    .filter((s) => s.kind === kind)
    .reduce((sum, s) => sum + s.amountCents, 0);
}
