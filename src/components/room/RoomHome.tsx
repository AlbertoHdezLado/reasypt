"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, ImageUp, PencilLine } from "lucide-react";
import { ScanOverlay } from "@/components/capture/ScanOverlay";
import { LoadingState } from "@/components/Spinner";
import { CodeInput } from "@/components/room/CodeInput";
import { createRoom } from "@/lib/rooms/api";
import { scanReceipt, type ScanOutcome } from "@/lib/ocr/scan";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/rooms/code";
import {
  setPendingCapture,
  setPendingReceiptImage,
  type PendingCapture,
} from "@/lib/rooms/pending-capture";
import { fileToPreviewDataUrl } from "@/lib/receipt/image";
import { getRecentRooms, type RecentRoom } from "@/lib/rooms/recent-rooms";
import { fadeInUpVariants, listStagger } from "@/lib/motion";
import type { Messages } from "@/i18n";

interface RoomHomeProps {
  readonly messages: Messages["room"];
  readonly captureMessages: Messages["capture"];
}

export function RoomHome({ messages, captureMessages }: RoomHomeProps) {
  const router = useRouter();
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shakeSignal, setShakeSignal] = useState(0);
  const [merchantName, setMerchantName] = useState("");
  const [createMode, setCreateMode] = useState<"manual" | "tesseract" | null>(
    null,
  );
  const [pendingCaptureForName, setPendingCaptureForName] =
    useState<PendingCapture | null>(null);
  const [recentRooms, setRecentRooms] = useState<readonly RecentRoom[]>([]);
  const [scan, setScan] = useState<{
    progress: number;
    messageIndex: number;
    previewUrl: string | null;
  } | null>(null);
  const busy = busyLabel !== null || scan !== null;
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lectura puntual al montar
    setRecentRooms(getRecentRooms());
  }, []);

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

  function start(capture: PendingCapture, establishment = merchantName) {
    setBusyLabel(messages.creatingRoom);
    setError(null);
    createRoom(establishment)
      .then((created) => {
        setPendingCapture(capture);
        router.push(`/room/${created}`);
      })
      .catch(() => {
        setError(messages.createError);
        setBusyLabel(null);
      });
  }

  function scanAndStart(file: File) {
    setError(null);
    setScan({ progress: 0, messageIndex: 0, previewUrl: null });
    stopFakeProgress();
    // Simulated progress that always keeps moving, independent of the real
    // OCR timing, so it never looks stuck while waiting on the server/Gemini.
    progressTimerRef.current = setInterval(() => {
      setScan((current) =>
        current === null
          ? current
          : { ...current, progress: current.progress + (95 - current.progress) * 0.05 },
      );
    }, 300);
    messageTimerRef.current = setInterval(() => {
      setScan((current) =>
        current === null
          ? current
          : {
              ...current,
              messageIndex:
                (current.messageIndex + 1) % captureMessages.scanningSteps.length,
            },
      );
    }, 4000);
    const receiptImageReady = fileToPreviewDataUrl(file)
      .then((previewUrl) => {
        setPendingReceiptImage(previewUrl);
        setScan((current) =>
          current === null ? current : { ...current, previewUrl },
        );
      })
      .catch(() => {});
    void scanReceipt(file, () => {})
      .then(async (outcome: ScanOutcome) => {
        stopFakeProgress();
        setScan((current) =>
          current === null ? current : { ...current, progress: 100 },
        );
        if (outcome.providerId === "tesseract") {
          setPendingCaptureForName(outcome);
          setCreateMode("tesseract");
          return;
        }
        await receiptImageReady;
        start(outcome);
      })
      .catch(() => {
        setError(messages.createError);
        setBusyLabel(null);
      })
      .finally(() => {
        stopFakeProgress();
        setScan(null);
      });
  }

  function confirmCreation() {
    if (createMode === "manual") start("manual");
    else if (pendingCaptureForName) start(pendingCaptureForName);
    setCreateMode(null);
    setPendingCaptureForName(null);
  }

  // Mientras se crea o se entra en una sala el menú desaparece por completo.
  if (busyLabel !== null && scan === null) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-8">
        <LoadingState label={busyLabel} />
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8 px-5 py-8 sm:py-12">
      {/* Sin `capture`, para que el selector abra la galería en vez de la cámara */}
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) scanAndStart(file);
        }}
      />
      <motion.div
        variants={listStagger}
        initial="hidden"
        animate="visible"
        className="flex flex-col gap-8"
      >
        <motion.header
          variants={fadeInUpVariants}
          className="flex flex-col items-center gap-3 text-center"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="reasypt" className="h-12 w-auto" />
        </motion.header>

        <motion.section
          variants={fadeInUpVariants}
          className="flex flex-col gap-3"
        >
          <button
            type="button"
            disabled={busy}
            onClick={() => galleryInputRef.current?.click()}
            aria-label={captureMessages.uploadReceiptLabel}
            className="group relative flex w-full items-center gap-4 overflow-hidden rounded-xl bg-primary px-5 py-7 text-left text-primary-foreground shadow-[0_12px_24px_-18px_var(--primary)] ring-1 ring-inset ring-primary-foreground/15 transition-[background-color,box-shadow,transform] duration-200 hover:bg-primary-hover hover:shadow-[0_16px_28px_-18px_var(--primary)] active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60 disabled:shadow-none"
          >
            <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary-foreground/15">
              <ImageUp aria-hidden="true" size={24} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-lg font-semibold">
                {captureMessages.uploadReceipt}
              </span>
            </span>
            <ArrowRight
              aria-hidden="true"
              size={20}
              className="ml-auto shrink-0 opacity-70 transition-transform duration-200 group-hover:translate-x-1"
            />
          </button>

          <div className="grid grid-cols-1 gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => setCreateMode("manual")}
              className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface px-5 py-3 text-left transition-[border-color,background-color,transform] duration-200 hover:border-primary/65 hover:bg-primary/5 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <PencilLine aria-hidden="true" size={18} className="opacity-70" />
              </span>
              <span className="text-base font-medium text-muted-foreground">
                {captureMessages.manualEntry}
              </span>
            </button>
          </div>
        </motion.section>

        <motion.section
          variants={fadeInUpVariants}
          className="flex flex-col gap-3 border-t border-border pt-6"
        >
          <p className="text-center text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {messages.joinHint}
          </p>
          <CodeInput
            disabled={busy}
            digitLabel={messages.codeDigitLabel}
            shakeSignal={shakeSignal}
            onComplete={(code) => {
              if (!isValidRoomCode(code)) {
                setError(messages.invalidCode);
                setShakeSignal((prev) => prev + 1);
                return;
              }
              setError(null);
              setBusyLabel(messages.joiningRoom);
              router.push(`/room/${normalizeRoomCode(code)}`);
            }}
          />

          {recentRooms.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {messages.recentRoomsTitle}
              </p>
              <ul className="flex flex-col gap-2">
                {recentRooms.map((room) => (
                  <li
                    key={room.code}
                    className="rounded-xl border border-border bg-surface transition-colors hover:border-primary/50"
                  >
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setBusyLabel(messages.joiningRoom);
                        router.push(`/room/${room.code}`);
                      }}
                      className="flex w-full min-w-0 items-center justify-between gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary disabled:opacity-60"
                    >
                      <span className="min-w-0 truncate text-sm font-medium uppercase">
                        {room.merchantName || room.code}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {new Date(room.visitedAt).toLocaleDateString()}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <AnimatePresence>
            {error && (
              <motion.p
                key="room-home-error"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                role="alert"
                className="text-center text-sm text-gold-text"
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>
        </motion.section>

        <motion.section
          variants={fadeInUpVariants}
          className="flex flex-col gap-4 border-t border-border pt-6"
        >
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {messages.howTitle}
          </h2>
          <ol className="flex flex-col gap-4">
            {messages.steps.map((step, index) => (
              <li key={step.title} className="flex items-start gap-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {index + 1}
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold">{step.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {step.detail}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </motion.section>
      </motion.div>

      <AnimatePresence>
        {createMode && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.button
              initial={{ y: 4 }}
              animate={{ y: 0 }}
              exit={{ y: 4 }}
              type="button"
              aria-label={captureMessages.closeLabel}
              onClick={() => setCreateMode(null)}
              className="absolute inset-0 bg-ink/70"
            />
            <motion.div
              initial={{ y: 16, scale: 0.98 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: 16, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 420, damping: 34 }}
              className="relative flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-primary/40 bg-background p-5 shadow-2xl"
            >
              <label className="flex flex-col gap-2 text-sm font-semibold text-primary">
                {messages.establishmentName}
                <input
                  autoFocus
                  value={merchantName}
                  maxLength={120}
                  placeholder={messages.establishmentPlaceholder}
                  onChange={(event) => setMerchantName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      confirmCreation();
                    }
                  }}
                  className="rounded-xl border border-primary/30 bg-surface px-3 py-3 font-normal text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </label>
              <button
                type="button"
                onClick={confirmCreation}
                className="rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
              >
                {captureMessages.continue}
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {scan && (
          <ScanOverlay
            key="scan-overlay"
            progress={scan.progress}
            messageIndex={scan.messageIndex}
            previewUrl={scan.previewUrl}
            messages={captureMessages}
          />
        )}
      </AnimatePresence>
    </main>
  );
}
