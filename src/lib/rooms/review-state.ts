/**
 * Per-participant, per-room flags kept on this device: whether the scanned
 * ticket has already been reviewed once, so it stops reappearing on later visits.
 */

function ticketReviewedKey(code: string, participantId: string): string {
  return `reasypt.ticketReviewed.${code}.${participantId}`;
}

export function hasReviewedTicket(code: string, participantId: string): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(ticketReviewedKey(code, participantId)) === "1";
}

export function markTicketReviewed(code: string, participantId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ticketReviewedKey(code, participantId), "1");
}
