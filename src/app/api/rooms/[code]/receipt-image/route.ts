import { NextResponse } from "next/server";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/rooms/code";
import {
  broadcastRoomUpdate,
  findRoom,
  loadRoomState,
} from "@/lib/rooms/store";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const BUCKET = "receipt-images";
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  if (!isValidRoomCode(code)) {
    return NextResponse.json({ error: "Invalid room code" }, { status: 400 });
  }

  const formData = await request.formData().catch(() => null);
  const image = formData?.get("image");
  if (
    !(image instanceof File) ||
    image.type !== "image/jpeg" ||
    image.size === 0 ||
    image.size > MAX_IMAGE_BYTES
  ) {
    return NextResponse.json({ error: "Invalid receipt image" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const room = await findRoom(supabase, code);
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const path = `${normalizeRoomCode(code)}/receipt.jpg`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, image, {
    contentType: "image/jpeg",
    upsert: true,
  });
  if (uploadError) {
    return NextResponse.json({ error: "Could not upload receipt image" }, { status: 500 });
  }

  const { data: publicUrl } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const { error: updateError } = await supabase
    .from("rooms")
    .update({ receipt_image_url: publicUrl.publicUrl })
    .eq("id", room.id);
  if (updateError) {
    return NextResponse.json({ error: "Could not save receipt image" }, { status: 500 });
  }

  await broadcastRoomUpdate(supabase, code);
  return NextResponse.json(
    await loadRoomState(supabase, { ...room, receipt_image_url: publicUrl.publicUrl }),
  );
}