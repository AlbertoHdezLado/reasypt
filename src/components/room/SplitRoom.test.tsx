import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultMessages } from "@/i18n";
import { EMPTY_EXTRAS, type EditableItem } from "@/lib/receipt/editable";
import type { LocalClaims } from "@/lib/local-claims";
import { SplitRoom } from "./SplitRoom";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// jsdom does not implement ResizeObserver, used by BillProgress's sticky header.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const items: EditableItem[] = [
  {
    id: "i1",
    name: "CERVEZA",
    quantity: 4,
    unitPriceCents: 250,
    state: "leido",
  },
  {
    id: "i2",
    name: "TORTILLA",
    quantity: 1,
    unitPriceCents: 800,
    state: "leido",
  },
];

const participants = [
  { key: "p1", name: "ANA" },
  { key: "p2", name: "LUIS" },
];

function renderBoard(claims: LocalClaims = {}, overrides = {}) {
  const onSaveGroup = vi.fn();
  render(
    <SplitRoom
      items={items}
      extras={EMPTY_EXTRAS}
      participants={participants}
      claims={claims}
      selfKey="p1"
      onSaveBill={vi.fn()}
      onSaveGroup={onSaveGroup}
      roomCode="AB12CD"
      onToggleShare={vi.fn()}
      messages={defaultMessages}
      {...overrides}
    />,
  );
  return { onSaveGroup };
}

describe("SplitRoom", () => {
  it("restores the participant's last selected tab", async () => {
    window.sessionStorage.setItem(
      "reasypt.roomView.AB12CD.p1",
      JSON.stringify({ tab: "shared", tableBillOpen: false }),
    );

    renderBoard();

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Compartido" }).getAttribute("aria-selected")).toBe("true");
    });
  });

  it("shows how many units of each product are still unassigned", () => {
    renderBoard({
      p2: { i1: [{ owner: "p2", choice: { mode: "units", count: 1 } }] },
    });

    expect(screen.getByText(/CERVEZA/).closest("article")?.textContent).toMatch(
      /3 × 2,50/,
    );
  });

  it("hides fully assigned products from the remaining tab", () => {
    renderBoard({
      p1: { i1: [{ owner: "p1", choice: { mode: "units", count: 4 } }] },
    });

    expect(screen.queryByText(/CERVEZA/)).toBeNull();
    expect(screen.getByText(/TORTILLA/)).toBeTruthy();
  });

  it("offers taking the remaining units alone or sharing them", () => {
    renderBoard();

    fireEvent.click(screen.getByText("CERVEZA"));

    expect(screen.getByRole("button", { name: "Para mí" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: defaultMessages.roomSplit.shareUnits }),
    ).toBeTruthy();
  });

  it("lists the shared groups of a product on the shared tab", () => {
    renderBoard({
      p2: {
        i1: [
          {
            owner: "p2",
            shared: true,
            choice: { mode: "units", count: 1, group: ["p2"] },
          },
        ],
      },
    });

    fireEvent.click(screen.getByRole("tab", { name: "Compartido" }));
    fireEvent.click(screen.getByText("CERVEZA"));

    expect(screen.getAllByText("LUIS").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Unirme al grupo" })).toBeTruthy();
  });

  it("keeps the shared tab label readable on hover", () => {
    renderBoard();

    expect(screen.getByRole("tab", { name: "Compartido" }).className).toContain(
      "hover:text-ink",
    );
  });

  it("shows a pencil icon in the edit button for a shared group", () => {
    renderBoard({
      p1: {
        i1: [
          {
            owner: "p1",
            shared: true,
            choice: { mode: "units", count: 1, group: ["p1", "p2"] },
          },
        ],
      },
      p2: {
        i1: [
          {
            owner: "p1",
            shared: true,
            choice: { mode: "units", count: 1, group: ["p1", "p2"] },
          },
        ],
      },
    });

    fireEvent.click(screen.getByRole("tab", { name: "Compartido" }));

    const editButton = screen.getByRole("button", { name: "Editar" });
    expect(editButton.querySelector("svg")).not.toBeNull();
  });

  it("keeps private groups out of the shared tab", () => {
    renderBoard({
      p2: {
        i1: [
          {
            owner: "p2",
            shared: false,
            choice: { mode: "units", count: 1, group: ["p2"] },
          },
        ],
      },
    });

    fireEvent.click(screen.getByRole("tab", { name: "Compartido" }));

    expect(screen.queryByText(/CERVEZA/)).toBeNull();
  });

  it("lists only the products that are just for the user on the 'for me' tab", () => {
    renderBoard({
      p1: {
        i2: [{ owner: "p1", shared: false, choice: { mode: "units", count: 1 } }],
        i1: [
          {
            owner: "p1",
            shared: true,
            choice: { mode: "units", count: 2, group: ["p1", "p2"] },
          },
        ],
      },
    });

    fireEvent.click(screen.getByRole("tab", { name: "Para mí" }));

    const personalCard = screen.getByText(/TORTILLA/).closest("article");
    expect(personalCard).toBeTruthy();
    expect(personalCard?.className).toContain("border-blue-500");
    expect(screen.queryByText(/CERVEZA/)).toBeNull();
  });

  it("shows the members, units and price of each shared group", () => {
    const shared = {
      owner: "p1",
      shared: true,
      choice: { mode: "units" as const, count: 2, group: ["p1", "p2"] },
    };
    renderBoard({ p1: { i1: [shared] }, p2: { i1: [shared] } });

    fireEvent.click(screen.getByRole("tab", { name: "Compartido" }));

    const card = screen.getByText(/CERVEZA/).closest("article")!;

    expect(card.textContent).toMatch(/ANALUIS/);
    expect(card.textContent).toMatch(/2 uds\./);
    expect(card.textContent).toMatch(/2,50\s?€ por persona/);
  });

  it("shows each shared group in its own product card", () => {
    renderBoard({
      p1: {
        i1: [
          {
            owner: "p1",
            shared: true,
            choice: { mode: "units", count: 1, group: ["p1"] },
          },
        ],
      },
      p2: {
        i1: [
          {
            owner: "p2",
            shared: true,
            choice: { mode: "units", count: 1, group: ["p2"] },
          },
        ],
      },
    });

    fireEvent.click(screen.getByRole("tab", { name: "Compartido" }));

    expect(screen.getAllByText("CERVEZA")).toHaveLength(2);
    expect(screen.getAllByText(/1 uds\./)).toHaveLength(2);
  });

  it("keeps the user's own total in the floating bar", () => {
    renderBoard({
      p1: { i2: [{ owner: "p1", choice: { mode: "units", count: 1 } }] },
    });

    const bar = screen.getByText(defaultMessages.roomSplit.yourTotal).closest("button")!;

    expect(bar.textContent).toMatch(/8,00/);
  });

  it("does not render the final split button", () => {
    renderBoard();

    expect(
      screen.queryByRole("button", { name: "Ver el reparto final" }),
    ).toBeNull();
  });

  it("opens the breakdown with the lines behind each person's total", () => {
    renderBoard({
      p1: { i2: [{ owner: "p1", choice: { mode: "units", count: 1 } }] },
    });

    fireEvent.click(screen.getByText(defaultMessages.roomSplit.yourTotal));

    expect(document.body.textContent).toMatch(/De dónde sale tu total/);
    expect(document.body.textContent).toMatch(/Resto de la sala/);
    expect(document.body.textContent).toMatch(/LUIS/);
  });

  it("shows the unassigned split inside its expanded breakdown", () => {
    renderBoard({
      p1: { i2: [{ owner: "p1", choice: { mode: "units", count: 1 } }] },
    });

    const unassigned = screen.getByText(defaultMessages.roomSplit.unassignedProducts)
      .closest("button")!;

    expect(unassigned.textContent).toMatch(/PRODUCTOS NO ASIGNADOS 7,50\s?€/);
    expect(unassigned.textContent).not.toMatch(/15,00\s?€\s*\/\s*2/);

    fireEvent.click(unassigned);

    expect(document.body.textContent).toMatch(/15,00\s?€\s*\/\s*2/);
  });

  it("creates a private group with the chosen number of units", () => {
    const { onSaveGroup } = renderBoard();

    fireEvent.click(screen.getByText("CERVEZA"));
    fireEvent.click(screen.getByRole("button", { name: "+" }));
    fireEvent.click(screen.getByRole("button", { name: "Para mí" }));

    expect(onSaveGroup).toHaveBeenCalledWith(
      "i1",
      expect.any(String),
      "p1",
      ["p1"],
      2,
      false,
    );
  });

  it("creates a shared group when the units are shared", () => {
    const { onSaveGroup } = renderBoard();

    fireEvent.click(screen.getByText("CERVEZA"));
    fireEvent.click(
      screen.getByRole("button", { name: defaultMessages.roomSplit.shareUnits }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Toda la sala" }));

    expect(onSaveGroup).toHaveBeenCalledWith(
      "i1",
      expect.any(String),
      "p1",
      ["p1"],
      1,
      true,
    );
  });

  it("offers joining an existing group inside the share picker", () => {
    const { onSaveGroup } = renderBoard({
      p2: {
        i1: [
          {
            owner: "p2",
            shared: true,
            choice: { mode: "units", count: 2, group: ["p2"] },
          },
        ],
      },
    });

    fireEvent.click(screen.getByText("CERVEZA"));

    expect(
      screen.queryByRole("button", { name: "Unirse a grupo existente" }),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: defaultMessages.roomSplit.shareUnits }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Unirse a grupo existente" }),
    );

    expect(onSaveGroup).toHaveBeenCalledWith(
      "i1",
      "p2",
      "p2",
      ["p2", "p1"],
      3,
      true,
    );
  });

  it("joins an existing group without changing its units", () => {
    const { onSaveGroup } = renderBoard({
      p2: {
        i1: [
          {
            owner: "p2",
            shared: true,
            choice: { mode: "units", count: 2, group: ["p2"] },
          },
        ],
      },
    });

    fireEvent.click(screen.getByRole("tab", { name: "Compartido" }));
    fireEvent.click(screen.getByRole("button", { name: "Unirme al grupo" }));

    expect(onSaveGroup).toHaveBeenCalledWith(
      "i1",
      "p2",
      "p2",
      ["p2", "p1"],
      2,
      true,
    );
  });

  it("still offers more units when the user already owns a group", () => {
    const { onSaveGroup } = renderBoard({
      p1: {
        i1: [
          {
            owner: "p1",
            groupId: "g1",
            shared: false,
            choice: { mode: "units", count: 1, group: ["p1"] },
          },
        ],
      },
    });

    fireEvent.click(screen.getByText("CERVEZA"));
    fireEvent.click(screen.getByRole("button", { name: "Para mí" }));

    // A brand new group, kept apart from the one the user already owns.
    expect(onSaveGroup).toHaveBeenCalledWith(
      "i1",
      expect.not.stringMatching(/^g1$/),
      "p1",
      ["p1"],
      1,
      false,
    );
  });

  it("updates the units of a group from the 'for me' tab", () => {
    const { onSaveGroup } = renderBoard({
      p1: {
        i1: [
          {
            owner: "p1",
            shared: false,
            choice: { mode: "units", count: 1, group: ["p1"] },
          },
        ],
      },
    });

    fireEvent.click(screen.getByRole("tab", { name: "Para mí" }));
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    fireEvent.click(screen.getByRole("button", { name: "+" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(onSaveGroup).toHaveBeenCalledWith(
      "i1",
      "p1",
      "p1",
      ["p1"],
      2,
      false,
    );
  });

  it("keeps the private and the shared group of a product apart", () => {
    renderBoard({
      p1: {
        i1: [
          {
            owner: "p1",
            groupId: "g1",
            shared: false,
            choice: { mode: "units", count: 1, group: ["p1"] },
          },
          {
            owner: "p1",
            groupId: "g2",
            shared: true,
            choice: { mode: "units", count: 2, group: ["p1", "p2"] },
          },
        ],
      },
      p2: {
        i1: [
          {
            owner: "p1",
            groupId: "g2",
            shared: true,
            choice: { mode: "units", count: 2, group: ["p1", "p2"] },
          },
        ],
      },
    });

    fireEvent.click(screen.getByRole("tab", { name: "Para mí" }));

    const mineCard = screen.getByText(/CERVEZA/).closest("article")!;

    expect(mineCard.textContent).not.toMatch(/Quedan|Todo asignado/);
    expect(mineCard.textContent).toMatch(/ANA1 uds\./);
    expect(mineCard.textContent).not.toMatch(/ANALUIS/);

    fireEvent.click(screen.getByRole("tab", { name: "Compartido" }));

    const sharedCard = screen.getByText(/CERVEZA/).closest("article")!;

    expect(sharedCard.textContent).toMatch(/ANALUIS2 uds\./);
  });

  it("keeps the group's total units so the rest absorb the leaving member's share", () => {
    const shared = {
      owner: "p1",
      choice: { mode: "units" as const, count: 2, group: ["p1", "p2"] },
    };
    const { onSaveGroup } = renderBoard({
      p1: { i1: [shared] },
      p2: { i1: [shared] },
    });

    fireEvent.click(screen.getByRole("tab", { name: "Compartido" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Quitar mi selección" }),
    );

    expect(onSaveGroup).toHaveBeenCalledWith(
      "i1",
      "p1",
      "p1",
      ["p2"],
      2,
      true,
    );
  });

  it("drops the group when its last member leaves", () => {
    const { onSaveGroup } = renderBoard({
      p1: {
        i1: [
          {
            owner: "p1",
            shared: false,
            choice: { mode: "units", count: 1, group: ["p1"] },
          },
        ],
      },
    });

    fireEvent.click(screen.getByRole("tab", { name: "Para mí" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Quitar mi selección" }),
    );

    expect(onSaveGroup).toHaveBeenCalledWith(
      "i1",
      "p1",
      "p1",
      [],
      null,
      false,
    );
  });

  it("alerts the rest of the group when someone else changes it", () => {
    const before = {
      owner: "p2",
      choice: { mode: "units" as const, count: 2, group: ["p1", "p2"] },
    };
    const { rerender } = renderTree({ p1: { i1: [before] }, p2: { i1: [before] } });

    const after = {
      owner: "p2",
      choice: { mode: "units" as const, count: 4, group: ["p1", "p2"] },
    };
    rerender({ p1: { i1: [after] }, p2: { i1: [after] } });

    fireEvent.click(screen.getByRole("button", { name: "Avisos, 1 sin leer" }));

    expect(screen.getByRole("alert").textContent).toMatch(
      /CERVEZA: el grupo pasa a 4 uds\. entre 2 personas\./,
    );
  });
});

function renderTree(claims: LocalClaims) {
  const roomView = (next: LocalClaims) => (
    <SplitRoom
      items={items}
      extras={EMPTY_EXTRAS}
      participants={participants}
      claims={next}
      selfKey="p1"
      onSaveBill={vi.fn()}
      onSaveGroup={vi.fn()}
      roomCode="AB12CD"
      onToggleShare={vi.fn()}
      messages={defaultMessages}
    />
  );
  const view = render(roomView(claims));
  return { rerender: (next: LocalClaims) => view.rerender(roomView(next)) };
}
