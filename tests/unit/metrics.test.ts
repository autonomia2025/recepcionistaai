import { describe, expect, it } from "vitest";
import { changeVs, explain, hoursText, normalizeMetrics, periodRange, recordsFor, type CommercialMetrics } from "@/lib/metrics";

// Same scenario as the database test: September 2026.
const raw = {
  period: { from: "2026-09-01", to: "2026-09-30", days: 30, prev_from: "2026-08-02", prev_to: "2026-08-31" },
  settings: { timezone: "America/Santiago", day_hours: "9.0", sla_hours: "2", followup_days: 5, margin_pct: "30", monthly_fee: "990000", discount_limit: "15" },
  north_star: { amount: "2100000", count: 2, prev_amount: "1000000", prev_count: 1, weekly: [{ week: "2026-09-28", amount: "1600000", leads: 1, fast: 0 }] },
  leading: { leads: 4, fast: 1, prev_leads: 1, prev_fast: 0 },
  roi: { sales: "2100000", cost: "975770", margin: "630000", conversations: 12 },
  funnel: { leads: 4, contacted: 3, quoted: 2, won: 1, lost: 1, won_amount: "1600000" },
  speed: { contact_median: "2", contact_sample: 3, quote_median: "20.5", quote_sample: 2, urgent: 1, urgent_on_time: 0 },
  value: { avg_ticket: "1050000", avg_discount_pct: "20", discount_sample: 1, cycle_median_days: "27", lost: 1, lost_reasons: [{ reason: "Precio", count: 1 }] },
  pipeline: { amount: "900000", count: 1, cold_amount: "900000", cold_count: 1 },
  health: { clients_waiting: 2, discount_over_limit: 1, tone_avg: "4.3", reviewed: 10, actions_due: 6, actions_followed: 4 },
  by_seller: [{ name: "Jorge", leads: 3, quoted: 1, fast: 1, quote_median: "5", won: 1, won_amount: "1600000" }],
  by_zone: null,
  records: {
    won: [{ id: "a", client: "Agrícola", seller: "Jorge", zone: "Talca", amount: 1600000, date: "2026-09-29T15:00:00Z" }],
    leads: [
      { id: "a", client: "Agrícola", seller: "Jorge", zone: "Talca", date: "2026-09-21T13:00:00Z", stage: "Ganado", hours: 5 },
      { id: "b", client: "Viña", seller: "Jorge", zone: "Talca", date: "2026-09-28T13:00:00Z", stage: "Sin atender", hours: null },
    ],
    pipeline: null,
  },
} as unknown as CommercialMetrics;
const m = normalizeMetrics(raw);

describe("métricas comerciales", () => {
  it("convierte los números que llegan como texto", () => {
    expect(m.north_star.amount).toBe(2100000);
    expect(m.settings.day_hours).toBe(9);
    expect(m.by_zone).toEqual([]);
    expect(m.records.pipeline).toEqual([]);
  });

  it("North Star: valor, comparación y el cálculo con los números del período", () => {
    const e = explain("north_star", m);
    expect(e.value).toBe("$2.100.000");
    expect(e.caption).toBe("2 ventas · 1 sep – 30 sep");
    expect(e.change).toEqual({ text: "+110% vs período anterior", direction: "up" });
    expect(e.steps[2]).toEqual({ label: "Período anterior (2 ago – 31 ago)", value: "$1.000.000" });
    expect(e.excludes).toContain("Ventas de clientes que no pasaron por el bot (solicitudes creadas a mano).");
    expect(e.small).toBe("Aún son pocos casos (2): tómalo como referencia, no como tendencia.");
  });

  it("ROI en margen cuando está configurado, y en ventas como referencia", () => {
    const e = explain("roi", m);
    expect(e.value).toBe("0,6×");
    expect(e.caption).toBe("en margen · 2,2× en ventas");
    expect(e.result).toBe("$630.000 ÷ $975.770 = 0,6× en margen (2,2× en ventas)");
    expect(e.tone).toBe("bad");
    expect(e.steps[1].label).toBe("Costo del sistema en 30 días (cuota mensual $990.000 × 30 ÷ 30,4)");
  });

  it("ROI sin costo configurado lo dice", () => {
    const e = explain("roi", { ...m, roi: { ...m.roi, cost: null } });
    expect(e.value).toBe("—");
    expect(e.result).toBe("Sin costo configurado no se puede calcular.");
  });

  it("indicador adelantado y embudo con porcentajes", () => {
    expect(explain("leading_fast", m)).toMatchObject({ value: "25%", caption: "1 de 4 leads que llegaron", tone: "bad" });
    const q = explain("funnel_quoted", m);
    expect(q).toMatchObject({ value: "2", caption: "67% de los contactados", result: "2 de 3 contactados = 67%" });
    expect(q.steps.map(s => s.value)).toEqual(["4", "3 (75%)", "2 (50%)", "1 (25%) · $1.600.000", "1"]);
  });

  it("velocidad en horas hábiles y alertas de salud", () => {
    expect(explain("speed_quote", m)).toMatchObject({ value: "21 h", tone: "warn" });
    expect(explain("speed_contact", m)).toMatchObject({ value: "2 h", tone: "good" });
    expect(explain("avg_discount", m)).toMatchObject({ value: "20%", tone: "bad" });
    expect(explain("clients_waiting", m)).toMatchObject({ value: "2", tone: "bad" });
    expect(explain("adherence", m)).toMatchObject({ value: "67%", caption: "4 de 6 a tiempo" });
  });

  it("los datos detrás de cada número", () => {
    expect(recordsFor("won", m).map(r => r.id)).toEqual(["a"]);
    expect(recordsFor("leads_unattended", m).map(r => r.id)).toEqual(["b"]);
    expect(recordsFor(null, m)).toEqual([]);
  });
});

describe("utilidades", () => {
  it("períodos", () => {
    const now = new Date(2026, 8, 30, 12);
    expect(periodRange("this_month", now)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(periodRange("last_month", now)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(periodRange("last_30", now)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(periodRange("last_90", now)).toEqual({ from: "2026-07-03", to: "2026-09-30" });
  });

  it("cambio contra el período anterior y horas", () => {
    expect(changeVs(0, 0)).toBeNull();
    expect(changeVs(5, 0)).toEqual({ text: "nuevo vs período anterior", direction: "new" });
    expect(changeVs(80, 100)).toEqual({ text: "-20% vs período anterior", direction: "down" });
    expect(hoursText(0.3)).toBe("18 min");
    expect(hoursText(4)).toBe("4 h");
    expect(hoursText(4.5)).toBe("4,5 h");
    expect(hoursText(null)).toBe("—");
  });
});
