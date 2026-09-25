import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { buildQuotePdf, clp, toWinAnsi, wrapText, type QuotePdfData } from "@/lib/quotePdf";

const base: QuotePdfData = {
  number: "COT-2026-0001",
  issuedAt: new Date("2026-09-25T15:00:00"),
  validityDays: 15,
  company: { legalName: "Soc Ingenieria", taxId: null, address: "Talca", phones: [], email: null, primaryColor: "#1A9387", secondaryColor: "#127BA1", logo: null },
  seller: { name: "Erwin Niepel", email: "erwin@example.cl" },
  client: { name: "JT", company: "Pruebas JT SpA", taxId: "76.644.520-9", email: "jt@example.cl", phone: null, address: null },
  lines: [{ sku: "PWSB120/11MBPVAPOR", description: "Hidrolavadora agua caliente · eléctrica 220V · 120 bar · 11 L/min · temp. máx. 150°C", quantity: 1, unitPrice: 3584000, discountPct: 0, total: 3584000 }],
  totals: { gross: 3584000, discount: 0, net: 3584000, vatRate: 19, vat: 680960, total: 4264960 },
  paymentTerms: "A convenir con el ejecutivo",
  deliveryTerms: "Según disponibilidad",
  notes: null,
  legalFooter: "Precios netos en pesos chilenos.",
};

describe("toWinAnsi", () => {
  it("conserva tildes, ñ, °, · y comillas tipográficas", () => {
    expect(toWinAnsi("Cotización · ñandú 150°C “ok” – fin")).toBe("Cotización · ñandú 150°C “ok” – fin");
  });

  it("reemplaza lo que Helvetica no puede escribir y quita emojis", () => {
    expect(toWinAnsi("precio − descuento → total 🚜✅")).toBe("precio - descuento -> total ");
  });
});

describe("wrapText", () => {
  it("corta por palabras sin pasarse del ancho y parte palabras muy largas", async () => {
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
    const lines = wrapText("Hidrolavadora agua caliente eléctrica 220V con carro SUPERCALIFRAGILISTICOEXPIALIDOSO", font, 9, 80);
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines) expect(font.widthOfTextAtSize(line, 9)).toBeLessThanOrEqual(80);
    // Nothing is lost: same characters once spaces are ignored.
    expect(lines.join("").replace(/ /g, "")).toBe("Hidrolavadora agua caliente eléctrica 220V con carro SUPERCALIFRAGILISTICOEXPIALIDOSO".replace(/ /g, ""));
  });

  it("respeta saltos de línea", async () => {
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
    expect(wrapText("uno\ndos", font, 9, 500)).toEqual(["uno", "dos"]);
  });
});

describe("buildQuotePdf", () => {
  it("genera un PDF válido de una página con título y fecha", async () => {
    const doc = await PDFDocument.load(await buildQuotePdf(base));
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe("Cotización COT-2026-0001");
  });

  it("pagina cuando hay muchos equipos", async () => {
    const lines = Array.from({ length: 30 }, (_, i) => ({ ...base.lines[0], sku: `MH13${i}-10M-I` }));
    const doc = await PDFDocument.load(await buildQuotePdf({ ...base, lines }));
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
  });

  it("no falla con emojis, textos vacíos ni un logo dañado", async () => {
    const bytes = await buildQuotePdf({
      ...base,
      notes: "Gracias 🙌 − saludos",
      legalFooter: "",
      seller: null,
      company: { ...base.company, legalName: null, logo: { bytes: new Uint8Array([1, 2, 3]), type: "png" } },
      client: { ...base.client, company: null },
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});

describe("clp", () => {
  it("formatea pesos chilenos con punto de miles", () => {
    expect(clp(4264960)).toBe("$4.264.960");
    expect(clp(0)).toBe("$0");
  });
});
