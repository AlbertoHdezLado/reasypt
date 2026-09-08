// Hybrid ticket analysis: OCR (Tesseract.js) always runs to get `rawText`,
// then an AI model is tried as the primary parser when configured, with a
// single retry on transient errors, a JSON "repair" retry on invalid
// payloads, and a final fallback to the regex/OCR parser on any failure.

import { recognizeWithTesseract } from "@/lib/ocr/tesseract";
import { parseReceipt } from "@/lib/receipt/parser";
import { logger } from "@/lib/logger";
import type { OcrWord } from "@/lib/ocr/types";
import type { FallbackReason, TicketAnalysisItem, TicketAnalysisResult } from "./types";

const AI_TIMEOUT_MS = 8000;
const AI_ENDPOINT =
  process.env.AI_TICKET_ENDPOINT ?? "https://api.openai.com/v1/chat/completions";
const AI_MODEL = process.env.AI_TICKET_MODEL ?? "gpt-4o-mini";

/** Whether AI analysis is configured and can be attempted. */
export function aiIsAvailable(): boolean {
  return Boolean(process.env.AI_TICKET_API_KEY);
}

export async function analyzeTicket(
  imageBuffer: Buffer,
): Promise<TicketAnalysisResult> {
  const startedAt = Date.now();
  logger.info("ticket_analysis_start", { imageBytes: imageBuffer.length });

  const ocr = await recognizeWithTesseract(imageBuffer);
  const rawText = ocr.text;
  logger.debug("ticket_analysis_ocr_done", {
    words: ocr.words.length,
    rawTextLength: rawText.length,
    durationMs: Date.now() - startedAt,
  });

  if (aiIsAvailable()) {
    const aiResult = await tryAiAnalysis(rawText);
    if (aiResult) {
      logger.info("ticket_analysis_done", {
        source: aiResult.source,
        items: aiResult.items.length,
        durationMs: Date.now() - startedAt,
      });
      return aiResult;
    }
  } else {
    logFallback("ai_unavailable");
  }

  const fallbackResult = parseWithRegex(
    rawText,
    ocr.words.length > 0 ? ocr.words : undefined,
  );
  logger.info("ticket_analysis_done", {
    source: fallbackResult.source,
    items: fallbackResult.items.length,
    durationMs: Date.now() - startedAt,
  });
  return fallbackResult;
}

/** Runs the AI path end to end; returns null (after logging) if it should fall back to OCR. */
async function tryAiAnalysis(
  rawText: string,
): Promise<TicketAnalysisResult | null> {
  logger.debug("ticket_analysis_ai_attempt", { model: AI_MODEL });
  const first = await callAiWithRetry(buildPrompt(rawText));
  if (!first.ok) {
    logFallback(first.reason);
    return null;
  }

  const parsed = parseAiJson(first.text);
  if (parsed.ok) {
    const validated = validateAiPayload(parsed.data);
    if (validated.ok) {
      logger.debug("ticket_analysis_ai_success", { items: validated.data.items.length });
      return toUnifiedResult(validated.data, "ai");
    }
    logFallback(validated.reason, { stage: "repair" });
    return repairAndValidate(rawText, first.text);
  }

  logFallback(parsed.reason, { stage: "repair" });
  return repairAndValidate(rawText, first.text);
}

/** Single repair attempt after an invalid AI JSON/schema response. */
async function repairAndValidate(
  rawText: string,
  invalidOutput: string,
): Promise<TicketAnalysisResult | null> {
  logger.debug("ticket_analysis_ai_repair_attempt");
  const repair = await callAiWithRetry(buildRepairPrompt(rawText, invalidOutput));
  if (!repair.ok) {
    logFallback(repair.reason, { stage: "repair" });
    return null;
  }

  const parsed = parseAiJson(repair.text);
  if (!parsed.ok) {
    logFallback(parsed.reason, { stage: "repair" });
    return null;
  }

  const validated = validateAiPayload(parsed.data);
  if (!validated.ok) {
    logFallback(validated.reason, { stage: "repair" });
    return null;
  }

  logger.debug("ticket_analysis_ai_repair_success", { items: validated.data.items.length });
  return toUnifiedResult(validated.data, "ai");
}

interface AiCallSuccess {
  ok: true;
  text: string;
}
interface AiCallFailure {
  ok: false;
  reason: FallbackReason;
}
type AiCallResult = AiCallSuccess | AiCallFailure;

const TRANSIENT_REASONS = new Set<FallbackReason>([
  "timeout",
  "rate_limit",
  "server_error",
]);

/** Calls the AI endpoint once, retrying a single time on transient errors. */
async function callAiWithRetry(prompt: string): Promise<AiCallResult> {
  const attempt1 = await callAiOnce(prompt);
  if (attempt1.ok || !TRANSIENT_REASONS.has(attempt1.reason)) return attempt1;
  logger.debug("ticket_analysis_ai_retry", { reason: attempt1.reason });
  return callAiOnce(prompt);
}

async function callAiOnce(prompt: string): Promise<AiCallResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const response = await fetch(AI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.AI_TICKET_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });

    if (response.status === 429) {
      logger.warn("ticket_analysis_ai_call_failed", { status: response.status, reason: "rate_limit" });
      return { ok: false, reason: "rate_limit" };
    }
    if (response.status >= 500) {
      logger.warn("ticket_analysis_ai_call_failed", { status: response.status, reason: "server_error" });
      return { ok: false, reason: "server_error" };
    }
    if (!response.ok) {
      logger.warn("ticket_analysis_ai_call_failed", { status: response.status, reason: "server_error" });
      return { ok: false, reason: "server_error" };
    }

    const text = await extractAiText(response);
    return { ok: true, text };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      logger.warn("ticket_analysis_ai_call_failed", { reason: "timeout" });
      return { ok: false, reason: "timeout" };
    }
    logger.error("ticket_analysis_ai_call_failed", {
      reason: "network_error",
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: "network_error" };
  } finally {
    clearTimeout(timer);
  }
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

async function extractAiText(response: Response): Promise<string> {
  const payload = (await response.json()) as ChatCompletionResponse;
  return payload.choices?.[0]?.message?.content ?? "";
}

function buildPrompt(rawText: string): string {
  return [
    "Extract structured data from this receipt's OCR text and respond with",
    "a single JSON object with keys: merchant_name, ticket_number, currency,",
    "items (array of { name, quantity, unit_price, line_total }), subtotal,",
    "tax, total. Use null for unknown fields.",
    "",
    "OCR text:",
    rawText,
  ].join("\n");
}

function buildRepairPrompt(rawText: string, invalidOutput: string): string {
  return [
    "Your previous response was not valid JSON matching the required schema.",
    "Respond again with ONLY a single valid JSON object with keys:",
    "merchant_name, ticket_number, currency, items (array of",
    "{ name, quantity, unit_price, line_total }), subtotal, tax, total.",
    "Use null for unknown fields.",
    "",
    "Previous invalid response:",
    invalidOutput,
    "",
    "OCR text:",
    rawText,
  ].join("\n");
}

interface JsonParseSuccess {
  ok: true;
  data: unknown;
}
interface JsonParseFailure {
  ok: false;
  reason: "json_error";
}

function parseAiJson(text: string): JsonParseSuccess | JsonParseFailure {
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, reason: "json_error" };
  }
}

export interface AiTicketPayload {
  merchant_name: string | null;
  ticket_number: string | null;
  currency: string | null;
  items: TicketAnalysisItem[];
  subtotal: number | null;
  tax: number | null;
  total: number | null;
}

interface ValidationSuccess {
  ok: true;
  data: AiTicketPayload;
}
interface ValidationFailure {
  ok: false;
  reason: "schema_error";
}

/** Strict, hand-rolled schema check for the AI JSON payload (no `any`). */
function validateAiPayload(
  data: unknown,
): ValidationSuccess | ValidationFailure {
  if (!isRecord(data)) return { ok: false, reason: "schema_error" };

  const merchantName = data.merchant_name;
  const ticketNumber = data.ticket_number;
  const currency = data.currency;
  const subtotal = data.subtotal;
  const tax = data.tax;
  const total = data.total;

  if (!isNullableString(merchantName)) return { ok: false, reason: "schema_error" };
  if (!isNullableString(ticketNumber)) return { ok: false, reason: "schema_error" };
  if (!isNullableString(currency)) return { ok: false, reason: "schema_error" };
  if (!isNullableNumber(subtotal)) return { ok: false, reason: "schema_error" };
  if (!isNullableNumber(tax)) return { ok: false, reason: "schema_error" };
  if (!isNullableNumber(total)) return { ok: false, reason: "schema_error" };

  const items = validateItems(data.items);
  if (!items) return { ok: false, reason: "schema_error" };

  return {
    ok: true,
    data: {
      merchant_name: merchantName,
      ticket_number: ticketNumber,
      currency,
      items,
      subtotal,
      tax,
      total,
    },
  };
}

function validateItems(value: unknown): TicketAnalysisItem[] | null {
  if (!Array.isArray(value)) return null;

  const items: TicketAnalysisItem[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) return null;
    const { name, quantity, unit_price, line_total } = raw;
    if (typeof name !== "string") return null;
    if (typeof quantity !== "number" || !Number.isFinite(quantity)) return null;
    if (typeof unit_price !== "number" || !Number.isFinite(unit_price)) return null;
    if (typeof line_total !== "number" || !Number.isFinite(line_total)) return null;
    items.push({ name, quantity, unit_price, line_total });
  }
  return items;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function toUnifiedResult(
  payload: AiTicketPayload,
  source: "ai",
): TicketAnalysisResult {
  return {
    merchant_name: payload.merchant_name,
    ticket_number: payload.ticket_number,
    currency: payload.currency ?? "EUR",
    items: payload.items,
    subtotal: payload.subtotal,
    tax: payload.tax,
    total: payload.total,
    detected_at: new Date().toISOString(),
    confidence: 0.9,
    source,
  };
}

/**
 * Regex/OCR fallback parser: reuses the existing rule-based `parseReceipt`
 * by re-deriving pseudo OCR words from `rawText` when real words (with
 * bounding boxes) aren't available, otherwise reuses the real ones.
 */
export function parseWithRegex(
  rawText: string,
  words?: OcrWord[],
): TicketAnalysisResult {
  const parsed = parseReceipt(words ?? textToPseudoWords(rawText));

  const items: TicketAnalysisItem[] = parsed.items.map((item) => ({
    name: item.name,
    quantity: item.quantity,
    unit_price: item.unitPriceCents / 100,
    line_total: item.totalCents / 100,
  }));

  const taxCents = parsed.summary
    .filter((s) => s.kind === "tax")
    .reduce((sum, s) => sum + s.amountCents, 0);

  return {
    merchant_name: null,
    ticket_number: null,
    currency: "EUR",
    items,
    subtotal: parsed.itemsSubtotalCents / 100,
    tax: parsed.taxIncludedInItems ? 0 : taxCents / 100,
    total: parsed.detectedTotalCents !== null ? parsed.detectedTotalCents / 100 : null,
    detected_at: new Date().toISOString(),
    confidence: parsed.mismatch ? 0.4 : 0.7,
    source: "fallback_ocr",
  };
}

/** Builds fake OCR words (one per whitespace-separated token) so plain text can go through `parseReceipt`. */
function textToPseudoWords(rawText: string): OcrWord[] {
  const words: OcrWord[] = [];
  const lines = rawText.split(/\r?\n/);

  lines.forEach((line, lineIndex) => {
    const y0 = lineIndex * 30;
    const y1 = y0 + 20;
    line
      .split(/\s+/)
      .filter(Boolean)
      .forEach((text, tokenIndex) => {
        words.push({
          text,
          confidence: 90,
          bbox: { x0: tokenIndex * 60, y0, x1: tokenIndex * 60 + 50, y1 },
        });
      });
  });

  return words;
}

function logFallback(
  reason: FallbackReason,
  context?: Record<string, unknown>,
): void {
  logger.warn("ticket_analysis_fallback", { reason, ...context });
}
