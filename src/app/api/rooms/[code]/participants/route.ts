import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { isValidRoomCode } from "@/lib/rooms/code";
import { saveClaimRows } from "@/lib/rooms/claims-write";
import { broadcastRoomUpdate, findRoom, loadRoomState } from "@/lib/rooms/store";
import { MAX_PARTICIPANT_NAME_LENGTH } from "@/lib/input-limits";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

const MAX_PARTICIPANTS = 30;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  if (!isValidRoomCode(code)) {
    return NextResponse.json({ error: "Invalid room code" }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
  } | null;
  const name =
    typeof body?.name === "string"
      ? body.name.trim().slice(0, MAX_PARTICIPANT_NAME_LENGTH)
      : "";
  if (name === "") {
    return NextResponse.json({ error: "Missing name" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const room = await findRoom(supabase, code);
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const { data: existingParticipants, error: existingParticipantsError } =
    await supabase.from("participants").select("id, name").eq("room_id", room.id);
  if (existingParticipantsError) {
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }

  const normalizedName = name.trim().replace(/\s+/g, " ").toUpperCase();
  const hasDuplicateName = existingParticipants?.some(
    (participant) =>
      participant.name.trim().replace(/\s+/g, " ").toUpperCase() ===
      normalizedName,
  );
  if (hasDuplicateName) {
    return NextResponse.json(
      { error: "Participant name already exists" },
      { status: 409 },
    );
  }

  const { count, error: countError } = await supabase
    .from("participants")
    .select("id", { count: "exact", head: true })
    .eq("room_id", room.id);
  if (countError) {
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }
  if ((count ?? 0) >= MAX_PARTICIPANTS) {
    return NextResponse.json({ error: "Room is full" }, { status: 409 });
  }

  // The first person through the door owns the room and defines the bill.
  const { data: participant, error } = await supabase
    .from("participants")
    .insert({
      room_id: room.id,
      name,
      is_owner: (count ?? 0) === 0,
    })
    .select("id")
    .single<{ id: string }>();

  if (error && error.code !== "23505") {
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }
  if (!participant) {
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }

  const { data: roomWideClaims, error: roomWideClaimsError } = await supabase
    .from("claims")
    .select("item_id, owner_id, group_key, units, group_ids, shared")
    .eq("room_id", room.id)
    .eq("all_participants", true);
  if (roomWideClaimsError) {
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }

  const handledGroups = new Set<string>();
  try {
    for (const claim of roomWideClaims ?? []) {
      const key = `${claim.item_id}:${claim.group_key}`;
      if (handledGroups.has(key)) continue;
      handledGroups.add(key);
      await saveClaimRows(supabase, {
        roomId: room.id,
        itemId: claim.item_id,
        ownerId: claim.owner_id,
        groupKey: claim.group_key,
        participantIds: [...(claim.group_ids ?? []), participant.id],
        units: claim.units,
        groupIds: [...(claim.group_ids ?? []), participant.id],
        shared: true,
        allParticipants: true,
      });
    }
  } catch {
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }

  logger.info("participant_joined", { code, participantId: participant.id });
  await broadcastRoomUpdate(supabase, code);
  return NextResponse.json(await loadRoomState(supabase, room));
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  if (!isValidRoomCode(code)) {
    return NextResponse.json({ error: "Invalid room code" }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    participantId?: unknown;
    name?: unknown;
  } | null;
  const participantId =
    typeof body?.participantId === "string" ? body.participantId : "";
  const name =
    typeof body?.name === "string"
      ? body.name.trim().slice(0, MAX_PARTICIPANT_NAME_LENGTH)
      : "";
  if (participantId === "" || name === "") {
    return NextResponse.json({ error: "Missing name" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const room = await findRoom(supabase, code);
  if (!room) {
    logger.warn("participant_rename_room_not_found", { code });
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const { data: existingParticipants, error: existingParticipantsError } =
    await supabase.from("participants").select("id, name").eq("room_id", room.id);
  if (existingParticipantsError) {
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }

  const normalizedName = name.trim().replace(/\s+/g, " ").toUpperCase();
  const hasDuplicateName = existingParticipants?.some(
    (participant) =>
      participant.id !== participantId &&
      participant.name.trim().replace(/\s+/g, " ").toUpperCase() ===
        normalizedName,
  );
  if (hasDuplicateName) {
    return NextResponse.json(
      { error: "Participant name already exists" },
      { status: 409 },
    );
  }

  const { error } = await supabase
    .from("participants")
    .update({ name })
    .eq("id", participantId)
    .eq("room_id", room.id);
  if (error) {
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }

  logger.info("participant_renamed", { code, participantId });
  await broadcastRoomUpdate(supabase, code);
  return NextResponse.json(await loadRoomState(supabase, room));
}
