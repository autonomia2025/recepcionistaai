import { describe, expect, it } from "vitest";
import { computeQuoteTotals, lineTotal } from "@/lib/quoteTotals";

// Expected values are the ones the database trigger produced in the
// migration harness for f2_t1_quotes, so screen and database agree.
describe("computeQuoteTotals (igual que la base)", () => {
  it("dos líneas con descuento de línea y global, IVA 19%", () => {
    const totals = computeQuoteTotals(
      [{ quantity: 2, unit_price: 1_000_000, discount_pct: 10 }, { quantity: 1, unit_price: 500_000, discount_pct: 0 }],
      5,
      19,
    );
    expect(totals).toEqual({ gross_subtotal: 2500000, discount_total: 315000, net_total: 2185000, vat_total: 415150, total: 2600150, max_discount_pct: 12.6 });
  });

  it("redondeo a pesos enteros con decimales", () => {
    const totals = computeQuoteTotals(
      [
        { quantity: 2, unit_price: 1_000_000, discount_pct: 10 },
        { quantity: 1, unit_price: 500_000, discount_pct: 0 },
        { quantity: 3, unit_price: 333_333, discount_pct: 7.5 },
      ],
      5,
      19,
    );
    expect(totals).toEqual({ gross_subtotal: 3499999, discount_total: 436250, net_total: 3063749, vat_total: 582112, total: 3645861, max_discount_pct: 12.46 });
  });

  it("línea individual", () => {
    expect(lineTotal({ quantity: 3, unit_price: 333_333, discount_pct: 7.5 })).toBe(924999);
    expect(lineTotal({ quantity: 1.5, unit_price: 3, discount_pct: 0 })).toBe(5); // 4.5 → 5 (mitad hacia arriba)
  });

  it("sin líneas todo es cero", () => {
    expect(computeQuoteTotals([], 10, 19)).toEqual({ gross_subtotal: 0, discount_total: 0, net_total: 0, vat_total: 0, total: 0, max_discount_pct: 10 });
  });

  it("el caso real de la prueba: PWSB120/11MBPVAPOR al máximo del rango", () => {
    expect(computeQuoteTotals([{ quantity: 1, unit_price: 3_584_000, discount_pct: 0 }], 0, 19))
      .toEqual({ gross_subtotal: 3584000, discount_total: 0, net_total: 3584000, vat_total: 680960, total: 4264960, max_discount_pct: 0 });
  });
});
