"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { formatCents, useMoneyField } from "@/lib/money";
import { itemTotalCents, type EditableItem } from "@/lib/receipt/editable";
import { defaultMessages, type Messages } from "@/i18n";
import { MAX_PRODUCT_NAME_LENGTH } from "@/lib/input-limits";

interface ItemRowProps {
  readonly item: EditableItem;
  readonly onChange: (item: EditableItem) => void;
  readonly onRemove: () => void;
  readonly forceOpen?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly messages?: Messages["itemRow"];
}

export function ItemRow({
  item,
  onChange,
  onRemove,
  forceOpen = false,
  onOpenChange,
  messages = defaultMessages.itemRow,
}: ItemRowProps) {
  // When user edits, transition the item to "editado" state
  function edit(patch: Partial<EditableItem>) {
    onChange({
      ...item,
      ...patch,
      state: "editado",
    });
  }

  // Igual que los campos de dinero: se guarda el texto propio mientras el
  // input tiene el foco para poder borrarlo del todo, y si se deja vacío se
  // reaplica el valor 0 sin forzarlo a 1.
  const [quantityText, setQuantityText] = useState(String(item.quantity));
  const [quantityFocused, setQuantityFocused] = useState(false);
  const [isEditing, setIsEditing] = useState(forceOpen);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const quantityInputRef = useRef<HTMLInputElement>(null);
  const totalInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- this prop drives a modal open state for a newly created item
    setIsEditing(forceOpen);
  }, [forceOpen]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see useMoneyField for rationale
    if (!quantityFocused) setQuantityText(String(item.quantity));
  }, [item.quantity, quantityFocused]);
  const totalCents = itemTotalCents(item);
  const totalField = useMoneyField(totalCents, (totalCents) => {
    const unitPriceCents =
      item.quantity > 0 ? Math.round(totalCents / item.quantity) : totalCents;
    edit({ unitPriceCents });
  });

  function editQuantity(quantity: number) {
    const unitPriceCents =
      quantity > 0 ? Math.round(totalCents / quantity) : totalCents;
    edit({ quantity, unitPriceCents });
  }

  const isEmpty = item.name === "";

  const inputBorder = isEmpty
    ? "border-primary/30 text-muted-foreground focus:outline-primary/60"
    : "border-primary/45 focus:outline-primary/70";
  const moneyInputBorder = isEmpty
    ? "border-primary/30 text-muted-foreground focus-within:outline focus-within:outline-2 focus-within:outline-primary/60"
    : "border-primary/45 focus-within:outline focus-within:outline-2 focus-within:outline-primary/70";

  const nameInputBorder = isEmpty
    ? `${inputBorder} placeholder:text-muted-foreground/70`
    : `${inputBorder} placeholder:text-muted-foreground`;

  const closeEditor = () => {
    setIsEditing(false);
    onOpenChange?.(false);
  };

  const openEditor = () => {
    setIsEditing(true);
    onOpenChange?.(true);
  };

  const line = (
    <div className="flex items-center gap-3 py-3 text-base">
      <span className="w-10 shrink-0 text-center font-mono text-muted-foreground">
          {item.quantity}
        </span>
        <span className="min-w-0 flex-1 overflow-hidden font-mono font-semibold uppercase leading-snug [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]">
          {item.name || messages.descriptionPlaceholder}
        </span>
        <span className="shrink-0 font-mono text-lg font-semibold tabular-nums">
          {formatCents(itemTotalCents(item))}
        </span>
        <button
          type="button"
          onClick={openEditor}
          aria-label={`${messages.editLine} ${item.name || messages.descriptionPlaceholder}`}
          title={`${messages.editLine} ${item.name || messages.descriptionPlaceholder}`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-primary/30 text-primary hover:bg-primary/10"
        >
          <Pencil aria-hidden="true" size={14} />
        </button>
    </div>
  );

  if (!isEditing) {
    return line;
  }

  return (
    <>
      {line}
      <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
        <button
          type="button"
          aria-label={messages.removeLineLabel}
          onClick={closeEditor}
          className="absolute inset-0 bg-ink/70"
        />
        <div className="relative flex max-h-[90vh] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-t-2xl border border-primary/40 bg-background p-4 pb-6 shadow-2xl sm:rounded-2xl">
          <p className="text-center text-base font-bold text-primary">
            {item.name || messages.descriptionPlaceholder}
          </p>

          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Producto
              </span>
              <input
                ref={nameInputRef}
                type="text"
                value={item.name}
                maxLength={MAX_PRODUCT_NAME_LENGTH}
                onChange={(e) =>
                  edit({
                    name: e.target.value
                      .toUpperCase()
                      .slice(0, MAX_PRODUCT_NAME_LENGTH),
                  })
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    quantityInputRef.current?.focus();
                  }
                }}
                placeholder={messages.descriptionPlaceholder}
                className={`w-full rounded-xl border bg-transparent px-3 py-2 text-[13px] uppercase ${nameInputBorder}`}
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Uds.
                </span>
                <input
                  ref={quantityInputRef}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={quantityText}
                  onFocus={() => setQuantityFocused(true)}
                  onChange={(e) => {
                    const value = e.target.value;
                    setQuantityText(value);
                    const parsed = Number.parseInt(value, 10);
                    if (Number.isFinite(parsed) && parsed >= 0)
                      editQuantity(parsed);
                  }}
                  onBlur={() => {
                    setQuantityFocused(false);
                    const parsed = Number.parseInt(quantityText, 10);
                    const quantity =
                      Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
                    setQuantityText(String(quantity));
                    if (quantity !== item.quantity) editQuantity(quantity);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.blur();
                      totalInputRef.current?.focus();
                    }
                  }}
                  className={`w-full rounded-xl border bg-transparent px-2 py-2 text-[13px] ${inputBorder}`}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Total
                </span>
                <span className={`flex w-full items-center overflow-hidden rounded-xl border bg-transparent ${moneyInputBorder}`}>
                  <input
                    ref={totalInputRef}
                    type="text"
                    inputMode="decimal"
                    {...totalField}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        event.currentTarget.blur();
                        closeEditor();
                      }
                    }}
                    className="min-w-0 flex-1 bg-transparent px-2 py-2 text-right text-[13px] tabular-nums outline-none"
                  />
                  <span className="shrink-0 pr-2 text-[13px] tabular-nums text-muted-foreground">
                    €
                  </span>
                </span>
              </label>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onRemove}
                className="flex-1 rounded-full border border-red-600 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-600/10"
              >
                Eliminar
              </button>
              <button
                type="button"
                onClick={closeEditor}
                className="flex-1 rounded-full bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
              >
                {messages.saveLine}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
