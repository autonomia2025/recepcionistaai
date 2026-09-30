import { describe, expect, it } from "vitest";
import {
  buildNextActionPrompt, calendarHint, clampDue, fallbackNextAction, localDate, nextBusinessDay, sanitizeNextAction,
} from "../../supabase/functions/_shared/nextAction.ts";

const WEEK = [1, 2, 3, 4, 5];
const today = "2026-10-02"; // viernes

describe("fechas", () => {
  it("fecha local según la zona horaria", () => {
    expect(localDate(new Date("2026-10-02T02:00:00Z"), "America/Santiago")).toBe("2026-10-01");
    expect(localDate(new Date("2026-10-02T12:00:00Z"), "America/Santiago")).toBe("2026-10-02");
  });

  it("el fin de semana pasa al lunes", () => {
    expect(nextBusinessDay("2026-10-03", WEEK)).toBe("2026-10-05");
    expect(nextBusinessDay("2026-10-02", WEEK)).toBe("2026-10-02");
  });

  it("la fecha queda entre hoy y 10 días, en día hábil", () => {
    expect(clampDue("2026-09-20", today, WEEK)).toBe(today);
    expect(clampDue("2026-10-04", today, WEEK)).toBe("2026-10-05");
    expect(clampDue("2026-12-31", today, WEEK)).toBe("2026-10-12");
    expect(clampDue("mañana", today, WEEK)).toBe(today);
  });

  it("le dice a la IA qué días puede usar", () => {
    expect(calendarHint(today, WEEK)).toBe("viernes 2026-10-02 (hoy), lunes 2026-10-05, martes 2026-10-06, miércoles 2026-10-07, jueves 2026-10-08, viernes 2026-10-09");
  });
});

describe("qué se acepta de la IA", () => {
  const client = ["Necesito la hidrolavadora antes del 15, decidimos esta semana con el gerente"];

  it("acción completa y respaldada", () => {
    expect(sanitizeNextAction({
      action_type: "call", action: "Llamar al gerente para cerrar la compra", due: "2026-10-05",
      argument: "Decide esta semana; destacar vapor a 150°C para la grasa", evidence: "“decidimos esta semana con el gerente”", reason: "El cliente dio un plazo.",
    }, client, today, WEEK)).toEqual({
      action_type: "call", action: "Llamar al gerente para cerrar la compra", due: "2026-10-05",
      argument: "Decide esta semana; destacar vapor a 150°C para la grasa", evidence: "decidimos esta semana con el gerente", reason: "El cliente dio un plazo.",
    });
  });

  it("descarta la cita si el cliente no la escribió; tipo desconocido pasa a seguimiento", () => {
    const a = sanitizeNextAction({ action_type: "pray", action: "Seguir", due: "2026-10-03", evidence: "quiero comprar hoy mismo" }, client, today, WEEK)!;
    expect(a.evidence).toBeNull();
    expect(a.action_type).toBe("follow_up");
    expect(a.due).toBe("2026-10-05");
  });

  it("sin acción no sirve", () => {
    expect(sanitizeNextAction({ action_type: "call", action: "  " }, client, today, WEEK)).toBeNull();
    expect(sanitizeNextAction("hola", client, today, WEEK)).toBeNull();
  });
});

describe("respaldo por reglas (si la IA no sirve)", () => {
  const base = { clientWroteLast: false, quoteStatus: null, quoteSentAt: null, contacted: true };
  it("responder primero, luego enviar la cotización lista, luego llamar al que nadie contactó", () => {
    expect(fallbackNextAction({ ...base, clientWroteLast: true }, today, WEEK)).toMatchObject({ action_type: "email", due: today });
    expect(fallbackNextAction({ ...base, quoteStatus: "issued" }, today, WEEK)).toMatchObject({ action_type: "send_quote", due: today });
    expect(fallbackNextAction({ ...base, contacted: false }, today, WEEK)).toMatchObject({ action_type: "call", due: today });
  });
  it("cotización enviada: seguimiento 3 días después (en día hábil)", () => {
    expect(fallbackNextAction({ ...base, quoteStatus: "sent", quoteSentAt: "2026-10-01T15:00:00Z" }, today, WEEK)).toMatchObject({ action_type: "follow_up", due: "2026-10-05" });
    expect(fallbackNextAction({ ...base, quoteStatus: "sent", quoteSentAt: "2026-09-01T15:00:00Z" }, today, WEEK).due).toBe(today);
  });
});

it("el prompt trae etapa, mensajes del cliente y las reglas", () => {
  const p = buildNextActionPrompt({
    companyName: "SOC Ingeniería", client: "Agrícola El Sol · María", stage: "cotizada", priority: "urgente (\"Cotízame la MH130\")",
    quote: "COT-2026-0007 (enviada el 2026-09-28), neto $1.600.000", whatsappSummary: "Sala de ordeña de 120 vacas",
    clientMessages: [{ at: "2026-09-27T12:00:00Z", text: "Cotízame la MH130" }], emails: [], missing: ["Dirección de despacho"],
    lastSellerContact: "2026-09-28 10:00", playbookTitles: ["Objeción de precio"],
    lastDone: { action: "Llamar al gerente", at: "2026-10-01T15:00:00Z", note: "Decide el lunes" },
  }, today, WEEK);
  expect(p).toContain("HOY: 2026-10-02");
  expect(p).toContain("COT-2026-0007 (enviada el 2026-09-28)");
  expect(p).toContain("- [2026-09-27 12:00] Cotízame la MH130");
  expect(p).toContain("LO QUE FALTA SABER DEL CLIENTE: Dirección de despacho");
  expect(p).toContain("\"wait\" solo si el cliente pidió explícitamente esperar");
  expect(p).toContain("ÚLTIMA ACCIÓN QUE HIZO EL VENDEDOR: Llamar al gerente (2026-10-01). Su nota: \"Decide el lunes\"");
});
