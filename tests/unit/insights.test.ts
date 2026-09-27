import { describe, expect, it } from "vitest";
import { buildMyDay, buildTeamInsights, closeRates, moneyPhrase, type CommercialFacts, type OpenRequestFact } from "@/lib/insights";

const now = new Date("2026-09-27T12:00:00-03:00");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const req = (over: Partial<OpenRequestFact>): OpenRequestFact => ({
  id: Math.random().toString(36).slice(2), client: "Cliente", company: null, zone: "talca", zone_label: "Talca / Maule",
  staff_id: "jorge", staff_name: "Jorge", status: "new", created_at: hoursAgo(1), assigned_at: null,
  quote_status: null, quote_number: null, sent_at: null, amount: null, amount_is_estimate: false, ...over,
});
const facts = (over: Partial<CommercialFacts>): CommercialFacts => ({
  generated_at: now.toISOString(), scope: "team",
  thresholds: { unquoted_hours: 48, unassigned_hours: 4, followup_days: 5, discount_pct: 15, min_sample: 5 },
  open_requests: [], closed_quotes: [], discounted: [], ...over,
});

describe("buildTeamInsights", () => {
  it("clientes esperando cotización por vendedor, con plata en juego", () => {
    const insights = buildTeamInsights(facts({ open_requests: [
      req({ created_at: hoursAgo(72), amount: 2534000, amount_is_estimate: true }),
      req({ created_at: hoursAgo(60), amount: 1600000, quote_status: "draft" }),
      req({ created_at: hoursAgo(10), amount: 9000000 }),   // todavía no pasa el umbral
    ] }), now);
    expect(insights[0].severity).toBe("high");
    expect(insights[0].text).toBe("Jorge tiene 2 clientes esperando cotización hace más de 48 horas. Son cerca de $4.134.000 (estimado) que se pueden enfriar.");
    expect(insights[0].requestIds).toHaveLength(2);
  });

  it("singular y sin monto", () => {
    const insights = buildTeamInsights(facts({ open_requests: [req({ created_at: hoursAgo(50) })] }), now);
    expect(insights[0].text).toBe("Jorge tiene 1 cliente esperando cotización hace más de 48 horas.");
  });

  it("una cotización ya enviada no cuenta como 'esperando'", () => {
    const insights = buildTeamInsights(facts({ open_requests: [req({ created_at: hoursAgo(80), quote_status: "sent", sent_at: hoursAgo(1) })] }), now);
    expect(insights.some(i => i.key.startsWith("waiting"))).toBe(false);
  });

  it("solicitudes sin vendedor por zona", () => {
    const insights = buildTeamInsights(facts({ open_requests: [
      req({ staff_id: null, staff_name: null, created_at: hoursAgo(6) }),
      req({ staff_id: null, staff_name: null, created_at: hoursAgo(9) }),
      req({ staff_id: null, staff_name: null, created_at: hoursAgo(2) }),   // aún dentro de las 4 horas
      req({ staff_id: null, staff_name: null, zone: null, zone_label: null, created_at: hoursAgo(5) }),
    ] }), now);
    const texts = insights.map(i => i.text);
    expect(texts).toContain("2 solicitudes de Talca / Maule siguen sin vendedor asignado (la más antigua lleva 9 horas).");
    expect(texts).toContain("1 solicitud sin zona asignada sigue sin vendedor asignado (lleva 5 horas).");
  });

  it("cotizaciones enviadas sin respuesta por zona", () => {
    const insights = buildTeamInsights(facts({ open_requests: [
      req({ quote_status: "sent", quote_number: "COT-2026-0001", sent_at: hoursAgo(24 * 6), amount: 1600000 }),
      req({ quote_status: "sent", quote_number: "COT-2026-0002", sent_at: hoursAgo(24 * 2), amount: 900000 }),
    ] }), now);
    expect(insights[0].text).toBe("Talca / Maule: 1 cotización enviada hace más de 5 días sigue sin respuesta. Hay $1.600.000 en juego; toca hacer seguimiento.");
  });

  it("descuentos sobre el umbral del mes", () => {
    const insights = buildTeamInsights(facts({ discounted: [
      { quote_number: "COT-2026-0003", max_discount_pct: 20, request_id: "r1", staff_name: "Jorge" },
    ] }), now);
    expect(insights.find(i => i.key === "discounts")!.text).toBe("Este mes salió 1 cotización con descuento sobre el 15% permitido (Jorge): COT-2026-0003 con 20%.");
  });

  it("motivos de pérdida del mes, avisando si son pocos casos", () => {
    const closed = (reason: string, days = 1) => ({ outcome: "rejected" as const, closed_at: hoursAgo(24 * days), lost_reason: reason, net_total: 1, staff_name: "Jorge", zone_label: "Talca / Maule" });
    const insights = buildTeamInsights(facts({ closed_quotes: [closed("Precio"), closed("Precio"), closed("Competencia"), closed("Precio", 40)] }), now);
    expect(insights.find(i => i.key === "lost-reasons")!.text).toBe('Este mes se perdieron 3 ventas. El motivo más común: "Precio" (2 de 3). Aún son pocos casos para sacar conclusiones.');
  });

  it("si no hay problemas lo dice en positivo", () => {
    expect(buildTeamInsights(facts({}), now)[0]).toMatchObject({ severity: "good", text: "No hay solicitudes abiertas en este momento." });
    expect(buildTeamInsights(facts({ open_requests: [req({})] }), now)[0].text).toContain("Todo al día");
  });
});

describe("closeRates", () => {
  const q = (outcome: "accepted" | "rejected", staff = "Jorge") => ({ outcome, closed_at: hoursAgo(24), lost_reason: null, net_total: 1, staff_name: staff, zone_label: "Talca / Maule" });

  it("con pocos casos no muestra porcentaje", () => {
    expect(closeRates(facts({ closed_quotes: [q("accepted"), q("rejected")] }), "staff_name")).toEqual([{ name: "Jorge", closed: 2, won: 1, rate: null }]);
  });

  it("con muestra suficiente muestra el porcentaje", () => {
    const rows = closeRates(facts({ closed_quotes: [q("accepted"), q("accepted"), q("rejected"), q("rejected"), q("rejected"), q("accepted", "Ana")] }), "staff_name");
    expect(rows).toEqual([{ name: "Jorge", closed: 5, won: 2, rate: 40 }, { name: "Ana", closed: 1, won: 1, rate: null }]);
  });
});

describe("moneyPhrase", () => {
  it("marca como estimado si falta algún monto o alguno es estimado", () => {
    expect(moneyPhrase([req({ amount: 1000 }), req({ amount: null })])).toBe("cerca de $1.000 (estimado)");
    expect(moneyPhrase([req({ amount: 1000 }), req({ amount: 500 })])).toBe("$1.500");
    expect(moneyPhrase([req({ amount: null })])).toBeNull();
  });
});

describe("buildMyDay", () => {
  it("separa nuevas, por cotizar (marcando atrasadas) y seguimiento", () => {
    const sections = buildMyDay(facts({ scope: "me", open_requests: [
      req({ id: "nueva", created_at: hoursAgo(3) }),
      req({ id: "atrasada", created_at: hoursAgo(72) }),
      req({ id: "lista", created_at: hoursAgo(30), quote_status: "issued", quote_number: "COT-2026-0004" }),
      req({ id: "fria", created_at: hoursAgo(200), quote_status: "sent", quote_number: "COT-2026-0001", sent_at: hoursAgo(24 * 6) }),
    ] }), now);
    const byKey = Object.fromEntries(sections.map(s => [s.key, s.items]));
    expect(byKey.new.map(i => i.id)).toEqual(["nueva"]);
    expect(byKey["to-quote"].map(i => [i.id, i.late, i.note])).toEqual([
      ["atrasada", true, "Espera desde hace 3 días · sin cotización"],
      ["lista", false, "Espera desde hace 1 día · COT-2026-0004 lista, falta enviarla"],
    ]);
    expect(byKey["follow-up"].map(i => [i.id, i.late, i.note])).toEqual([["fria", true, "COT-2026-0001 enviada hace 6 días"]]);
  });
});
