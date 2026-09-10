"use client";

import type { EditableExtras, EditableItem } from "@/lib/receipt/editable";
import { normalizeRoomCode } from "./code";
import type { RoomState } from "./types";

async function readState(response: Response): Promise<RoomState> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "Request failed");
  }
  return (await response.json()) as RoomState;
}

export async function createRoom(merchantName = ""): Promise<string> {
  const response = await fetch("/api/rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ merchantName }),
  });
  if (!response.ok) throw new Error("Could not create the room");
  const { code } = (await response.json()) as { code: string };
  return code;
}

export async function fetchRoom(code: string): Promise<RoomState> {
  return readState(
    await fetch(`/api/rooms/${normalizeRoomCode(code)}`, { cache: "no-store" }),
  );
}

export async function saveBill(
  code: string,
  items: readonly EditableItem[],
  extras: EditableExtras,
): Promise<RoomState> {
  return readState(
    await fetch(`/api/rooms/${normalizeRoomCode(code)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items, extras }),
    }),
  );
}

export async function uploadReceiptImage(
  code: string,
  dataUrl: string,
): Promise<RoomState> {
  const response = await fetch(dataUrl);
  const image = await response.blob();
  const body = new FormData();
  body.append("image", image, "receipt.jpg");
  return readState(
    await fetch(`/api/rooms/${normalizeRoomCode(code)}/receipt-image`, {
      method: "POST",
      body,
    }),
  );
}

export async function addParticipant(
  code: string,
  name: string,
): Promise<RoomState> {
  return readState(
    await fetch(`/api/rooms/${normalizeRoomCode(code)}/participants`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  );
}

export async function renameParticipant(
  code: string,
  participantId: string,
  name: string,
): Promise<RoomState> {
  return readState(
    await fetch(`/api/rooms/${normalizeRoomCode(code)}/participants`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ participantId, name }),
    }),
  );
}

export async function saveClaim(
  code: string,
  claim: {
    itemId: string;
    ownerId: string;
    groupKey: string;
    participantIds: readonly string[];
    units: number | null;
    groupIds: readonly string[];
    shared: boolean;
    allParticipants: boolean;
  },
): Promise<RoomState> {
  return readState(
    await fetch(`/api/rooms/${normalizeRoomCode(code)}/claims`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(claim),
    }),
  );
}
