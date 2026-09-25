import { describe, expect, it } from "vitest";
import { buildHotLeadQualification, verifiedQuoteRequest } from "../../supabase/functions/_shared/hotLead.ts";

const base = {
  quoteRequest: null,
  customerMessages: ["hola", "para lavar la sala de ordeña, tenemos 120 vacas"],
  leadScore: 50,
  events: [],
  companyName: null,
  taxId: null,
  summary: null,
  skuLabels: new Map([["MH13010MI", "MH130-10M-I"], ["PWSB12011MB", "PWSB120-11MB"]]),
};

describe("cola del embudo: qué NO basta", () => {
  it("elegir un equipo del menú no basta (puede ser solo para ver la ficha)", () => {
    expect(buildHotLeadQualification({ ...base, events: [{ event_type: "chosen", sku_normalized: "MH13010MI" }, { event_type: "datasheet_sent", sku_normalized: "MH13010MI" }] })).toBeNull();
  });

  it("un puntaje alto no basta", () => {
    expect(buildHotLeadQualification({ ...base, leadScore: 95 })).toBeNull();
  });

  it("un pedido de cotización que el cliente no escribió no cuenta", () => {
    expect(buildHotLeadQualification({ ...base, quoteRequest: "quiero la cotización formal" })).toBeNull();
  });
});

describe("cola del embudo: qué sí basta", () => {
  it("pidió cotizar con sus palabras", () => {
    const q = buildHotLeadQualification({
      ...base,
      customerMessages: [...base.customerMessages, "Cotízame la MH130 por favor, la necesito este mes"],
      quoteRequest: "Cotízame la MH130 por favor",
    })!;
    expect(q.reasons).toEqual([{ rule: "quote_requested", evidence: "Cotízame la MH130 por favor" }]);
    expect(q.description).toBe("Pidió cotizar por WhatsApp: “Cotízame la MH130 por favor”");
  });

  it("dejó RUT o empresa", () => {
    const q = buildHotLeadQualification({ ...base, companyName: "Soc ingenieria ltda", taxId: "76.644.520-9" })!;
    expect(q.reasons).toEqual([{ rule: "billing_data", company_name: "Soc ingenieria ltda", tax_id: "76.644.520-9" }]);
  });

  it("texto corto y simple: sin puntaje ni resumen, equipo elegido primero", () => {
    const q = buildHotLeadQualification({
      ...base,
      leadScore: 88,
      taxId: "76.644.520-9",
      summary: "Sala de ordeña, 120 vacas. Falta correo.",
      events: [
        { event_type: "recommended", sku_normalized: "PWSB12011MB" },
        { event_type: "recommended", sku_normalized: "MH13010MI" },
        { event_type: "chosen", sku_normalized: "MH13010MI" },
        { event_type: "datasheet_sent", sku_normalized: "MH13010MI" },
      ],
    })!;
    expect(q.description).toBe("Dejó sus datos para facturar (RUT 76.644.520-9).\nEquipo: MH130-10M-I, PWSB120-11MB.");
    expect(q.description).not.toContain("puntaje");
    expect(q.description).not.toContain("Falta correo");
  });

  it("con muchos equipos resume el resto", () => {
    const q = buildHotLeadQualification({
      ...base,
      companyName: "X SpA",
      skuLabels: new Map(),
      events: ["A1", "B2", "C3", "D4"].map((sku) => ({ event_type: "recommended", sku_normalized: sku })),
    })!;
    expect(q.description).toBe("Dejó sus datos para facturar (X SpA).\nEquipo: A1, B2 y 2 más.");
  });
});

describe("verifiedQuoteRequest", () => {
  const msgs = ["si", "ok dale", "mándame la cotización a mi correo"];

  it("acepta una frase que el cliente escribió, ignorando tildes y mayúsculas", () => {
    expect(verifiedQuoteRequest("Mandame la cotizacion", msgs)).toBe("Mandame la cotizacion");
    expect(verifiedQuoteRequest("“mándame la cotización”", msgs)).toBe("mándame la cotización");
  });

  it("rechaza respuestas mínimas aunque existan", () => {
    expect(verifiedQuoteRequest("si", msgs)).toBeNull();
    expect(verifiedQuoteRequest("ok dale", msgs)).toBeNull();
    expect(verifiedQuoteRequest("perfecto gracias", ["perfecto gracias"])).toBeNull();
  });

  it("frases cortas con contenido sí cuentan", () => {
    expect(verifiedQuoteRequest("la quiero", ["dale, la quiero"])).toBe("la quiero");
  });

  it("rechaza lo que no está en los mensajes, null y no-textos", () => {
    expect(verifiedQuoteRequest("quiero comprar dos equipos", msgs)).toBeNull();
    expect(verifiedQuoteRequest("null", msgs)).toBeNull();
    expect(verifiedQuoteRequest(null, msgs)).toBeNull();
    expect(verifiedQuoteRequest(42, msgs)).toBeNull();
  });

  it("no calza dentro de otra palabra", () => {
    expect(verifiedQuoteRequest("la cotiza", ["necesito que la cotizacion llegue hoy"])).toBeNull();
  });
});
