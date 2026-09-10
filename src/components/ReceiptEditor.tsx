"use client";

import { Pencil, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ItemRow } from "@/components/ItemRow";
import { formatCents, useMoneyField } from "@/lib/money";
import {
  editorGrandTotalCents,
  editorSubtotalCents,
  newItemId,
  type EditableExtras,
  type EditableItem,
} from "@/lib/receipt/editable";
import { defaultMessages, type Messages } from "@/i18n";

interface ReceiptEditorProps {
  readonly items: EditableItem[];
  readonly extras: EditableExtras;
  readonly onItemsChange: (items: EditableItem[]) => void;
  readonly onExtrasChange: (extras: EditableExtras) => void;
  readonly messages?: Messages["receiptEditor"];
  readonly itemRowMessages?: Messages["itemRow"];
}

export function ReceiptEditor({
  items,
  extras,
  onItemsChange,
  onExtrasChange,
  messages = defaultMessages.receiptEditor,
  itemRowMessages = defaultMessages.itemRow,
}: ReceiptEditorProps) {
  const subtotalCents = editorSubtotalCents(items);
  const grandTotalCents = editorGrandTotalCents(items, extras);
  const mismatchDeltaCents =
    extras.detectedTotalCents === null
      ? null
      : extras.detectedTotalCents - grandTotalCents;
  const hasMismatch =
    mismatchDeltaCents !== null && Math.abs(mismatchDeltaCents) > 2;
  const [isTotalWarningOpen, setIsTotalWarningOpen] = useState(
    extras.detectedTotalCents === null || hasMismatch,
  );
  const totalRowRef = useRef<HTMLDivElement>(null);
  const totalWarningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  function triggerTotalWarning() {
    setIsTotalWarningOpen(true);
    totalRowRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    if (totalWarningTimeoutRef.current)
      clearTimeout(totalWarningTimeoutRef.current);
    totalWarningTimeoutRef.current = setTimeout(
      () => setIsTotalWarningOpen(false),
      5000,
    );
  }

  function closeTotalWarning() {
    if (totalWarningTimeoutRef.current)
      clearTimeout(totalWarningTimeoutRef.current);
    setIsTotalWarningOpen(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- dispara el toast inicial calculado desde las props
    if (isTotalWarningOpen) triggerTotalWarning();
    return () => {
      if (totalWarningTimeoutRef.current)
        clearTimeout(totalWarningTimeoutRef.current);
    };
    // Solo se dispara al montar, según el estado inicial calculado arriba.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [editingItemId, setEditingItemId] = useState<string | null>(null);

  function updateItem(index: number, next: EditableItem) {
    onItemsChange(items.map((item, i) => (i === index ? next : item)));
  }

  function removeItem(index: number) {
    onItemsChange(items.filter((_, i) => i !== index));
  }

  function addItem() {
    const newItem = {
      id: newItemId(),
      name: "",
      quantity: 0,
      unitPriceCents: 0,
      state: "editado" as const,
    };
    onItemsChange([...items, newItem]);
    setEditingItemId(newItem.id);
  }

  // El nombre no se propaga hasta salir del campo o cerrar la edición del
  // ticket, para no reescribir la sala en cada pulsación.
  const extrasRef = useRef(extras);
  const onExtrasChangeRef = useRef(onExtrasChange);
  useEffect(() => {
    extrasRef.current = extras;
    onExtrasChangeRef.current = onExtrasChange;
  });
  const [merchantDraft, setMerchantDraft] = useState(
    extras.merchantName || extras.receiptHeader[0] || "",
  );
  const [merchantFocused, setMerchantFocused] = useState(false);
  const merchantDraftRef = useRef(merchantDraft);
  useEffect(() => {
    merchantDraftRef.current = merchantDraft;
  });
  useEffect(() => {
    if (!merchantFocused)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- ver useMoneyField
      setMerchantDraft(extras.merchantName || extras.receiptHeader[0] || "");
  }, [extras.merchantName, extras.receiptHeader, merchantFocused]);

  function commitMerchantName(name: string) {
    const merchantName = name.trim();
    const currentExtras = extrasRef.current;
    const remainingHeader = currentExtras.receiptHeader.slice(1);
    onExtrasChangeRef.current({
      ...currentExtras,
      merchantName,
      receiptHeader:
        merchantName || remainingHeader.length > 0
          ? [merchantName, ...remainingHeader].filter(Boolean)
          : [],
    });
  }

  useEffect(() => {
    // Vuelca cualquier cambio pendiente si el editor del ticket se cierra
    // (el input se desmonta al ocultar el modal).
    return () => commitMerchantName(merchantDraftRef.current);
  }, []);

  return (
    <div className="flex flex-col gap-1 text-base">
      <div className="ticket-paper mx-auto w-full max-w-lg px-5 pb-7 pt-6 shadow-lg">
        <div className="pb-4 text-center font-mono text-sm uppercase">
          <input
            type="text"
            value={merchantDraft}
            onFocus={() => setMerchantFocused(true)}
            onChange={(event) => setMerchantDraft(event.target.value)}
            onBlur={() => {
              setMerchantFocused(false);
              commitMerchantName(merchantDraft);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
            placeholder={messages.merchantNamePlaceholder}
            className="w-full border-b border-dashed border-primary/35 bg-transparent px-1 py-2 text-center font-mono text-xl font-bold uppercase outline-none placeholder:font-sans placeholder:text-base placeholder:font-normal placeholder:normal-case placeholder:text-muted-foreground/70 focus:border-primary"
          />
          {extras.receiptHeader.slice(1).map((line, index) => (
            <p key={`${line}-${index}`} className="mt-1 leading-5">
              {line}
            </p>
          ))}
        </div>
        <div className="flex flex-col gap-0 border-b border-dashed border-primary/35">
        {items.map((item, index) => (
          <ItemRow
            key={item.id}
            item={item}
            onChange={(next) => updateItem(index, next)}
            onRemove={() => removeItem(index)}
            forceOpen={editingItemId === item.id}
            onOpenChange={(open) => setEditingItemId(open ? item.id : null)}
            messages={itemRowMessages}
          />
        ))}
        <button
          type="button"
          onClick={addItem}
          className="mt-2 flex items-center justify-center gap-1 rounded border border-dashed border-primary/50 py-2 text-sm font-medium text-primary hover:border-primary hover:bg-primary/10"
        >
          + {messages.addProduct}
        </button>
      </div>

      <div className="flex flex-col gap-1 border-b border-dashed border-primary/35 pb-3 pt-4 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">
            {messages.subtotalProducts}
          </span>
          <span className="flex items-center gap-1.5 tabular-nums">
            {hasMismatch && (
              <button
                type="button"
                onClick={triggerTotalWarning}
                aria-label={messages.openMismatchWarning}
                className="rounded text-gold-text hover:text-gold-hover"
              >
                <TriangleAlert aria-hidden="true" size={18} />
              </button>
            )}
            {formatCents(subtotalCents)}
          </span>
        </div>
        <div
          ref={totalRowRef}
          className="flex items-center justify-between border-t-2 border-primary/50 px-1 py-4 text-lg font-bold"
        >
          <span>Total</span>
          <TotalField
            cents={extras.detectedTotalCents ?? grandTotalCents}
            onChange={(cents) =>
              onExtrasChange({ ...extras, detectedTotalCents: cents })
            }
            editLabel={messages.editTotal}
            saveLabel={messages.saveTotal}
          />
        </div>

      </div>
      </div>

      {isTotalWarningOpen && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-4 top-4 z-50 mx-auto flex max-w-sm items-start gap-3 rounded-xl border border-border bg-background p-4 shadow-xl sm:inset-x-auto sm:right-4"
        >
          <TriangleAlert
            aria-hidden="true"
            size={18}
            className={`mt-0.5 shrink-0 ${
              hasMismatch ? "text-gold-text" : "text-primary"
            }`}
          />
          <div className="min-w-0 flex-1">
            <p
              className={`text-sm font-bold ${
                hasMismatch ? "text-gold-text" : "text-primary"
              }`}
            >
              {hasMismatch ? messages.mismatchTitle : messages.missingTotalTitle}
            </p>
            <p
              className={`mt-1 text-xs ${
                hasMismatch ? "text-gold-text" : "text-muted-foreground"
              }`}
            >
              {hasMismatch
                ? messages.mismatch
                    .replace("{{total}}", formatCents(extras.detectedTotalCents!))
                    .replace(
                      "{{delta}}",
                      formatCents(Math.abs(mismatchDeltaCents!)),
                    )
                : messages.missingTotal}
            </p>
          </div>
          <button
            type="button"
            onClick={closeTotalWarning}
            aria-label={messages.closeWarning}
            className="-mr-1 -mt-1 shrink-0 rounded p-1 text-muted-foreground hover:bg-primary/10 hover:text-primary"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>
      )}
    </div>
  );
}

function TotalField({
  cents,
  onChange,
  editLabel,
  saveLabel,
}: {
  readonly cents: number;
  readonly onChange: (cents: number) => void;
  readonly editLabel: string;
  readonly saveLabel: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  // El total no se propaga hasta salir del campo o pulsar guardar, para que
  // el resto de la app (reparto, barra inferior) no "baile" en cada dígito.
  const [pendingCents, setPendingCents] = useState(cents);
  const field = useMoneyField(pendingCents, setPendingCents);

  function commit() {
    onChange(pendingCents);
    setIsEditing(false);
  }

  if (!isEditing) {
    return (
      <span className="flex items-center gap-2 font-mono text-xl tabular-nums">
        {formatCents(cents)}
        <button
          type="button"
          onClick={() => {
            setPendingCents(cents);
            setIsEditing(true);
          }}
          aria-label={editLabel}
          title={editLabel}
          className="flex h-8 w-8 items-center justify-center rounded border border-primary/30 text-primary hover:bg-primary/10"
        >
          <Pencil aria-hidden="true" size={13} />
        </button>
      </span>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <input
        type="text"
        inputMode="decimal"
        {...field}
        onBlur={() => {
          field.onBlur();
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        autoFocus
        className="w-24 rounded border border-border bg-transparent px-2 py-1 text-right text-lg tabular-nums"
      />
      <button
        type="button"
        onClick={commit}
        aria-label={saveLabel}
        className="rounded border border-primary px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10"
      >
        {saveLabel}
      </button>
    </span>
  );
}

