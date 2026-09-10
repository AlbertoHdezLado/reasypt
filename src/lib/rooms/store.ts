import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ROOM_UPDATED_EVENT,
  roomChannelName,
} from "@/lib/supabase/channels";
import { EMPTY_EXTRAS } from "@/lib/receipt/editable";
import { logger } from "@/lib/logger";
import { normalizeRoomCode } from "./code";
import type { RoomEvent, RoomState } from "./types";

interface RoomRow {
  id: string;
  code: string;
  tax_cents: number;
  tip_cents: number;
  service_cents: number;
  discount_cents: number;
  detected_total_cents: number | null;
  merchant_name?: string | null;
  receipt_header?: string[] | null;
  receipt_image_url?: string | null;
}

interface ClaimRow {
  item_id: string;
  participant_id: string;
  owner_id: string;
  units: number | string;
  group_ids: string[] | null;
  group_key?: string | null;
  shared?: boolean | null;
  all_participants?: boolean | null;
}

interface RoomEventRow {
  id: string;
  kind: RoomEvent["kind"];
  actor_id: string | null;
  item_name: string;
  units: number | string | null;
  people_count: number | null;
  created_at: string;
}

function isMissingColumnError(error: { code?: string; message?: string } | null) {
  return (
    // 42703: Postgres undefined_column. PGRST204: PostgREST's schema cache
    // hasn't picked up the column yet (e.g. right after a migration).
    (error?.code === "42703" || error?.code === "PGRST204") &&
    /(merchant_name|receipt_header|receipt_image_url|group_key|shared|all_participants)/.test(
      error.message ?? "",
    )
  );
}

function isMissingEventsSchemaError(
  error: { code?: string; message?: string } | null,
): boolean {
  return (
    (error?.code === "42P01" ||
      error?.code === "42703" ||
      error?.code === "PGRST204") &&
    /room_events|kind|actor_id|item_name|units|people_count|created_at/.test(
      error.message ?? "",
    )
  );
}

export async function findRoom(
  supabase: SupabaseClient,
  code: string,
): Promise<RoomRow | null> {
  const normalizedCode = normalizeRoomCode(code);

  const selectRoom = (includeHeader: boolean) =>
    supabase
      .from("rooms")
      .select(
        includeHeader
          ? "id, code, tax_cents, tip_cents, service_cents, discount_cents, detected_total_cents, merchant_name, receipt_header, receipt_image_url"
          : "id, code, tax_cents, tip_cents, service_cents, discount_cents, detected_total_cents",
      )
      .eq("code", normalizedCode)
      .maybeSingle<RoomRow>();

  const { data, error } = await selectRoom(true);
  if (!error) return data ?? null;

  if (isMissingColumnError(error)) {
    const fallback = await selectRoom(false);
    if (fallback.error) throw new Error(fallback.error.message);
    if (!fallback.data) return null;
    return {
      ...fallback.data,
      merchant_name: fallback.data?.merchant_name ?? "",
      receipt_header: [],
      receipt_image_url: null,
    };
  }

  throw new Error(error.message);
}

export async function loadRoomState(
  supabase: SupabaseClient,
  room: RoomRow,
): Promise<RoomState> {
  const selectClaims = (includeGroupKey: boolean) =>
    supabase
      .from("claims")
      .select(
        includeGroupKey
          ? "item_id, participant_id, owner_id, units, group_ids, group_key, shared, all_participants"
          : "item_id, participant_id, owner_id, units, group_ids",
      )
      .eq("room_id", room.id) as unknown as PromiseLike<{
      data: ClaimRow[] | null;
      error: { code?: string; message?: string } | null;
    }>;

  const selectEvents = () =>
    supabase
      .from("room_events")
      .select("id, kind, actor_id, item_name, units, people_count, created_at")
      .eq("room_id", room.id)
      .order("created_at", { ascending: false })
      .limit(100) as unknown as PromiseLike<{
      data: RoomEventRow[] | null;
      error: { code?: string; message?: string } | null;
    }>;

  const [participants, items, claimsWithKey, eventsResult] = await Promise.all([
    supabase
      .from("participants")
      .select("id, name, is_owner")
      .eq("room_id", room.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("items")
      .select("id, name, quantity, unit_price_cents, edited")
      .eq("room_id", room.id)
      .order("position", { ascending: true }),
    selectClaims(true),
    selectEvents(),
  ]);

  const claims = isMissingColumnError(claimsWithKey.error)
    ? await selectClaims(false)
    : claimsWithKey;

  const events = isMissingEventsSchemaError(eventsResult.error)
    ? { data: [] as RoomEventRow[], error: null }
    : eventsResult;

  const failure = participants.error ?? items.error ?? claims.error ?? events.error;
  if (failure) throw new Error(failure.message);

  return {
    code: room.code,
    receiptImageUrl: room.receipt_image_url ?? null,
    participants: (participants.data ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      isOwner: row.is_owner as boolean,
    })),
    items: (items.data ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      quantity: Number(row.quantity),
      unitPriceCents: row.unit_price_cents as number,
      state: (row.edited as boolean) ? "editado" : "leido",
    })),
    extras: {
      ...EMPTY_EXTRAS,
      merchantName:
        (typeof room.merchant_name === "string" ? room.merchant_name : "") ||
        (Array.isArray(room.receipt_header) && room.receipt_header.length > 0
          ? room.receipt_header[0]
          : ""),
      receiptHeader: Array.isArray(room.receipt_header)
        ? room.receipt_header
        : [],
      taxCents: room.tax_cents,
      tipCents: room.tip_cents,
      serviceCents: room.service_cents,
      discountCents: room.discount_cents,
      detectedTotalCents: room.detected_total_cents,
    },
    claims: (claims.data ?? []).map((row) => ({
      itemId: row.item_id,
      participantId: row.participant_id,
      ownerId: row.owner_id,
      groupKey: row.group_key ?? row.owner_id,
      shared: row.shared ?? (row.group_ids ?? []).length > 1,
      allParticipants: row.all_participants ?? false,
      units: Number(row.units),
      groupIds: row.group_ids ?? [],
    })),
    events: (events.data ?? []).map((event) => ({
      id: event.id,
      kind: event.kind,
      actorId: event.actor_id,
      itemName: event.item_name,
      units:
        event.units === null || event.units === undefined
          ? null
          : Number(event.units),
      peopleCount: event.people_count,
      at: Date.parse(event.created_at),
    })),
  };
}

interface AppendRoomEventInput {
  readonly roomId: string;
  readonly kind: RoomEvent["kind"];
  readonly actorId: string | null;
  readonly itemName: string;
  readonly units: number | null;
  readonly peopleCount: number | null;
}

export async function appendRoomEvent(
  supabase: SupabaseClient,
  event: AppendRoomEventInput,
): Promise<void> {
  const { error } = await supabase.from("room_events").insert({
    room_id: event.roomId,
    kind: event.kind,
    actor_id: event.actorId,
    item_name: event.itemName,
    units: event.units,
    people_count: event.peopleCount,
  });

  if (!error || isMissingEventsSchemaError(error)) return;
  logger.warn("room_event_persist_failed", { error: error.message, kind: event.kind });
}

/**
 * Tells everyone in the room that something changed. Clients only listen; the
 * payload is deliberately empty so a stale listener can never inject state.
 */
export async function broadcastRoomUpdate(
  supabase: SupabaseClient,
  code: string,
): Promise<void> {
  const channel = supabase.channel(roomChannelName(code));
  try {
    await channel.httpSend(ROOM_UPDATED_EVENT, {});
  } catch (error) {
    logger.warn("room_broadcast_failed", {
      code,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await supabase.removeChannel(channel);
  }
}
