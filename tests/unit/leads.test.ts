import { describe, expect, it } from "vitest";
import { dayLabel, groupByDay, leadAmount, leadStage, matchesFilter, type LeadRow } from "@/lib/leads";

const now = new Date("2026-10-01T12:00:00-03:00"); // jueves
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const inbox = { unquoted_hours: 48, followup_days: 5 };
const lead = (over: Partial<LeadRow>): LeadRow => ({
  id: Math.random().toString(36).slice(2), contact_id: "c", status: "new", auto_created: true, created_at: hoursAgo(2), assigned_at: null,
  quoted_at: null, closed_at: null, client: "María", company: null, client_email: null, client_phone: null, zone_label: null,
  staff_id: "s", staff_name: "Jorge", quote_id: null, quote_status: null, quote_number: null, sent_at: null, quote_net: null,
  catalog_amount: null, email_count: 0, unread_in: 0, last_email_at: null, last_direction: null, last_preview: null, last_from_name: null, ...over,
});
const stage = (over: Partial<LeadRow>) => leadStage(lead(over), inbox, now);

describe("etapa de cada lead", () => {
  it("nuevo: llegó hace menos de 24 horas y nadie lo ha tocado", () => {
    expect(stage({})).toMatchObject({ key: "new", label: "Nuevo", late: false, note: "Llegó hace 2 horas" });
  });

  it("por cotizar, atrasado después de 48 horas", () => {
    expect(stage({ created_at: hoursAgo(30) })).toMatchObject({ key: "to_quote", late: false, note: "Sin cotización · espera desde hace 1 día" });
    expect(stage({ created_at: hoursAgo(60), quote_status: "draft" })).toMatchObject({ key: "to_quote", late: true, note: "Cotización en preparación · espera desde hace 2 días" });
  });

  it("cotización lista sin enviar", () => {
    expect(stage({ quote_status: "issued", quote_number: "COT-1" })).toMatchObject({ key: "ready", label: "Falta enviar" });
  });

  it("esperando al cliente: cuenta desde el último correo del vendedor", () => {
    const s = stage({ quote_status: "sent", quote_number: "COT-1", sent_at: hoursAgo(24 * 8), last_direction: "out", last_email_at: hoursAgo(24 * 2), email_count: 3 });
    expect(s).toMatchObject({ key: "waiting_client", late: false, note: "COT-1 enviada · último contacto hace 2 días" });
    expect(stage({ quote_status: "sent", quote_number: "COT-1", sent_at: hoursAgo(24 * 6) }).late).toBe(true);
  });

  it("cotizada con el botón antiguo también espera al cliente", () => {
    expect(stage({ quoted_at: hoursAgo(10), status: "quoted" })).toMatchObject({ key: "waiting_client", note: "Cotización enviada · último contacto hace 10 horas" });
  });

  it("si el cliente escribió último, eso manda (y se atrasa a las 24 horas)", () => {
    expect(stage({ quote_status: "sent", sent_at: hoursAgo(50), last_direction: "in", last_email_at: hoursAgo(3), email_count: 2 }))
      .toMatchObject({ key: "replied", label: "Te escribió", late: false, note: "Te escribió hace 3 horas" });
    expect(stage({ last_direction: "in", last_email_at: hoursAgo(30), email_count: 1 }).late).toBe(true);
  });

  it("cerrados", () => {
    expect(stage({ status: "done", closed_at: hoursAgo(48) })).toMatchObject({ key: "won", note: "Cerrado hace 2 días" });
    expect(stage({ status: "lost" }).key).toBe("lost");
  });
});

describe("filtros", () => {
  it("'Por cotizar' incluye nuevos y listos para enviar; los cerrados solo en 'Cerrados'", () => {
    const l = lead({ quote_status: "issued" });
    expect(matchesFilter(leadStage(l, inbox, now), l, "to_quote")).toBe(true);
    const closed = lead({ status: "done" });
    expect(matchesFilter(leadStage(closed, inbox, now), closed, "all")).toBe(false);
    expect(matchesFilter(leadStage(closed, inbox, now), closed, "closed")).toBe(true);
  });
});

describe("agrupar por día", () => {
  it("etiquetas de día", () => {
    expect(dayLabel(hoursAgo(2), now)).toBe("Hoy");
    expect(dayLabel(hoursAgo(20), now)).toBe("Ayer");
    expect(dayLabel(hoursAgo(24 * 3), now)).toBe("Lunes 28");
    expect(dayLabel("2026-09-15T12:00:00-03:00", now)).toBe("15 de septiembre");
    expect(dayLabel("2025-12-24T12:00:00-03:00", now)).toBe("24 de diciembre 2025");
  });

  it("del día más nuevo al más antiguo", () => {
    const items = [lead({ id: "a", created_at: hoursAgo(20) }), lead({ id: "b", created_at: hoursAgo(1) }), lead({ id: "c", created_at: hoursAgo(3) })].map(l => ({ lead: l }));
    expect(groupByDay(items, now).map(g => [g.label, g.items.map(i => i.lead.id)])).toEqual([["Hoy", ["b", "c"]], ["Ayer", ["a"]]]);
  });
});

it("monto: la cotización manda; si no, estimado del catálogo", () => {
  expect(leadAmount(lead({ quote_net: 1000, catalog_amount: 5000 }))).toEqual({ value: 1000, estimate: false });
  expect(leadAmount(lead({ catalog_amount: "5000" as unknown as number }))).toEqual({ value: 5000, estimate: true });
  expect(leadAmount(lead({}))).toBeNull();
});

describe("prioridad y plazo de atención", () => {
  const quote = { urgent: true, kind: "quote_requested" as const, reasons: [{ code: "quote_requested" as const, text: "Cotízame la MH130" }] };

  it("urgente por pedir cotización: muestra la frase y el plazo que queda", async () => {
    const { priorityView } = await import("@/lib/leads");
    expect(priorityView(lead({ priority: quote, unattended_business_hours: 0.5 }), { sla_hours: 2 }))
      .toEqual({ urgent: true, kind: "Pidió cotización", why: '"Cotízame la MH130"', attention: { overdue: false, text: "Quedan 2 horas hábiles para atenderlo" } });
    expect(priorityView(lead({ priority: quote, unattended_business_hours: 0.8 }), { sla_hours: 2 }).attention!.text).toBe("Queda 1 hora hábil para atenderlo");
    expect(priorityView(lead({ priority: quote, unattended_business_hours: 1.8 }), { sla_hours: 2 }).attention!.text).toBe("Queda menos de 1 hora hábil para atenderlo");
  });

  it("plazo vencido", async () => {
    const { priorityView } = await import("@/lib/leads");
    expect(priorityView(lead({ priority: quote, unattended_business_hours: 3.2 }), { sla_hours: 2 }).attention)
      .toEqual({ overdue: true, text: "Sin atender hace 3 horas hábiles (plazo 2 h)" });
  });

  it("atendido o no urgente: sin plazo", async () => {
    const { priorityView } = await import("@/lib/leads");
    expect(priorityView(lead({ priority: quote, unattended_business_hours: null }), { sla_hours: 2 }).attention).toBeNull();
    expect(priorityView(lead({ priority: { urgent: false, kind: "billing_data", reasons: [] } }), { sla_hours: 2 }))
      .toEqual({ urgent: false, kind: "Dejó datos para facturar", why: null, attention: null });
  });

  it("dentro de un día, los urgentes primero; filtro 'Urgentes'", () => {
    const items = [
      lead({ id: "normal", created_at: hoursAgo(1) }),
      lead({ id: "urgente", created_at: hoursAgo(3), priority: quote }),
    ].map(l => ({ lead: l }));
    expect(groupByDay(items, now)[0].items.map(i => i.lead.id)).toEqual(["urgente", "normal"]);
    const u = lead({ priority: quote });
    expect(matchesFilter(leadStage(u, inbox, now), u, "urgent")).toBe(true);
    const n = lead({});
    expect(matchesFilter(leadStage(n, inbox, now), n, "urgent")).toBe(false);
  });
});

describe("fecha de la próxima acción", () => {
  it("hoy, mañana, día con nombre y vencidas", async () => {
    const { dueLabel } = await import("@/lib/leads");
    const at = new Date(2026, 9, 1, 12); // jueves 1 de octubre
    expect(dueLabel("2026-10-01", at)).toEqual({ text: "Hoy", overdue: false, today: true });
    expect(dueLabel("2026-10-02", at)).toEqual({ text: "Mañana", overdue: false, today: false });
    expect(dueLabel("2026-10-05", at)).toEqual({ text: "Lunes 5", overdue: false, today: false });
    expect(dueLabel("2026-09-30", at)).toEqual({ text: "Vencida ayer", overdue: true, today: false });
    expect(dueLabel("2026-09-28", at)).toEqual({ text: "Vencida (era el lunes 28)", overdue: true, today: false });
  });
});
