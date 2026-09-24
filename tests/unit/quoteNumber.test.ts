import { describe, expect, it } from "vitest";
import { formatQuoteNumber } from "@/lib/quoteNumber";

describe("formatQuoteNumber", () => {
  it("usa el formato por defecto PREFIJO-AÑO-NNNN", () => {
    expect(formatQuoteNumber({ prefix: "COT", padding: 4, includesYear: true }, 1, 2026)).toBe("COT-2026-0001");
  });

  it("omite el año cuando está desactivado", () => {
    expect(formatQuoteNumber({ prefix: "SOC", padding: 3, includesYear: false }, 12, 2026)).toBe("SOC-012");
  });

  it("no recorta números más largos que el relleno", () => {
    expect(formatQuoteNumber({ prefix: "COT", padding: 4, includesYear: true }, 12345, 2026)).toBe("COT-2026-12345");
  });

  it("nunca produce un número menor que 1 ni decimales", () => {
    expect(formatQuoteNumber({ prefix: "COT", padding: 4, includesYear: false }, 0)).toBe("COT-0001");
    expect(formatQuoteNumber({ prefix: "COT", padding: 4, includesYear: false }, -5)).toBe("COT-0001");
    expect(formatQuoteNumber({ prefix: "COT", padding: 4, includesYear: false }, 7.9)).toBe("COT-0007");
  });
});
