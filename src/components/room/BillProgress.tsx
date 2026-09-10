"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Receipt, Share2 } from "lucide-react";
import { formatCents } from "@/lib/money";
import { backdropVariants, sheetVariants } from "@/lib/motion";
import type { Messages } from "@/i18n";

export type RoomTab = "remaining" | "shared" | "mine";

interface BillProgressProps {
  readonly assignedCents: number;
  readonly totalCents: number;
  readonly assignedItems: number;
  readonly totalItems: number;
  readonly onOpenTableBill: () => void;
  readonly onToggleShare: () => void;
  readonly onOpenAccounts?: () => void;
  readonly profile?: ReactNode;
  readonly messages: Messages["roomSplit"];
}

export function BillProgress({
  assignedCents,
  totalCents,
  assignedItems,
  totalItems,
  onOpenTableBill,
  onToggleShare,
  onOpenAccounts,
  profile,
  messages,
}: BillProgressProps) {
  const router = useRouter();
  const [confirmHomeOpen, setConfirmHomeOpen] = useState(false);
  const percent =
    totalCents > 0
      ? Math.min(100, Math.round((assignedCents / totalCents) * 100))
      : 0;

  return (
    <div className="flex w-full flex-col gap-3 pt-3">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setConfirmHomeOpen(true)}
          aria-label={messages.backHomeTitle}
        >
          <img src="/logo.svg" alt="reasypt" className="h-9 w-auto" />
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onToggleShare}
            aria-label={messages.shareTitle}
            title={messages.shareTitle}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-primary text-primary hover:bg-primary/10"
          >
            <Share2 aria-hidden="true" size={16} />
          </button>
          {profile}
          {onOpenAccounts && (
            <button
              type="button"
              onClick={onOpenAccounts}
              aria-label={messages.viewAccounts}
              title={messages.viewAccounts}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-primary text-primary hover:bg-primary/10"
            >
              <Receipt aria-hidden="true" size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="relative">
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-2 w-full overflow-hidden rounded-full bg-primary/20"
        >
          <motion.div
            className="h-full rounded-full bg-primary"
            initial={{ width: "0%" }}
            animate={{ width: `${percent}%` }}
            transition={{ type: "spring", stiffness: 300, damping: 32 }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tabular-nums">
            {messages.assignedOfTotal
              .replace("{{assigned}}", formatCents(assignedCents))
              .replace("{{total}}", formatCents(totalCents))}
          </p>
          <p className="truncate text-xs tabular-nums text-muted-foreground">
            {messages.itemsProgress
              .replace("{{done}}", String(assignedItems))
              .replace("{{count}}", String(totalItems))}
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenTableBill}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-primary px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
        >
          <Receipt aria-hidden="true" size={14} />
          {messages.viewTableBill}
        </button>
      </div>

      <AnimatePresence>
        {confirmHomeOpen && (
          <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
            <motion.button
              variants={backdropVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              type="button"
              aria-label={messages.close}
              onClick={() => setConfirmHomeOpen(false)}
              className="absolute inset-0 bg-ink/70"
            />
            <motion.div
              variants={sheetVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="relative flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-primary/40 bg-background p-5 shadow-2xl"
            >
              <p className="text-lg font-bold text-primary">
                {messages.backHomeTitle}
              </p>
              <p className="text-sm text-muted-foreground">
                {messages.backHomeDescription}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmHomeOpen(false)}
                  className="flex-1 rounded-full border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10"
                >
                  {messages.backHomeCancel}
                </button>
                <button
                  type="button"
                  onClick={() => router.push("/")}
                  className="flex-1 rounded-full border border-red-600 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-600/10"
                >
                  {messages.backHomeConfirm}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface RoomTabsProps {
  readonly tab: RoomTab;
  readonly onTabChange: (tab: RoomTab) => void;
  /** Bumps each time a product moves into that tab, to trigger a quick label animation. */
  readonly pulses?: Readonly<Record<RoomTab, number>>;
  readonly messages: Messages["roomSplit"];
}

export function RoomTabs({ tab, onTabChange, pulses, messages }: RoomTabsProps) {
  return (
    <div className="rounded-t-2xl border-x border-t border-primary/20 bg-surface p-1">
      <div
        role="tablist"
        className="grid grid-cols-3 gap-1 rounded-full bg-primary/10 p-1"
      >
        <Tab
          label={messages.tabRemaining}
          active={tab === "remaining"}
          tone="primary"
          pulseToken={pulses?.remaining}
          onClick={() => onTabChange("remaining")}
        />
        <Tab
          label={messages.tabShared}
          active={tab === "shared"}
          tone="gold"
          pulseToken={pulses?.shared}
          onClick={() => onTabChange("shared")}
        />
        <Tab
          label={messages.tabMine}
          active={tab === "mine"}
          tone="primary"
          pulseToken={pulses?.mine}
          onClick={() => onTabChange("mine")}
        />
      </div>
    </div>
  );
}

function Tab({
  label,
  active,
  tone,
  pulseToken,
  onClick,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly tone: "primary" | "gold";
  readonly pulseToken?: number;
  readonly onClick: () => void;
}) {
  const activeClass =
    tone === "gold" ? "text-ink" : "text-primary-foreground";
  const inactiveClass =
    tone === "gold"
      ? "text-gold-text hover:bg-gold-soft"
      : "text-primary hover:bg-primary/10";
  const indicatorClass = tone === "gold" ? "bg-gold" : "bg-primary";

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
        active ? activeClass : inactiveClass
      }`}
    >
      {active && (
        <motion.span
          layoutId="room-tab-indicator"
          transition={{ type: "spring", stiffness: 400, damping: 34 }}
          className={`absolute inset-0 rounded-full ${indicatorClass}`}
        />
      )}
      <AnimatePresence>
        {Boolean(pulseToken) && (
          <motion.span
            key={`flash-${pulseToken}`}
            aria-hidden="true"
            initial={{ opacity: 0.85, scale: 0.82 }}
            animate={{ opacity: 0, scale: 1.75 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.75, ease: "easeOut" }}
            className="pointer-events-none absolute inset-0 rounded-full bg-gold/45 ring-2 ring-gold"
          />
        )}
      </AnimatePresence>
      <motion.span
        key={pulseToken ?? 0}
        initial={pulseToken ? { scale: 1.35, y: -1 } : false}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 520, damping: 18 }}
        className="relative inline-block"
      >
        {label}
      </motion.span>
    </button>
  );
}
