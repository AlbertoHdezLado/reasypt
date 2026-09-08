import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { generateRoomCode } from "@/lib/rooms/code";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

const MAX_CODE_ATTEMPTS = 5;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    merchantName?: unknown;
  } | null;
  const merchantName =
    typeof body?.merchantName === "string"
      ? body.merchantName.trim().slice(0, 120)
      : "";
  const supabase = createServiceClient();

  // The unique index on `code` is the real guard against collisions; retry a
  // few times before giving up rather than pre-checking for existence.
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateRoomCode();
    const { data, error } = await supabase
      .from("rooms")
      .insert({ code, merchant_name: merchantName })
      .select("code")
      .maybeSingle<{ code: string }>();

    if (!error && data) {
      logger.info("room_created", { code: data.code, attempt });
      return NextResponse.json({ code: data.code });
    }
    if (error?.code !== "23505") {
      logger.error("room_create_failed", { error: error?.message });
      return NextResponse.json(
        { error: "Could not create the room" },
        { status: 500 },
      );
    }
  }

  logger.error("room_create_exhausted_attempts", { attempts: MAX_CODE_ATTEMPTS });
  return NextResponse.json(
    { error: "Could not create the room" },
    { status: 503 },
  );
}
