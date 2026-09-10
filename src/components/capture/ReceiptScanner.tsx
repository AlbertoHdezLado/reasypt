"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { ImageUp, PencilLine } from "lucide-react";
import { scanReceipt, LowQualityScanError } from "@/lib/ocr/scan";
import {
  EMPTY_EXTRAS,
  type EditableExtras,
  type EditableItem,
} from "@/lib/receipt/editable";
import { fileToPreviewDataUrl, UnsupportedImageFormatError } from "@/lib/receipt/image";
import { ScanOverlay } from "@/components/capture/ScanOverlay";
import type { Messages } from "@/i18n";

interface ReceiptScannerProps {
  readonly onScanned: (items: EditableItem[], extras: EditableExtras) => void;
  /** Fires with a compressed copy of the captured photo, kept only on this device. */
  readonly onImageCaptured?: (dataUrl: string) => void;
  readonly messages: Messages["capture"];
}

// Simulated progress that always keeps moving, independent of the real OCR
// timing: fast at first, then slower as it approaches the cap, so it never
// looks stuck while waiting on the server/Gemini.
const FAKE_PROGRESS_CAP = 95;
const FAKE_PROGRESS_INTERVAL_MS = 300;
const FAKE_PROGRESS_STEP_RATIO = 0.05;
const MESSAGE_INTERVAL_MS = 3000;

export function ReceiptScanner({
  onScanned,
  onImageCaptured,
  messages,
}: ReceiptScannerProps) {
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);
  const [scanError, setScanError] = useState<string | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    return () => {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
      if (messageTimerRef.current) clearInterval(messageTimerRef.current);
    };
  }, []);

  function stopFakeProgress() {
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    if (messageTimerRef.current) clearInterval(messageTimerRef.current);
    progressTimerRef.current = null;
    messageTimerRef.current = null;
  }

  function startFakeProgress() {
    stopFakeProgress();
    setProgress(0);
    setMessageIndex(0);
    progressTimerRef.current = setInterval(() => {
      setProgress((p) => p + (FAKE_PROGRESS_CAP - p) * FAKE_PROGRESS_STEP_RATIO);
    }, FAKE_PROGRESS_INTERVAL_MS);
    messageTimerRef.current = setInterval(() => {
      setMessageIndex((i) => {
        const next = i + 1;
        // Stop advancing once past the last step; the overlay then shows the final message.
        if (next >= messages.scanningSteps.length) {
          if (messageTimerRef.current) clearInterval(messageTimerRef.current);
          messageTimerRef.current = null;
        }
        return Math.min(next, messages.scanningSteps.length);
      });
    }, MESSAGE_INTERVAL_MS);
  }

  function handleFileSelected(file: File) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    setScanError(null);
    if (onImageCaptured) {
      void fileToPreviewDataUrl(file).then(onImageCaptured).catch(() => {});
    }
    void scan(file);
  }

  async function scan(file: File) {
    setScanning(true);
    startFakeProgress();
    try {
      const outcome = await scanReceipt(file, () => {});
      stopFakeProgress();
      setProgress(100);
      // Brief pause so the 100% fill is visible before the overlay closes.
      await new Promise((resolve) => setTimeout(resolve, 300));
      setScanning(false);
      onScanned(outcome.items, outcome.extras);
    } catch (err) {
      stopFakeProgress();
      setScanning(false);
      if (err instanceof LowQualityScanError) {
        setScanError(messages.lowQualityScanError);
      } else if (err instanceof UnsupportedImageFormatError) {
        setScanError(messages.unsupportedImageFormatError);
      } else {
        setScanError(messages.readReceiptError);
      }
    }
  }


  return (
    <div className="flex flex-col gap-3">
      {/* Sin `capture`, para que el selector abra la galería en vez de la cámara */}
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) handleFileSelected(file);
        }}
      />
      <button
        type="button"
        onClick={() => galleryInputRef.current?.click()}
        aria-label={messages.uploadReceiptLabel}
        className="flex w-full items-center gap-4 rounded-3xl bg-primary px-6 py-7 text-left text-primary-foreground shadow-lg transition-transform active:scale-[0.98]"
      >
        <ImageUp aria-hidden="true" size={28} className="shrink-0" />
        <span className="text-lg font-semibold tracking-tight">
          {messages.uploadReceipt}
        </span>
      </button>

      <div className="grid grid-cols-1 gap-3">
        <button
          type="button"
          onClick={() => onScanned([], EMPTY_EXTRAS)}
          className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-surface px-4 py-3 text-sm font-medium shadow-sm transition-colors hover:border-primary"
        >
          <PencilLine aria-hidden="true" size={18} />
          {messages.manualEntry}
        </button>
      </div>

      {scanError && (
        <p role="alert" className="text-center text-sm text-gold-text">
          {scanError}
        </p>
      )}

      <AnimatePresence>
        {scanning && (
          <ScanOverlay
            key="scan-overlay"
            progress={progress}
            messageIndex={messageIndex}
            previewUrl={previewUrl}
            messages={messages}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
