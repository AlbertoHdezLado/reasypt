"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { ReceiptScanner } from "@/components/capture/ReceiptScanner";
import { ReceiptEditor } from "@/components/ReceiptEditor";
import { SplitRoom } from "@/components/room/SplitRoom";
import { IdentityPicker } from "@/components/room/IdentityPicker";
import { LoadingState } from "@/components/Spinner";
import { ShareRoom } from "@/components/room/ShareRoom";
import {
  addParticipant,
  fetchRoom,
  renameParticipant,
  saveBill,
  saveClaim,
  uploadReceiptImage,
} from "@/lib/rooms/api";
import {
  takePendingCapture,
  takePendingReceiptImage,
} from "@/lib/rooms/pending-capture";
import { rememberRoom } from "@/lib/rooms/recent-rooms";
import { toLocalClaims } from "@/lib/rooms/claims";
import type { RoomState } from "@/lib/rooms/types";
import {
  getRealtimeClient,
  ROOM_UPDATED_EVENT,
  roomChannelName,
} from "@/lib/supabase/realtime";
import {
  EMPTY_EXTRAS,
  type EditableExtras,
  type EditableItem,
} from "@/lib/receipt/editable";
import type { Messages } from "@/i18n";
import { MAX_PARTICIPANT_NAME_LENGTH } from "@/lib/input-limits";

interface RoomFlowProps {
  readonly code: string;
  readonly messages: Messages;
}

/** Remembers, per room, which participant this device is. */
function identityStorageKey(code: string): string {
  return `reasypt.identity.${code}`;
}

export function RoomFlow({ code, messages }: RoomFlowProps) {
  const t = messages.room;
  const router = useRouter();

  const [room, setRoom] = useState<RoomState | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [savingBill, setSavingBill] = useState(false);
  const [draft, setDraft] = useState<{
    items: EditableItem[];
    extras: EditableExtras;
  } | null>(null);
  const [showShare, setShowShare] = useState(false);
  const pendingName = useRef<string | null>(null);
  const hasAutoSavedDraft = useRef(false);
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const bulkAddOfferedRef = useRef(false);

  // The receipt is scanned before the room exists; only the parsed bill crosses
  // the navigation boundary.
  useEffect(() => {
    const pending = takePendingCapture();
    const pendingImage = takePendingReceiptImage();
    if (pendingImage) {
      void uploadReceiptImage(code, pendingImage)
        .then(setRoom)
        .catch(() => setActionError(t.saveError));
    }
    if (!pending) return;

    if (pending === "manual") {
      setDraft({ items: [], extras: EMPTY_EXTRAS });
      return;
    }

    setDraft({ items: pending.items, extras: pending.extras });
  }, [code]);

  const reload = useCallback(async () => {
    try {
      const next = await fetchRoom(code);
      setRoom(next);
      rememberRoom(next.code, next.extras.merchantName);
      setError(null);
    } catch {
      setError(t.notFound);
    } finally {
      setLoading(false);
    }
  }, [code, t.notFound]);

  const handleActionError = useCallback(() => {
    pendingName.current = null;
    setActionError(t.saveError);
    void reload();
  }, [reload, t.saveError]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial desde el servidor
    void reload();
  }, [reload]);

  useEffect(() => {
    const stored = window.localStorage.getItem(identityStorageKey(code));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lectura puntual al montar
    if (stored) setSelfId(stored);
  }, [code]);

  // Auto-save scanned receipts once the room is loaded
  useEffect(() => {
    if (!draft || !room || hasAutoSavedDraft.current) return;
    if (draft.items.filter((item) => item.name.trim()).length === 0) return;

    hasAutoSavedDraft.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- guarda el ticket escaneado en cuanto existe la sala
    setSavingBill(true);
    void saveBill(code, draft.items, draft.extras)
      .then((next) => {
        setDraft(null);
        setRoom(next);
      })
      .catch(() => {
        hasAutoSavedDraft.current = false;
        setActionError("Error al guardar");
      })
      .finally(() => setSavingBill(false));
  }, [draft, room, code]);

  // A newly added participant only gets an id back through the room state, so
  // the name we just submitted is matched against the refreshed list.
  useEffect(() => {
    if (!room || !pendingName.current) return;
    const match = room.participants.find(
      (participant) => participant.name === pendingName.current,
    );
    if (!match) return;
    pendingName.current = null;
    window.localStorage.setItem(identityStorageKey(code), match.id);
    setSelfId(match.id);
    setJoining(false);
    // Solo al creador de la sala se le ofrece rellenar de golpe al resto.
    if (match.isOwner && !bulkAddOfferedRef.current) {
      bulkAddOfferedRef.current = true;
      setShowBulkAdd(true);
    }
  }, [room, code]);

  useEffect(() => {
    const client = getRealtimeClient();
    if (!client) return;

    const channel = client
      .channel(roomChannelName(code))
      .on("broadcast", { event: ROOM_UPDATED_EVENT }, () => {
        void reload();
      })
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [code, reload]);

  useEffect(() => {
    // El realtime a veces no se reengancha al volver de segundo plano
    // (pantalla apagada, pestaña suspendida); forzamos una recarga al volver.
    const handleBackToForeground = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", handleBackToForeground);
    window.addEventListener("focus", handleBackToForeground);
    window.addEventListener("pageshow", handleBackToForeground);
    return () => {
      document.removeEventListener("visibilitychange", handleBackToForeground);
      window.removeEventListener("focus", handleBackToForeground);
      window.removeEventListener("pageshow", handleBackToForeground);
    };
  }, [reload]);

  if (loading) {
    return <LoadingState label={t.loading} />;
  }

  if (error || !room) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <p className="text-sm text-gold-text">{error ?? t.notFound}</p>
        <button
          type="button"
          onClick={() => router.push("/")}
          className="rounded-2xl border border-red-600 px-5 py-3 text-sm font-medium text-red-600 transition-colors hover:bg-red-600/10"
        >
          {t.backHome}
        </button>
      </div>
    );
  }

  const self = room.participants.find(
    (participant) => participant.id === selfId,
  );

  if (!self) {
    const selectExisting = (participantId: string) => {
      window.localStorage.setItem(identityStorageKey(code), participantId);
      setSelfId(participantId);
    };

    const submitName = (rawName: string) => {
      const trimmed = rawName.trim().slice(0, MAX_PARTICIPANT_NAME_LENGTH);
      if (trimmed === "") return;
      pendingName.current = trimmed;
      setActionError(null);
      setJoining(true);
      void addParticipant(code, trimmed)
        .then((next) => {
          setRoom(next);
          setActionError(null);
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : "";
          setActionError(
            message === "Participant name already exists"
              ? t.duplicateName
              : t.saveError,
          );
          pendingName.current = null;
          setJoining(false);
        });
    };

    // El spinner sigue hasta que la identidad se resuelve y se pinta la sala.
    if (joining) {
      return <LoadingState label={t.joiningRoom} />;
    }

    return (
      <div className="flex flex-1 flex-col justify-center gap-5">
        <IdentityPicker
          participants={room.participants.map((participant) => ({
            key: participant.id,
            name: participant.name,
          }))}
          onSelect={selectExisting}
          onAdd={submitName}
          messages={messages.roomSplit}
        />

        {actionError && (
          <p role="alert" className="text-center text-sm text-gold-text">
            {actionError}
          </p>
        )}
      </div>
    );
  }

  // Al creador de la sala se le ofrece, justo tras darse de alta, meter de
  // golpe los nombres de los demás para ahorrar tiempo.
  if (self.isOwner && showBulkAdd) {
    const addNames = async (names: readonly string[]) => {
      let currentRoom = room;
      for (const rawName of names) {
        const trimmed = rawName.trim().slice(0, MAX_PARTICIPANT_NAME_LENGTH);
        if (trimmed === "") continue;
        const exists = currentRoom.participants.some(
          (participant) =>
            participant.name.trim().toUpperCase() === trimmed.toUpperCase(),
        );
        if (exists) continue;
        try {
          currentRoom = await addParticipant(code, trimmed);
        } catch {
          // Un nombre repetido u otro fallo puntual no debe frenar al resto.
        }
      }
      setRoom(currentRoom);
    };

    return (
      <BulkAddNames
        onContinue={(names) => {
          setShowBulkAdd(false);
          return addNames(names);
        }}
        addingLabel={t.addingParticipants}
        messages={t}
      />
    );
  }

  // The bill has to exist before anyone can claim anything, and only the
  // person who opened the room can scan or type it in.
  if (room.items.length === 0) {
    if (savingBill) {
      return <LoadingState label={t.savingBill} />;
    }

    if (!self.isOwner) {
      return (
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <p className="text-sm text-muted-foreground">{t.waitingForBill}</p>
          <ShareRoom code={room.code} messages={t} />
        </div>
      );
    }

    if (!draft) {
      return (
        <div className="flex flex-col gap-6">
          <ShareRoom code={room.code} messages={t} />
          {actionError && (
            <p role="alert" className="text-center text-sm text-gold-text">
              {actionError}
            </p>
          )}
          <ReceiptScanner
            messages={messages.capture}
            onScanned={(items, extras) => setDraft({ items, extras })}
            onImageCaptured={(dataUrl) => {
              void uploadReceiptImage(code, dataUrl)
                .then(setRoom)
                .catch(() => setActionError(t.saveError));
            }}
          />
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-4">
        <ReceiptEditor
          items={draft.items}
          extras={draft.extras}
          onItemsChange={(items) => setDraft({ ...draft, items })}
          onExtrasChange={(extras) => setDraft({ ...draft, extras })}
          messages={messages.receiptEditor}
          itemRowMessages={messages.itemRow}
        />
        <button
          type="button"
          disabled={draft.items.filter((item) => item.name.trim()).length === 0}
          onClick={() => {
            setSavingBill(true);
            void saveBill(code, draft.items, draft.extras)
              .then((next) => {
                setDraft(null);
                setRoom(next);
              })
              .catch(handleActionError)
              .finally(() => setSavingBill(false));
          }}
          className="rounded-full bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
        >
          {messages.capture.continue}
        </button>
      </div>
    );
  }

  const participants = room.participants.map((participant) => ({
    key: participant.id,
    name: participant.name,
  }));
  const claims = toLocalClaims(room.claims);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {showShare && (
        <dialog
          open
          className="fixed inset-0 z-[70] m-0 h-full w-full bg-transparent p-0"
          aria-label={t.shareTitle}
          onCancel={(event) => {
            event.preventDefault();
            setShowShare(false);
          }}
        >
          <div className="relative flex min-h-full items-center justify-center p-4">
            <button
              type="button"
              aria-label={messages.capture.closeLabel}
              onClick={() => setShowShare(false)}
              className="absolute inset-0 h-full w-full bg-ink/70"
            />
            <div className="relative z-10 w-full max-w-sm rounded-3xl border border-border bg-surface p-5 shadow-2xl">
            <button
              type="button"
              aria-label={messages.capture.closeLabel}
              onClick={() => setShowShare(false)}
              className="absolute top-3 right-3 inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-transparent text-primary hover:border-primary"
            >
              <X aria-hidden="true" size={18} />
            </button>
            <ShareRoom code={room.code} messages={t} />
            </div>
          </div>
        </dialog>
      )}

      <SplitRoom
        items={room.items}
        extras={room.extras}
        participants={participants}
        claims={claims}
        events={room.events ?? []}
        selfKey={self.id}
        roomCode={room.code}
        onToggleShare={() => setShowShare((prev) => !prev)}
        isOwner={self.isOwner}
        receiptImageUrl={room.receiptImageUrl}
        onRenameSelf={(name) =>
          renameParticipant(code, self.id, name).then((next) => {
            setRoom(next);
          })
        }
        onSwitchIdentity={(participantKey) => {
          window.localStorage.setItem(identityStorageKey(code), participantKey);
          setSelfId(participantKey);
        }}
        onAddParticipant={(name) =>
          addParticipant(code, name).then((next) => {
            setRoom(next);
          })
        }
        onSaveBill={(items, extras) => {
          setActionError(null);
          setRoom({ ...room, items: [...items], extras });
          void saveBill(code, items, extras)
            .then((next) => {
              setRoom(next);
              setActionError(null);
            })
            .catch(handleActionError);
        }}
        onSaveGroup={(
          itemId,
          groupId,
          ownerId,
          memberIds,
          units,
          shared,
          allParticipants,
        ) => {
          setActionError(null);
          // Aplica el cambio localmente al instante; el servidor confirma o revierte después.
          const remainingClaims = room.claims.filter(
            (claim) => !(claim.itemId === itemId && claim.groupKey === groupId),
          );
          const optimisticClaims =
            units === null || memberIds.length === 0
              ? remainingClaims
              : [
                  ...remainingClaims,
                  ...memberIds.map((participantId) => ({
                    itemId,
                    participantId,
                    ownerId,
                    groupKey: groupId,
                    shared,
                    allParticipants,
                    units,
                    groupIds: memberIds,
                  })),
                ];
          setRoom({ ...room, claims: optimisticClaims });
          void saveClaim(code, {
            itemId,
            ownerId,
            groupKey: groupId,
            participantIds: memberIds,
            units,
            groupIds: memberIds,
            shared,
            allParticipants,
          })
            .then((next) => {
              setRoom(next);
              setActionError(null);
            })
            .catch(handleActionError);
        }}
        messages={messages}
      />
      {actionError && <p className="text-center text-sm text-gold-text">{actionError}</p>}
    </div>
  );
}

function BulkAddNames({
  onContinue,
  addingLabel,
  messages,
}: {
  readonly onContinue: (names: readonly string[]) => Promise<void>;
  readonly addingLabel: string;
  readonly messages: Messages["room"];
}) {
  const [names, setNames] = useState([""]);
  const [adding, setAdding] = useState(false);
  const nameInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const updateName = (index: number, value: string) => {
    setNames((current) =>
      current.map((name, currentIndex) =>
        currentIndex === index
          ? value.toUpperCase().slice(0, MAX_PARTICIPANT_NAME_LENGTH)
          : name,
      ),
    );
  };

  function continueWithNames() {
    setAdding(true);
    void onContinue(
      names.map((line) => line.trim()).filter((line) => line !== ""),
    );
  }

  if (adding) {
    return <LoadingState label={addingLabel} />;
  }

  return (
    <div className="flex flex-1 flex-col justify-center gap-5">
      <div className="flex flex-col gap-1 text-center">
        <p className="text-xl font-bold text-primary">{messages.bulkAddTitle}</p>
        <p className="text-sm text-muted-foreground">{messages.bulkAddHint}</p>
      </div>
      <div className="flex flex-col gap-2">
        {names.map((name, index) => (
          <div key={index} className="flex gap-2">
            <input
              ref={(element) => {
                nameInputRefs.current[index] = element;
              }}
              autoFocus={index === 0}
              value={name}
              maxLength={MAX_PARTICIPANT_NAME_LENGTH}
              onChange={(event) => updateName(index, event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                if (index === names.length - 1) {
                  setNames((current) => [...current, ""]);
                  requestAnimationFrame(() => {
                    nameInputRefs.current[index + 1]?.focus();
                  });
                } else {
                  nameInputRefs.current[index + 1]?.focus();
                }
              }}
              placeholder={messages.bulkAddNamePlaceholder.replace(
                "{{index}}",
                String(index + 1),
              )}
              className="min-w-0 flex-1 rounded-xl border-2 border-primary/40 bg-surface px-4 py-3 text-sm font-medium uppercase tracking-wide placeholder:font-normal placeholder:normal-case placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
            {names.length > 1 && (
              <button
                type="button"
                onClick={() =>
                  setNames((current) =>
                    current.filter((_, currentIndex) => currentIndex !== index),
                  )
                }
                aria-label={messages.bulkAddRemove}
                className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground hover:border-primary hover:text-primary"
              >
                <X aria-hidden="true" size={18} />
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() => setNames((current) => [...current, ""])}
          className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-primary/50 px-4 py-3 text-sm font-medium text-primary hover:bg-primary/10"
        >
          <Plus aria-hidden="true" size={18} />
          {messages.bulkAddAnother}
        </button>
      </div>
      <button
        type="button"
        onClick={continueWithNames}
        className="rounded-full bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
      >
        {messages.bulkAddContinue}
      </button>
    </div>
  );
}
