"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  assignedUnits,
  buildSplitClaims,
  claimedUnits,
  claimedUnitsBySharing,
  itemGroups,
  type LocalClaims,
} from "@/lib/local-claims";
import {
  editorSubtotalCents,
  type EditableExtras,
  type EditableItem,
} from "@/lib/receipt/editable";
import { computeSplit } from "@/lib/split";
import { backdropVariants, sheetVariants } from "@/lib/motion";
import { AssignedBar } from "./AssignedBar";
import { BillProgress, RoomTabs, type RoomTab } from "./BillProgress";
import { ItemActionSheet } from "./ItemActionSheet";
import { NotificationBell, type RoomNotification } from "./NotificationBell";
import { PersonTotals } from "@/components/PersonTotals";
import { ProfileButton } from "./ProfileButton";
import { formatUnits, ProductCard } from "./ProductCard";
import { ReceiptEditor } from "@/components/ReceiptEditor";
import type { Messages } from "@/i18n";
import type { RoomEvent } from "@/lib/rooms/types";
import {
  getReadEventIds,
  hasReviewedTicket,
  markEventsRead,
  markTicketReviewed,
} from "@/lib/rooms/review-state";

interface Participant {
  readonly key: string;
  readonly name: string;
}

interface StoredRoomView {
  readonly tab: RoomTab;
  readonly tableBillOpen: boolean;
}

interface SplitRoomProps {
  readonly items: readonly EditableItem[];
  readonly extras: EditableExtras;
  readonly participants: readonly Participant[];
  readonly claims: LocalClaims;
  readonly events?: readonly RoomEvent[];
  readonly selfKey: string;
  /** Persists the whole ticket (items + extras) at once, e.g. when the ticket editor is closed. */
  readonly onSaveBill: (
    items: readonly EditableItem[],
    extras: EditableExtras,
  ) => void;
  /** Creates, updates (`units`) or drops (`units === null`) one group of a line. */
  readonly onSaveGroup: (
    itemId: string,
    groupId: string,
    ownerId: string,
    memberIds: readonly string[],
    units: number | null,
    shared: boolean,
    allParticipants: boolean,
  ) => void;
  readonly roomCode: string;
  readonly onToggleShare: () => void;
  /** The first person to open the room; the full receipt is shown to them automatically. */
  readonly isOwner?: boolean;
  /** Data URL of the scanned receipt photo, if this device captured it. */
  readonly receiptImageUrl?: string | null;
  readonly onRenameSelf?: (name: string) => Promise<void>;
  /** Lets this device switch to acting as a different participant. */
  readonly onSwitchIdentity?: (participantKey: string) => void;
  /** Adds a brand new participant to the room without leaving the current identity. */
  readonly onAddParticipant?: (name: string) => Promise<void>;
  readonly messages: Messages;
}

function toRoomNotification(
  event: RoomEvent,
  participants: readonly Participant[],
  messages: Messages["roomSplit"],
): RoomNotification {
  const actor =
    participants.find((participant) => participant.key === event.actorId)?.name ??
    event.actorId ??
    "?";
  const itemName = event.itemName || messages.unnamedItem;

  const text =
    event.kind === "group_removed"
      ? messages.groupRemovedBy
          .replace("{{actor}}", actor)
          .replace("{{item}}", itemName)
      : event.kind === "member_joined"
        ? messages.groupMemberJoined
            .replace("{{member}}", actor)
            .replace("{{item}}", itemName)
        : event.kind === "member_left"
          ? messages.groupMemberLeft
              .replace("{{member}}", actor)
              .replace("{{item}}", itemName)
          : messages.groupChangedBy
              .replace("{{actor}}", actor)
              .replace("{{item}}", itemName)
              .replace("{{units}}", formatUnits(event.units ?? 0))
              .replace("{{people}}", String(event.peopleCount ?? 0));

  return {
    id: event.id,
    text,
    at: event.at,
    read: false,
    // Un cambio con más de una persona implicada es un aviso "compartido";
    // el resto son movimientos privados (para ti).
    scope: (event.peopleCount ?? 0) > 1 ? "shared" : "personal",
  };
}

function roomViewStorageKey(roomCode: string, selfKey: string): string {
  return `reasypt.roomView.${roomCode}.${selfKey}`;
}

function readStoredRoomView(key: string): StoredRoomView | null {
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(key) ?? "null") as Partial<StoredRoomView> | null;
    if (
      stored &&
      (stored.tab === "remaining" || stored.tab === "shared" || stored.tab === "mine") &&
      typeof stored.tableBillOpen === "boolean"
    ) {
      return { tab: stored.tab, tableBillOpen: stored.tableBillOpen };
    }
  } catch {
    // A stale or malformed browser value falls back to the default view.
  }
  return null;
}

export function SplitRoom({
  items,
  extras,
  participants,
  claims,
  events = [],
  selfKey,
  onSaveBill,
  onSaveGroup,
  roomCode,
  onToggleShare,
  isOwner,
  receiptImageUrl,
  onRenameSelf,
  onSwitchIdentity,
  onAddParticipant,
  messages,
}: SplitRoomProps) {
  const t = messages.roomSplit;
  const [tab, setTab] = useState<RoomTab>("remaining");
  const [restoredViewKey, setRestoredViewKey] = useState<string | null>(null);
  // Sweep-in animation should only play once, on the initial mount, not on every tab switch.
  const [hasPlayedEntryAnimation, setHasPlayedEntryAnimation] = useState(false);
  const [sheet, setSheet] = useState<{
    itemIds: readonly string[];
    groupId?: string;
  } | null>(null);
  const [tabPulses, setTabPulses] = useState<Record<RoomTab, number>>({
    remaining: 0,
    shared: 0,
    mine: 0,
  });
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [tableBillOpen, setTableBillOpen] = useState(false);
  const [finalOpen, setFinalOpen] = useState(false);
  // Buffers edits made in the ticket editor locally; only persisted to the
  // backend once the editor is closed, instead of on every keystroke.
  const [ticketDraft, setTicketDraft] = useState<{
    items: EditableItem[];
    extras: EditableExtras;
  } | null>(null);
  const [originalImageOpen, setOriginalImageOpen] = useState(false);
  const [notifications, setNotifications] = useState<
    readonly RoomNotification[]
  >([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const viewStorageKey = roomViewStorageKey(roomCode, selfKey);

  useEffect(() => {
    const storedView = readStoredRoomView(viewStorageKey);
    if (storedView) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restores the last view after the browser APIs are available
      setTab(storedView.tab);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restores the last view after the browser APIs are available
      setTableBillOpen(storedView.tableBillOpen);
    }
    setRestoredViewKey(viewStorageKey);
  }, [viewStorageKey]);

  useEffect(() => {
    if (restoredViewKey !== viewStorageKey) return;
    window.sessionStorage.setItem(
      viewStorageKey,
      JSON.stringify({ tab, tableBillOpen }),
    );
  }, [restoredViewKey, tableBillOpen, tab, viewStorageKey]);

  const openTicketEditor = () => {
    setTicketDraft({ items: items.map((item) => ({ ...item })), extras: { ...extras } });
    setTableBillOpen(true);
  };

  const closeTicketEditor = () => {
    if (ticketDraft) onSaveBill(ticketDraft.items, ticketDraft.extras);
    setTicketDraft(null);
    setTableBillOpen(false);
  };

  useEffect(() => {
    // Muestra el ticket completo nada más entrar, solo a quien lo subió, y
    // solo la primera vez: una vez revisado queda marcado para no reaparecer.
    if (isOwner && !hasReviewedTicket(roomCode, selfKey)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- apertura automática una única vez al montar
      setTicketDraft({
        items: items.map((item) => ({ ...item })),
        extras: { ...extras },
      });
      // eslint-disable-next-line react-hooks/set-state-in-effect -- apertura automática una única vez al montar
      setTableBillOpen(true);
      markTicketReviewed(roomCode, selfKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- marca hecha la animación una única vez al montar
    setHasPlayedEntryAnimation(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar
  }, []);

  const nameOf = (key: string) =>
    key === selfKey
      ? t.you.toUpperCase()
      : (participants.find((participant) => participant.key === key)?.name ?? key);

  const groupsByItem = useMemo(() => {
    const map = new Map<string, ReturnType<typeof itemGroups>>();
    for (const item of items) map.set(item.id, itemGroups(item, claims));
    return map;
  }, [items, claims]);

  const totalCents = editorSubtotalCents([...items]);
  const assignedCents = items.reduce(
    (sum, item) =>
      sum +
      Math.round(
        Math.min(assignedUnits(item, claims), item.quantity) *
          item.unitPriceCents,
      ),
    0,
  );
  const fullyAssignedCount = items.filter(
    (item) => assignedUnits(item, claims) >= item.quantity,
  ).length;
  const allAssigned = items.length > 0 && fullyAssignedCount === items.length;

  const split = computeSplit({
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
    })),
    claims: buildSplitClaims(
      [...items],
      participants.map((p) => p.key),
      claims,
    ),
    participants: participants.map((p) => ({ id: p.key, name: p.name })),
    extras: {
      taxCents: extras.taxCents,
      tipCents: extras.tipCents + extras.serviceCents,
      discountCents: extras.discountCents,
    },
    distributeUnclaimed: false,
  });

  // Misma cuenta pero repartiendo lo no reclamado, para mostrar el total
  // global (incluida tu parte de lo que nadie ha marcado todavía).
  const splitWithUnclaimed = computeSplit({
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
    })),
    claims: buildSplitClaims(
      [...items],
      participants.map((p) => p.key),
      claims,
    ),
    participants: participants.map((p) => ({ id: p.key, name: p.name })),
    extras: {
      taxCents: extras.taxCents,
      tipCents: extras.tipCents + extras.serviceCents,
      discountCents: extras.discountCents,
    },
    distributeUnclaimed: true,
  });

  useEffect(() => {
    // Keeps read/unread flags for already seen events while reflecting
    // persisted history from the server. Tus propias acciones no generan
    // aviso: solo interesan los cambios que hacen los demás. El estado de
    // lectura de cada aviso se guarda por participante en este dispositivo,
    // para que no reaparezca como no leído en otra visita.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sincroniza avisos locales con historial remoto persistido
    setNotifications((previous) => {
      const previousById = new Map(previous.map((notice) => [notice.id, notice]));
      const readIds = getReadEventIds(roomCode, selfKey);
      return events
        .filter((event) => event.actorId !== selfKey)
        .map((event) => {
          const next = toRoomNotification(event, participants, t);
          const alreadyRead =
            previousById.get(next.id)?.read ?? readIds.has(next.id);
          return { ...next, read: alreadyRead };
        });
    });
  }, [events, participants, selfKey, t, roomCode]);

  // Anima la etiqueta de la pestaña de destino cuando esta persona mueve un
  // producto: entra a "Compartido" o "Para mí" al reservarlo, y vuelve a
  // "Sin asignar" al salir de un grupo o soltarlo.
  const pulseTab = (target: RoomTab) => {
    setTabPulses((previous) => ({
      ...previous,
      [target]: previous[target] + 1,
    }));
  };

  const wasSelfInGroup = (itemId: string, groupId: string) => {
    const group = (groupsByItem.get(itemId) ?? []).find(
      (candidate) => candidate.groupId === groupId,
    );
    return group ? group.memberIds.includes(selfKey) : false;
  };

  const maybePulseForGroupChange = (
    itemId: string,
    groupId: string,
    memberIds: readonly string[],
    units: number | null,
    shared: boolean,
  ) => {
    const wasIn = wasSelfInGroup(itemId, groupId);
    const isIn = units !== null && units > 0 && memberIds.includes(selfKey);
    if (!wasIn && isIn) pulseTab(shared ? "shared" : "mine");
    else if (wasIn && !isIn) pulseTab("remaining");
  };

  const saveGroup = (
    itemId: string,
    groupId: string,
    ownerId: string,
    memberIds: readonly string[],
    units: number | null,
    shared: boolean,
    allParticipants: boolean,
  ) => {
    maybePulseForGroupChange(itemId, groupId, memberIds, units, shared);
    onSaveGroup(
      itemId,
      groupId,
      ownerId,
      memberIds,
      units,
      shared,
      allParticipants,
    );
    setSheet(null);
  };

  // Un mismo producto puede venir repetido en varias líneas del ticket; una
  // nueva reserva se reparte entre esas líneas en orden hasta cubrir las
  // unidades pedidas, generando un grupo distinto por cada línea que aporta.
  const distributeNewGroup = (
    targetItems: readonly EditableItem[],
    groupId: string,
    ownerId: string,
    memberIds: readonly string[],
    units: number | null,
    shared: boolean,
    allParticipants: boolean,
  ) => {
    let remaining = units ?? 0;
    let nextGroupId = groupId;
    let pulsed = false;
    for (const item of targetItems) {
      if (remaining <= 0) break;
      const capacity = Math.max(0, item.quantity - assignedUnits(item, claims));
      const take = Math.min(remaining, capacity);
      if (take <= 0) continue;
      if (!pulsed && memberIds.includes(selfKey) && take > 0) {
        pulseTab(shared ? "shared" : "mine");
        pulsed = true;
      }
      onSaveGroup(
        item.id,
        nextGroupId,
        ownerId,
        memberIds,
        take,
        shared,
        allParticipants,
      );
      nextGroupId = crypto.randomUUID();
      remaining -= take;
    }
    setSheet(null);
  };

  // Cada pestaña mira una parte distinta de la misma línea: lo que queda libre,
  // los grupos abiertos y los grupos privados de esta persona.
  const groupsForTab = (itemId: string) => {
    const groups = groupsByItem.get(itemId) ?? [];
    if (tab === "shared") return groups.filter((group) => group.shared);
    if (tab === "mine")
      return groups.filter(
        (group) => !group.shared && group.memberIds.includes(selfKey),
      );
    return groups;
  };

  const visibleItems = items.filter((item) => {
    if (tab === "remaining")
      return item.quantity - assignedUnits(item, claims) > 0;
    return groupsForTab(item.id).length > 0;
  });

  // Varias líneas del ticket pueden ser el mismo producto (mismo nombre y
  // precio); en "sin asignar" se muestran fusionadas en una sola tarjeta.
  const remainingGroups = useMemo(() => {
    const map = new Map<string, EditableItem[]>();
    for (const item of items) {
      if (item.quantity - assignedUnits(item, claims) <= 0) continue;
      const key = `${item.name.trim().toLowerCase()}|${item.unitPriceCents}`;
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    }
    return [...map.values()].map((group) => ({
      key: group.map((item) => item.id).join("+"),
      items: group,
      remainingUnits: group.reduce(
        (sum, item) => sum + Math.max(0, item.quantity - assignedUnits(item, claims)),
        0,
      ),
    }));
  }, [items, claims]);

  // Lo que nadie ha marcado todavía, para mostrarlo repartido entre todos en
  // el desplegable de "productos no asignados" del total.
  const unassignedBreakdown = remainingGroups.map((group) => {
    const first = group.items[0];
    const subtotalCents = Math.round(group.remainingUnits * first.unitPriceCents);
    return {
      key: group.key,
      name: first.name || t.unnamedItem,
      remainingUnits: group.remainingUnits,
      subtotalCents,
      perPersonCents: Math.round(
        subtotalCents / Math.max(participants.length, 1),
      ),
    };
  });
  const unassignedSubtotalCents = unassignedBreakdown.reduce(
    (sum, group) => sum + group.subtotalCents,
    0,
  );

  const emptyMessages: Record<RoomTab, string> = {
    remaining: items.length === 0 ? t.nothingRemaining : t.nothingLeft,
    shared: t.nothingShared,
    mine: t.nothingAssigned,
  };
  const emptyMessage = emptyMessages[tab];

  const sheetItems = sheet
    ? items.filter((item) => sheet.itemIds.includes(item.id))
    : [];
  const primarySheetItem = sheetItems[0] ?? null;
  const sheetRemainingUnits = sheetItems.reduce(
    (sum, item) => sum + Math.max(0, item.quantity - assignedUnits(item, claims)),
    0,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="sticky top-0 z-20 flex shrink-0 flex-col gap-3 bg-background pb-0 shadow-sm">
            <BillProgress
              assignedCents={assignedCents}
              totalCents={totalCents}
              assignedItems={fullyAssignedCount}
              totalItems={items.length}
              onOpenTableBill={openTicketEditor}
              onToggleShare={onToggleShare}
              profile={
                <ProfileButton
                  currentName={
                    participants.find((participant) => participant.key === selfKey)
                      ?.name ?? selfKey
                  }
                  onRename={onRenameSelf ?? (async () => {})}
                  participants={participants.map((p) => ({
                    key: p.key,
                    name: p.name,
                  }))}
                  selfKey={selfKey}
                  onSwitchIdentity={onSwitchIdentity}
                  onAddParticipant={onAddParticipant}
                  messages={t}
                />
              }
              notifications={
                <NotificationBell
                  notifications={notifications}
                  open={notificationsOpen}
                  onToggle={() => {
                    setNotificationsOpen((prev) => !prev);
                    setNotifications((prev) => {
                      markEventsRead(
                        roomCode,
                        selfKey,
                        prev.map((notification) => notification.id),
                      );
                      return prev.map((notification) => ({
                        ...notification,
                        read: true,
                      }));
                    });
                  }}
                  onClose={() => setNotificationsOpen(false)}
                  messages={t}
                />
              }
              messages={t}
            />
            <RoomTabs
              tab={tab}
              onTabChange={setTab}
              pulses={tabPulses}
              messages={t}
            />
          </div>
          <div className="grid min-h-0 flex-initial auto-rows-min items-start grid-cols-[repeat(auto-fill,minmax(220px,1fr))] content-start gap-2 overflow-y-auto rounded-b-2xl border-x border-b border-primary/20 bg-surface p-2">
            {tab === "remaining"
              ? remainingGroups.map(({ key, items: group, remainingUnits }, index) => {
                  const bySharing = group.reduce(
                    (sum, item) => {
                      const { forMe, shared } = claimedUnitsBySharing(
                        item,
                        claims,
                        selfKey,
                      );
                      return {
                        forMe: sum.forMe + forMe,
                        shared: sum.shared + shared,
                      };
                    },
                    { forMe: 0, shared: 0 },
                  );

                  return (
                    <ProductCard
                      key={key}
                      item={group[0]}
                      remainingUnits={remainingUnits}
                      myUnits={group.reduce(
                        (sum, item) => sum + claimedUnits(item, claims, selfKey),
                        0,
                      )}
                      forMeUnits={bySharing.forMe}
                      sharedUnits={bySharing.shared}
                      groups={[]}
                      showGroups={false}
                      entryDelay={hasPlayedEntryAnimation ? undefined : index * 0.05}
                      onSelect={() =>
                        setSheet({ itemIds: group.map((item) => item.id) })
                      }
                      messages={t}
                    />
                  );
                })
              : visibleItems.flatMap((item) => {
                  const groups = groupsForTab(item.id);

                  return groups.map((group) => (
                    <ProductCard
                      key={`${item.id}-${group.groupId}`}
                      item={item}
                      displayUnits={group.units}
                      remainingUnits={Math.max(
                        0,
                        item.quantity - assignedUnits(item, claims),
                      )}
                      myUnits={
                        group.memberIds.includes(selfKey)
                          ? group.units / group.memberIds.length
                          : 0
                      }
                      groups={
                        tab === "mine"
                          ? []
                          : [
                              {
                                groupId: group.groupId,
                                memberNames:
                                  group.memberIds.length === participants.length
                                    ? [t.everyoneLiteral]
                                    : group.memberIds.map(nameOf),
                                units: group.units,
                                includesSelf: group.memberIds.includes(selfKey),
                              },
                            ]
                      }
                      isMine={tab === "mine"}
                      includesSelf={
                        tab === "shared" && group.memberIds.includes(selfKey)
                      }
                      showGroups={true}
                      onSelect={() =>
                        setSheet({ itemIds: [item.id], groupId: group.groupId })
                      }
                      messages={t}
                    />
                  ));
                })}
            {(tab === "remaining" ? remainingGroups.length === 0 : visibleItems.length === 0) && (
              <p className="col-span-full py-6 text-center text-sm text-muted-foreground">
                {emptyMessage}
              </p>
            )}
          </div>
        </div>
        <div className="mt-auto flex flex-col gap-2">
          {allAssigned && (
            <button
              type="button"
              onClick={() => setFinalOpen(true)}
              className="rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
            >
              {t.finish}
            </button>
          )}
          <AssignedBar
            split={split}
            splitWithUnclaimed={splitWithUnclaimed}
            selfKey={selfKey}
            open={breakdownOpen}
            onToggle={() => setBreakdownOpen((prev) => !prev)}
            unassignedBreakdown={unassignedBreakdown}
            unassignedSubtotalCents={unassignedSubtotalCents}
            messages={t}
            totalsMessages={messages.totals}
          />
        </div>
      </div>

      <AnimatePresence>
        {primarySheetItem && (
          <ItemActionSheet
            key="item-action-sheet"
            tab={tab}
            item={primarySheetItem}
            selfKey={selfKey}
            groups={groupsForTab(primarySheetItem.id)}
            remainingUnits={sheetRemainingUnits}
            participantNames={Object.fromEntries(
              participants.map((participant) => [
                participant.key,
                participant.name,
              ]),
            )}
            initialGroupId={sheet?.groupId}
            onClose={() => setSheet(null)}
            onSaveGroup={(
              groupId,
              ownerId,
              memberIds,
              units,
              shared,
              allParticipants,
            ) =>
              tab === "remaining"
                ? distributeNewGroup(
                    sheetItems,
                    groupId,
                    ownerId,
                    memberIds,
                    units,
                    shared,
                    allParticipants,
                  )
                : saveGroup(
                    primarySheetItem.id,
                    groupId,
                    ownerId,
                    memberIds,
                    units,
                    shared,
                    allParticipants,
                  )
            }
            onJoinGroup={(
              groupId,
              ownerId,
              memberIds,
              units,
              shared,
              allParticipants,
            ) =>
              // A diferencia de una elección nueva, unirse actualiza un grupo
              // ya existente en su propia línea: no hay que repartirlo entre
              // varias líneas fusionadas.
              saveGroup(
                primarySheetItem.id,
                groupId,
                ownerId,
                memberIds,
                units,
                shared,
                allParticipants,
              )
            }
            messages={t}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {tableBillOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4">
            <motion.button
              variants={backdropVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              type="button"
              aria-label={t.close}
              onClick={closeTicketEditor}
              className="absolute inset-0 bg-ink/70"
            />
            <motion.div
              variants={sheetVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="relative flex h-full max-h-full w-full max-w-md flex-col overflow-hidden bg-background shadow-2xl sm:h-auto sm:max-h-[85vh] sm:rounded-2xl"
            >
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <ReceiptEditor
                  items={ticketDraft?.items ?? []}
                  extras={ticketDraft?.extras ?? extras}
                  onItemsChange={(nextItems) =>
                    setTicketDraft((prev) =>
                      prev ? { ...prev, items: nextItems } : prev,
                    )
                  }
                  onExtrasChange={(nextExtras) =>
                    setTicketDraft((prev) =>
                      prev ? { ...prev, extras: nextExtras } : prev,
                    )
                  }
                  messages={messages.receiptEditor}
                  itemRowMessages={messages.itemRow}
                />
              </div>
              <div className="flex shrink-0 gap-2 border-t border-primary/20 p-4">
                {receiptImageUrl && (
                  <button
                    type="button"
                    onClick={() => setOriginalImageOpen(true)}
                    className="flex-1 rounded-full border border-primary px-4 py-3 text-sm font-medium text-primary hover:bg-primary/10"
                  >
                    {t.viewOriginalTicket}
                  </button>
                )}
                <button
                  type="button"
                  onClick={closeTicketEditor}
                  className="flex-1 rounded-full bg-primary px-4 py-3 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
                >
                  {t.close}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {originalImageOpen && receiptImageUrl && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.button
              variants={backdropVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              type="button"
              aria-label={t.close}
              onClick={() => setOriginalImageOpen(false)}
              className="absolute inset-0 bg-ink/70"
            />
            <motion.div
              variants={sheetVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="relative flex max-h-[85vh] w-full max-w-md flex-col gap-3 overflow-hidden rounded-2xl border border-primary/40 bg-background p-3 shadow-2xl"
            >
              <div className="min-h-0 flex-1 overflow-y-auto">
                {/* eslint-disable-next-line @next/next/no-img-element -- data URL, not an optimizable remote image */}
                <img
                  src={receiptImageUrl}
                  alt={t.viewOriginalTicket}
                  className="w-full rounded-lg object-contain"
                />
              </div>
              <button
                type="button"
                onClick={() => setOriginalImageOpen(false)}
                className="shrink-0 rounded-full bg-primary px-4 py-3 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
              >
                {t.close}
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {finalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4">
            <motion.button
              variants={backdropVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              type="button"
              aria-label={t.close}
              onClick={() => setFinalOpen(false)}
              className="absolute inset-0 bg-ink/70"
            />
            <motion.div
              variants={sheetVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="relative flex h-full max-h-full w-full max-w-md flex-col overflow-hidden bg-background shadow-2xl sm:h-auto sm:max-h-[85vh] sm:rounded-2xl"
            >
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <h2 className="mb-3 text-lg font-bold text-primary">
                  {t.finalSummaryTitle}
                </h2>
                <div className="flex flex-col gap-3">
                  {split.people.map((person) => (
                    <PersonTotals
                      key={person.participantId}
                      person={person}
                      currency="EUR"
                      hasPaid={false}
                      isOwn={person.participantId === selfKey}
                      messages={messages.totals}
                    />
                  ))}
                </div>
              </div>
              <div className="shrink-0 border-t border-primary/20 p-4">
                <button
                  type="button"
                  onClick={() => setFinalOpen(false)}
                  className="w-full rounded-full bg-primary px-4 py-3 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
                >
                  {messages.capture.backToSplit}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

