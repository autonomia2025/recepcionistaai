import { describe, expect, it } from "vitest";
import { extractProductCodes, isPdfDocument, normalizeProductCode } from "../../supabase/functions/_shared/datasheets.ts";
import {
  extractQuotedCodes,
  findInventedCodes,
  formatCatalogPrice,
  mapMotorType,
  mapWaterType,
  type CatalogRow,
} from "../../supabase/functions/_shared/catalog.ts";

describe("normalizeProductCode", () => {
  it("deja solo letras y dígitos en mayúscula", () => {
    expect(normalizeProductCode("soc250/15acd-c2")).toBe("SOC25015ACDC2");
    expect(normalizeProductCode("PWPC120-11M")).toBe("PWPC12011M");
  });
});

describe("extractProductCodes (mensaje del cliente)", () => {
  it("una letra de menú no es un código", () => {
    expect(extractProductCodes("B")).toEqual([]);
    expect(extractProductCodes("la C")).toEqual([]);
  });

  it("palabras comunes sin dígitos no son códigos", () => {
    expect(extractProductCodes("necesito una hidrolavadora para mi planta")).toEqual([]);
  });

  it("encuentra el código completo escrito con separadores", () => {
    const codes = extractProductCodes("me interesa la SOC250/15ACD-C2, ¿precio?");
    expect(codes.map(normalizeProductCode)).toContain("SOC25015ACDC2");
  });

  it("une un código escrito con espacio y lo pone primero", () => {
    const codes = extractProductCodes("ficha de la soc170 13ef");
    expect(normalizeProductCode(codes[0])).toBe("SOC17013EF");
  });

  it("no repite el mismo código escrito de dos formas", () => {
    const codes = extractProductCodes("PWPC120-11M o pwpc12011m");
    expect(codes.filter((code) => normalizeProductCode(code) === "PWPC12011M")).toHaveLength(1);
  });
});

describe("extractQuotedCodes / findInventedCodes (respuesta del bot)", () => {
  const catalog = new Set(["SOC25015ACDC2", "PWPC12011M"]);

  it("medidas y voltajes no se leen como códigos", () => {
    expect(extractQuotedCodes("250 bar, 15 L/min, eléctrica 380V trifásica, 220v")).toEqual([]);
  });

  it("palabras de la lista de exclusión no son prefijo de código", () => {
    expect(extractQuotedCodes("MODELO1234 y FICHA2020")).toEqual([]);
  });

  it("marca como inventado solo lo que no está en el catálogo", () => {
    const text = "Te recomiendo la *SOC250/15ACD-C2* y la PWPC120-11M. También la SOC999/99X.";
    expect(findInventedCodes(text, catalog)).toEqual(["SOC999/99X"]);
  });

  it("sin catálogo cargado no marca nada (no puede verificar)", () => {
    expect(findInventedCodes("SOC999/99X", new Set())).toEqual([]);
  });
});

describe("catálogo", () => {
  const row = (price_min: number | null, price_max: number | null): CatalogRow => ({
    sku: "X", sku_normalized: "X", water_type: null, motor_type: null, pressure_bar: null,
    flow_lmin: null, temp_max: null, price_min, price_max, datasheet_file: null,
  });

  it("el precio sale como rango, valor único o sin precio", () => {
    expect(formatCatalogPrice(row(9776000, 11501000))).toBe("rango referencial $9.776.000 a $11.501.000 neto");
    expect(formatCatalogPrice(row(500000, 500000))).toBe("valor referencial aprox. $500.000 neto");
    expect(formatCatalogPrice(row(null, null))).toBe("sin precio documentado");
  });

  it("traduce el estado del cliente a los valores de la tabla", () => {
    expect(mapWaterType("agua caliente")).toBe("AGUA CALIENTE");
    expect(mapWaterType("Agua Fria")).toBe("AGUA FRÍA");
    expect(mapWaterType(null)).toBeNull();
    expect(mapMotorType("eléctrica 220V monofásica")).toBe("ELÉCTRICA 220V");
    expect(mapMotorType("motor diésel")).toBe("DIÉSEL");
    expect(mapMotorType("algo raro")).toBeNull();
  });

  it("reconoce PDF por tipo o por extensión", () => {
    expect(isPdfDocument({ file_type: "application/pdf", file_name: "x" })).toBe(true);
    expect(isPdfDocument({ file_type: null, file_name: "Ficha.PDF" })).toBe(true);
    expect(isPdfDocument({ file_type: "text/plain", file_name: "x.txt" })).toBe(false);
  });
});
