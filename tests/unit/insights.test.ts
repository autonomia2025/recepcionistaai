import { describe, expect, it } from "vitest";
import { buildMyDay, buildTeamActivity, buildTeamInsights, closeRates, durationPhrase, moneyPhrase, type CommercialFacts, type OpenRequestFact, type SellerActivity } from "@/lib/insights";

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

describe("cotizadas con el botón antiguo (sin cotización del sistema)", () => {
  const legacy = req({ id: "vieja", created_at: hoursAgo(24 * 9), quoted_at: hoursAgo(24 * 7) });

  it("no cuentan como 'esperando cotización', sí como seguimiento", () => {
    const insights = buildTeamInsights(facts({ open_requests: [legacy] }), now);
    expect(insights.some(i => i.key.startsWith("waiting"))).toBe(false);
    expect(insights.find(i => i.key.startsWith("followup"))!.requestIds).toEqual(["vieja"]);
  });

  it("en Mi día van a 'Hacer seguimiento'", () => {
    const byKey = Object.fromEntries(buildMyDay(facts({ scope: "me", open_requests: [legacy] }), now).map(s => [s.key, s.items]));
    expect(byKey["to-quote"]).toHaveLength(0);
    expect(byKey["follow-up"].map(i => [i.id, i.late, i.note])).toEqual([["vieja", true, "Cotización enviada hace 7 días"]]);
  });
});

describe("cómo trabaja el equipo", () => {
  const seller = (over: Partial<SellerActivity>): SellerActivity => ({
    staff_id: Math.random().toString(36), staff_name: "X", assigned: 0, quoted: 0, median_hours_to_quote: null, speed_sample: 0,
    quoted_last_7_days: 0, open_now: 0, waiting_late_now: 0, followup_late_now: 0, won: 0, lost: 0, won_amount: 0, guide_feedback: 0, ...over,
  });
  const team = (sellers: SellerActivity[]) => ({ days: 30, unquoted_hours: 48, followup_days: 5, sellers });

  it("duraciones en palabras", () => {
    expect(durationPhrase(0.4)).toBe("menos de 1 hora");
    expect(durationPhrase(5)).toBe("5 horas");
    expect(durationPhrase(28)).toBe("1 día y 4 horas");
    expect(durationPhrase(48)).toBe("2 días");
    expect(durationPhrase(24 * 6.4)).toBe("6 días");
  });

  it("primero quien tiene clientes esperando; compara la velocidad con el equipo", () => {
    const cards = buildTeamActivity(team([
      seller({ staff_name: "Ana", assigned: 10, quoted: 8, median_hours_to_quote: 6, speed_sample: 8, open_now: 2 }),
      seller({ staff_name: "Jorge", assigned: 12, quoted: 7, median_hours_to_quote: 40, speed_sample: 7, open_now: 5, waiting_late_now: 3, quoted_last_7_days: 2, won: 2, lost: 1, won_amount: 3200000 }),
      seller({ staff_name: "Luis", assigned: 4, quoted: 4, median_hours_to_quote: 20, speed_sample: 4 }),
    ]));
    expect(cards.map(c => c.name)).toEqual(["Jorge", "Ana", "Luis"]);
    expect(cards[0].headline).toBe("Hoy tiene 3 clientes esperando cotización hace más de 48 horas.");
    expect(cards[0].lines).toEqual([
      "En 30 días recibió 12 solicitudes y cotizó 7. Esta semana envió 2.",
      "Tarda 1 día y 16 horas en cotizar (mitad de los casos). Más lento que el equipo (20 horas).",
      "Cerró 3: ganó 2 por $3.200.000 neto y perdió 1.",
    ]);
    expect(cards[1].lines[1]).toBe("Tarda 6 horas en cotizar (mitad de los casos). Más rápido que el equipo (20 horas).");
    expect(cards[2].lines[1]).toBe("Tarda 20 horas en cotizar (mitad de los casos). Similar al equipo.");
    expect(cards[1].headline).toBe("Al día: 2 solicitudes abiertas, ninguna atrasada.");
  });

  it("con pocos casos no mide ni compara velocidad", () => {
    const [card] = buildTeamActivity(team([seller({ staff_name: "Nuevo", assigned: 2, quoted: 1, median_hours_to_quote: 3, speed_sample: 1 })]));
    expect(card.lines).toContain("Aún pocos casos para medir su velocidad (1 de 3).");
    expect(card.stats.speed).toBeNull();
    expect(card.headline).toBe("No tiene solicitudes abiertas.");
  });

  it("correos: clientes esperando respuesta suben la alerta; tiempos de respuesta comparados", () => {
    const cards = buildTeamActivity(team([
      seller({ staff_name: "Ana", open_now: 2, emails_sent: 9, emails_received: 7, email_reply_median_hours: 2, email_reply_sample: 6 }),
      seller({ staff_name: "Jorge", open_now: 3, emails_sent: 4, emails_received: 6, email_reply_median_hours: 20, email_reply_sample: 5, emails_waiting_now: 2 }),
      seller({ staff_name: "Luis", open_now: 1, emails_sent: 3, emails_received: 3, email_reply_median_hours: 6, email_reply_sample: 3 }),
    ]));
    expect(cards[0].name).toBe("Jorge");
    expect(cards[0].severity).toBe("medium");
    expect(cards[0].headline).toBe("2 clientes le escribieron y siguen sin respuesta.");
    expect(cards[0].lines).toContain("Correos: envió 4 y recibió 6. Responde en 20 horas (mitad de los casos), más lento que el equipo (6 horas).");
    expect(cards.find(c => c.name === "Ana")!.lines).toContain("Correos: envió 9 y recibió 7. Responde en 2 horas (mitad de los casos), más rápido que el equipo (6 horas).");
  });

  it("si ya tenía clientes esperando cotización, los correos pendientes van como línea", () => {
    const [card] = buildTeamActivity(team([seller({ staff_name: "J", waiting_late_now: 1, open_now: 1, emails_waiting_now: 1, emails_received: 1 })]));
    expect(card.headline).toBe("Hoy tiene 1 cliente esperando cotización hace más de 48 horas.");
    expect(card.lines[0]).toBe("1 cliente espera su respuesta por correo hace más de 24 horas.");
  });

  it("la base entrega números como texto: se convierten", () => {
    const [card] = buildTeamActivity(team([seller({ staff_name: "Z", assigned: "3" as unknown as number, quoted: "3" as unknown as number, median_hours_to_quote: "12.5" as unknown as number, speed_sample: "3" as unknown as number })]));
    expect(card.lines[1]).toBe("Tarda 13 horas en cotizar (mitad de los casos).");
  });
});
