import type { EditableExtras, EditableItem } from "@/lib/receipt/editable";

export interface RoomParticipant {
  readonly id: string;
  readonly name: string;
  readonly isOwner: boolean;
}

/** One stored choice: `units` is what the whole group takes, not each share. */
export interface RoomClaim {
  readonly itemId: string;
  readonly participantId: string;
  readonly ownerId: string;
  /** Identifies the group, so one person can hold several on the same line. */
  readonly groupKey: string;
  /** A shared group is open for other people to join; a private one is not. */
  readonly shared: boolean;
  /** A group created for the whole room also includes participants added later. */
  readonly allParticipants?: boolean;
  readonly units: number;
  readonly groupIds: readonly string[];
}

export interface RoomState {
  readonly code: string;
  readonly receiptImageUrl: string | null;
  readonly participants: RoomParticipant[];
  readonly items: EditableItem[];
  readonly extras: EditableExtras;
  readonly claims: RoomClaim[];
}
