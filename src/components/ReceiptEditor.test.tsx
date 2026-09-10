import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EMPTY_EXTRAS } from "@/lib/receipt/editable";
import { ReceiptEditor } from "./ReceiptEditor";

describe("ReceiptEditor", () => {
  it("calculates the displayed total from products and extras", () => {
    render(
      <ReceiptEditor
        items={[{
          id: "item-1",
          name: "Café",
          quantity: 1,
          unitPriceCents: 300,
          state: "editado",
        }]}
        extras={{
          ...EMPTY_EXTRAS,
          taxCents: 100,
          discountCents: 50,
          detectedTotalCents: 500,
        }}
        onItemsChange={vi.fn()}
        onExtrasChange={vi.fn()}
      />,
    );

    expect(screen.getByText("5,00 €")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/5,00 €|5,00/);
    expect(screen.queryByText(/^iva$/i)).toBeNull();
    expect(screen.queryByText(/^propina$/i)).toBeNull();
    expect(screen.queryByText(/^servicio$/i)).toBeNull();
    expect(screen.queryByText(/^descuento$/i)).toBeNull();
  });

  it("allows correcting the detected receipt total", () => {
    const onExtrasChange = vi.fn();

    render(
      <ReceiptEditor
        items={[]}
        extras={{ ...EMPTY_EXTRAS, detectedTotalCents: 500 }}
        onItemsChange={vi.fn()}
        onExtrasChange={onExtrasChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /editar total/i }));
    const input = screen.getByDisplayValue("5.00");
    fireEvent.change(input, { target: { value: "3,50" } });
    fireEvent.click(screen.getByRole("button", { name: /^guardar$/i }));

    expect(onExtrasChange).toHaveBeenLastCalledWith({
      ...EMPTY_EXTRAS,
      detectedTotalCents: 350,
    });
  });

  it("shows a toast when the receipt total is missing", () => {
    render(
      <ReceiptEditor
        items={[]}
        extras={EMPTY_EXTRAS}
        onItemsChange={vi.fn()}
        onExtrasChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("status").textContent).toMatch(
      /no se detectó el total/i,
    );

    fireEvent.click(screen.getByRole("button", { name: /cerrar aviso/i }));

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows a toast when the detected total does not match", () => {
    render(
      <ReceiptEditor
        items={[
          {
            id: "item-1",
            name: "Café",
            quantity: 1,
            unitPriceCents: 300,
            state: "editado",
          },
        ]}
        extras={{ ...EMPTY_EXTRAS, detectedTotalCents: 500 }}
        onItemsChange={vi.fn()}
        onExtrasChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("status").textContent).toMatch(
      /no cuadra con las líneas/i,
    );

    fireEvent.click(screen.getByRole("button", { name: /cerrar aviso/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /ver aviso de desajuste/i }),
    );

    expect(screen.getByRole("status")).not.toBeNull();
  });

  it("adds a new item without forcing quantity to 1", () => {
    const onItemsChange = vi.fn();

    render(
      <ReceiptEditor
        items={[]}
        extras={EMPTY_EXTRAS}
        onItemsChange={onItemsChange}
        onExtrasChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /agregar producto/i }));

    expect(onItemsChange).toHaveBeenCalledTimes(1);
    const [item] = onItemsChange.mock.calls[0][0];
    expect(item.quantity).toBe(0);
  });

  it("keeps the line total fixed when editing quantity", () => {
    const onItemsChange = vi.fn();

    render(
      <ReceiptEditor
        items={[{
          id: "item-1",
          name: "Café",
          quantity: 1,
          unitPriceCents: 300,
          state: "editado",
        }]}
        extras={EMPTY_EXTRAS}
        onItemsChange={onItemsChange}
        onExtrasChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /editar café/i }));
    expect(screen.getByText("€")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/uds\./i), {
      target: { value: "3" },
    });

    const [item] = onItemsChange.mock.calls.at(-1)![0];
    expect(item.quantity).toBe(3);
    expect(item.unitPriceCents).toBe(100);
  });

  it("keeps the product row visible while editing it", () => {
    render(
      <ReceiptEditor
        items={[{
          id: "item-1",
          name: "Café",
          quantity: 1,
          unitPriceCents: 300,
          state: "editado",
        }]}
        extras={EMPTY_EXTRAS}
        onItemsChange={vi.fn()}
        onExtrasChange={vi.fn()}
      />,
    );

    const editButton = screen.getByRole("button", { name: /editar café/i });
    fireEvent.click(editButton);

    expect(editButton.isConnected).toBe(true);
    expect(screen.getAllByText("3,00 €").length).toBeGreaterThan(0);
  });

  it("advances through a line with Enter and closes after confirming its total", () => {
    render(
      <ReceiptEditor
        items={[{
          id: "item-1",
          name: "Café",
          quantity: 1,
          unitPriceCents: 300,
          state: "editado",
        }]}
        extras={EMPTY_EXTRAS}
        onItemsChange={vi.fn()}
        onExtrasChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /editar café/i }));
    const name = screen.getByDisplayValue("Café");
    const quantity = screen.getByLabelText(/uds\./i);
    const total = screen.getByDisplayValue("3.00");

    fireEvent.keyDown(name, { key: "Enter" });
    expect(document.activeElement).toBe(quantity);
    fireEvent.keyDown(quantity, { key: "Enter" });
    expect(document.activeElement).toBe(total);
    fireEvent.keyDown(total, { key: "Enter" });

    expect(screen.queryByLabelText(/uds\./i)).toBeNull();
  });
});
