import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { isValidRoomCode } from "@/lib/rooms/code";
import { saveClaimRows } from "@/lib/rooms/claims-write";
import { logger } from "@/lib/logger";
import {
  appendRoomEvent,
  broadcastRoomUpdate,
  findRoom,
  loadRoomState,
} from "@/lib/rooms/store";

export const runtime = "nodejs";

interface ClaimPayload {
  itemId?: unknown;
  ownerId?: unknown;
  groupKey?: unknown;
  participantIds?: unknown;
  units?: unknown;
  groupIds?: unknown;
  shared?: unknown;
  allParticipants?: unknown;
}

/**
 * Applies one group's choice on one line. The choice is stored once per member
 * of the group, all of them tagged with the same `groupKey`, so a person can
 * hold several groups on the same line. `units` of null removes the group.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  if (!isValidRoomCode(code)) {
    return NextResponse.json({ error: "Invalid room code" }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as ClaimPayload | null;
  const itemId = asUuid(body?.itemId);
  const ownerId = asUuid(body?.ownerId);
  const groupKey = asUuid(body?.groupKey);
  const participantIds = asUuidList(body?.participantIds);
  const groupIds = asUuidList(body?.groupIds) ?? [];
  const shared = body?.shared === true;
  const allParticipants = body?.allParticipants === true;
  const units =
    body?.units === null
      ? null
      : typeof body?.units === "number" && Number.isFinite(body.units)
        ? Math.max(0, body.units)
        : undefined;

  if (!itemId || !ownerId || !groupKey || !participantIds || units === undefined) {
    return NextResponse.json({ error: "Invalid claim" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const room = await findRoom(supabase, code);
  if (!room) {
    logger.warn("claim_room_not_found", { code });
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  // Se lee antes de escribir para poder distinguir, luego, si alguien entró o
  // salió de un grupo ya existente en vez de reportarlo como un cambio genérico.
  const { data: previousMemberRows } = await supabase
    .from("claims")
    .select("participant_id")
    .eq("room_id", room.id)
    .eq("item_id", itemId)
    .eq("group_key", groupKey);
  const previousMemberIds = new Set(
    (previousMemberRows ?? []).map((row) => row.participant_id as string),
  );

  try {
    await saveClaimRows(supabase, {
      roomId: room.id,
      itemId,
      ownerId,
      groupKey,
      participantIds,
      units,
      groupIds,
      shared,
      allParticipants,
    });
  } catch (error) {
    logger.error("claim_save_failed", {
      code,
      itemId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }

  const { data: itemRow } = await supabase
    .from("items")
    .select("name")
    .eq("id", itemId)
    .maybeSingle<{ name: string | null }>();

  const addedMembers = participantIds.filter(
    (id) => !previousMemberIds.has(id),
  );
  const removedMembers = [...previousMemberIds].filter(
    (id) => !participantIds.includes(id),
  );

  let kind: "group_changed" | "group_removed" | "member_joined" | "member_left";
  let actorId: string | null;
  if (units === null) {
    kind = "group_removed";
    actorId = ownerId;
  } else if (
    previousMemberIds.size > 0 &&
    addedMembers.length === 1 &&
    removedMembers.length === 0
  ) {
    kind = "member_joined";
    actorId = addedMembers[0];
  } else if (
    previousMemberIds.size > 0 &&
    removedMembers.length === 1 &&
    addedMembers.length === 0
  ) {
    kind = "member_left";
    actorId = removedMembers[0];
  } else {
    kind = "group_changed";
    actorId = ownerId;
  }

  await appendRoomEvent(supabase, {
    roomId: room.id,
    kind,
    actorId,
    itemName: (itemRow?.name ?? "").trim(),
    units,
    peopleCount: units === null ? null : participantIds.length,
  });

  logger.info("claim_updated", { code, itemId, kind, units });
  await broadcastRoomUpdate(supabase, code);
  return NextResponse.json(await loadRoomState(supabase, room));
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asUuid(value: unknown): string | null {
  return typeof value === "string" && UUID_RE.test(value) ? value : null;
}

function asUuidList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids: string[] = [];
  for (const entry of value) {
    const id = asUuid(entry);
    if (!id) return null;
    ids.push(id);
  }
  return ids;
}
