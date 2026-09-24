import { describe, expect, it } from "vitest";
import { buildHotLeadQualification } from "../../supabase/functions/_shared/hotLead.ts";

const base = {
  leadScore: 50,
  leadScoreReasoning: null,
  events: [],
  companyName: null,
  taxId: null,
  summary: null,
  skuLabels: new Map([["MH13010MI", "MH130-10M-I"], ["PWSB12011MB", "PWSB120-11MB"]]),
};

describe("buildHotLeadQualification", () => {
  it("un cliente tibio sin señales no crea solicitud", () => {
    expect(buildHotLeadQualification({ ...base, leadScore: 79 })).toBeNull();
  });

  it("puntaje 80 o más basta (la misma regla que Clientes)", () => {
    const q = buildHotLeadQualification({ ...base, leadScore: 80, leadScoreReasoning: "pidió precio" })!;
    expect(q.reasons).toEqual([{ rule: "lead_score", score: 80, reasoning: "pidió precio" }]);
    expect(q.description).toBe("Lead caliente detectado por el bot.\nMotivo: puntaje 80.");
  });

  it("elegir un equipo basta, aunque el puntaje sea bajo", () => {
    const q = buildHotLeadQualification({ ...base, events: [{ event_type: "chosen", sku_normalized: "MH13010MI" }] })!;
    expect(q.reasons).toEqual([{ rule: "chose_model", skus: ["MH13010MI"] }]);
    expect(q.description).toContain("Motivo: eligió MH130-10M-I.");
    expect(q.description).toContain("Equipos de interés: MH130-10M-I.");
  });

  it("dejar RUT o empresa basta", () => {
    const q = buildHotLeadQualification({ ...base, companyName: "Soc ingenieria ltda", taxId: "76.644.520-9" })!;
    expect(q.reasons[0]).toEqual({ rule: "billing_data", company_name: "Soc ingenieria ltda", tax_id: "76.644.520-9" });
    expect(q.description).toContain("dejó datos para cotizar (Soc ingenieria ltda, RUT 76.644.520-9)");
  });

  it("junta todos los motivos y lista los equipos: elegido primero, sin repetir, máximo 5", () => {
    const q = buildHotLeadQualification({
      ...base,
      leadScore: 88,
      taxId: "76.644.520-9",
      summary: "Sala de ordeña, 120 vacas, monofásico.",
      events: [
        { event_type: "recommended", sku_normalized: "PWSB12011MB" },
        { event_type: "recommended", sku_normalized: "MH13010MI" },
        { event_type: "chosen", sku_normalized: "MH13010MI" },
        { event_type: "datasheet_sent", sku_normalized: "MH13010MI" },
        { event_type: "recommended", sku_normalized: null },
      ],
    })!;
    expect(q.reasons.map((r) => r.rule)).toEqual(["chose_model", "lead_score", "billing_data"]);
    expect(q.description).toBe(
      "Lead caliente detectado por el bot.\n" +
      "Motivo: eligió MH130-10M-I · puntaje 88 · dejó datos para cotizar (RUT 76.644.520-9).\n" +
      "Equipos de interés: MH130-10M-I, PWSB120-11MB.\n" +
      "Resumen: Sala de ordeña, 120 vacas, monofásico.",
    );
  });

  it("equipos solo recomendados no convierten en caliente a un cliente tibio", () => {
    expect(buildHotLeadQualification({ ...base, events: [{ event_type: "recommended", sku_normalized: "MH13010MI" }] })).toBeNull();
  });
});
