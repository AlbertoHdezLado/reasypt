"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { ImageIcon } from "lucide-react";
import type { Messages } from "@/i18n";

interface ScanOverlayProps {
  /** 0-100, always advancing regardless of the real OCR progress. */
  readonly progress: number;
  readonly messageIndex: number;
  readonly previewUrl: string | null;
  readonly messages: Messages["capture"];
}

export function ScanOverlay({
  progress,
  messageIndex,
  previewUrl,
  messages,
}: ScanOverlayProps) {
  const [failedPreviewUrl, setFailedPreviewUrl] = useState<string | null>(null);

  const showPreview = previewUrl !== null && failedPreviewUrl !== previewUrl;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/85 p-4 backdrop-blur-sm"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.15 }}
        className="flex w-full max-w-xs flex-col items-center gap-4 rounded-3xl border border-border bg-background p-6 text-center shadow-2xl"
      >
        <div className="relative w-32 overflow-hidden rounded-2xl border border-primary/40 bg-surface">
          {showPreview ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={previewUrl}
              alt=""
              onError={() => setFailedPreviewUrl(previewUrl)}
              className="h-40 w-full object-cover opacity-80"
            />
          ) : (
            <div className="flex h-40 w-full items-center justify-center text-muted-foreground">
              <ImageIcon aria-hidden="true" size={40} strokeWidth={1.75} />
            </div>
          )}
          <div className="absolute inset-0">
            <div className="animate-receipt-scan absolute inset-x-0 h-0.5 bg-gold shadow-[0_0_12px_2px_var(--gold)]" />
          </div>
        </div>
        <p className="text-sm font-semibold tracking-tight">
          {messages.readingReceipt}
        </p>
        <p className="text-xs text-muted-foreground">
          {messages.scanningSteps[messageIndex] ?? messages.scanningSteps.at(-1)}
        </p>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-primary/20">
          <motion.div
            className="h-full rounded-full bg-primary"
            initial={{ width: 0 }}
            animate={{
              width: `${Math.round(progress)}%`,
            }}
            transition={{ duration: 0.3 }}
          />
        </div>
      </motion.div>
    </div>
  );
}
