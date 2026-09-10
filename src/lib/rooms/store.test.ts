import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { findRoom, loadRoomState } from "./store";

describe("findRoom", () => {
  it("falls back when the receipt header column is missing from the database", async () => {
    let callCount = 0;
    const supabase = {
      from: () => ({
        select: (columns: string) => ({
          eq: () => ({
            maybeSingle: async () => {
              callCount += 1;
              if (columns.includes("receipt_header")) {
                return {
                  data: null,
                  error: {
                    code: "42703",
                    message: 'column "rooms.receipt_header" does not exist',
                  },
                };
              }

              return {
                data: {
                  id: "r1",
                  code: "ABCD12",
                  tax_cents: 0,
                  tip_cents: 0,
                  service_cents: 0,
                  discount_cents: 0,
                  detected_total_cents: null,
                },
                error: null,
              };
            },
          }),
        }),
      }),
    } as never;

    await expect(findRoom(supabase, "ABCD12")).resolves.toMatchObject({
      code: "ABCD12",
      merchant_name: "",
      receipt_header: [],
    });
    expect(callCount).toBe(2);
  });

  it("loads the merchant name from the room metadata", async () => {
    const supabase = {
      from: (table: string) => {
        if (table === "participants") {
          return {
            select: () => ({
              eq: () => ({
                order: async () => ({ data: [], error: null }),
              }),
            }),
          };
        }

        if (table === "items") {
          return {
            select: () => ({
              eq: () => ({
                order: async () => ({ data: [], error: null }),
              }),
            }),
          };
        }

        return {
          select: () => ({
            eq: async () => ({ data: [], error: null }),
          }),
        };
      },
    } as never;

    await expect(
      loadRoomState(supabase, {
        id: "r1",
        code: "ABCD12",
        tax_cents: 0,
        tip_cents: 0,
        service_cents: 0,
        discount_cents: 0,
        detected_total_cents: null,
        merchant_name: "La Tasca",
        receipt_header: ["La Tasca", "Calle Mayor 1"],
      }),
    ).resolves.toMatchObject({
      extras: {
        merchantName: "La Tasca",
        receiptHeader: ["La Tasca", "Calle Mayor 1"],
      },
    });
  });
});
