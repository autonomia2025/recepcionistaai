import { describe, expect, it } from "vitest";
import { buildReviewPrompt, sanitizeReview } from "../../supabase/functions/_shared/emailReview.ts";
import { buildReplyPrompt, sanitizeDraft } from "../../supabase/functions/_shared/replyDraft.ts";

const client = ["Hola, gracias. ¿El despacho a Talca tiene costo? ¿Y cuánto demora en llegar?"];

describe("revisión de correos: qué se acepta de la IA", () => {
  it("una revisión completa y respaldada", () => {
    const r = sanitizeReview({
      tone: 4.4, tone_label: "cordial y claro", answered: "partial",
      unanswered: ["¿Y cuánto demora en llegar?"], next_step: true, next_step_text: "Llamar el jueves",
      risks: ["Promete despacho gratis sin respaldo"], strengths: ["Responde rápido", "Buen saludo", "Sobra"],
      improve: "Confirmar el plazo de entrega con fecha.", summary: "Buen correo, le faltó el plazo.",
    }, client)!;
    expect(r).toEqual({
      tone: 4, tone_label: "cordial y claro", answered: "partial", unanswered: ["¿Y cuánto demora en llegar?"],
      next_step: true, next_step_text: "Llamar el jueves", risks: ["Promete despacho gratis sin respaldo"],
      strengths: ["Responde rápido", "Buen saludo"], improve: "Confirmar el plazo de entrega con fecha.", summary: "Buen correo, le faltó el plazo.",
    });
  });

  it("descarta preguntas que el cliente no escribió (y corrige 'all' si quedó una real)", () => {
    const r = sanitizeReview({ tone: 5, answered: "all", unanswered: ["¿Tienen garantía?", "cuanto demora en llegar"] }, client)!;
    expect(r.unanswered).toEqual(["cuanto demora en llegar"]);
    expect(r.answered).toBe("partial");
  });

  it("si el cliente no había preguntado nada, no hay preguntas pendientes", () => {
    const r = sanitizeReview({ tone: 3, answered: "none", unanswered: ["¿El despacho a Talca tiene costo?"] }, [])!;
    expect(r.answered).toBe("nothing_asked");
    expect(r.unanswered).toEqual([]);
  });

  it("tono fuera de rango, textos 'null' y basura", () => {
    const r = sanitizeReview({ tone: 9, answered: "maybe", next_step: "yes", next_step_text: "algo", improve: "null", summary: 42 }, client)!;
    expect(r.tone).toBe(5);
    expect(r.answered).toBe("nothing_asked");
    expect(r.next_step).toBe(false);
    expect(r.next_step_text).toBeNull();
    expect(r.improve).toBeNull();
    expect(r.summary).toBeNull();
    expect(sanitizeReview({ tone: "x" }, client)).toBeNull();
    expect(sanitizeReview(null, client)).toBeNull();
  });

  it("el prompt trae la cotización oficial y marca el correo a evaluar", () => {
    const p = buildReviewPrompt({
      companyName: "SOC Ingeniería", sellerName: "Jorge", clientName: "Agrícola El Sol",
      thread: [{ direction: "in", sent_at: "2026-10-01T12:00:00Z", subject: "Re: COT", body_text: client[0] }],
      email: { direction: "out", sent_at: "2026-10-01T13:00:00Z", subject: "Re: COT", body_text: "Hola María, el despacho es sin costo." },
      quote: { number: "COT-2026-0007", lines: [{ description: "MH130", quantity: 1, unit_price: 2000000, discount_pct: 20 }], net_total: 1600000, total: 1904000, validity_days: 15, payment_terms: "30 días", delivery_terms: "5 días hábiles" },
    });
    expect(p).toContain("COT-2026-0007");
    expect(p).toContain("1 × MH130: $2.000.000 neto c/u, 20% dcto.");
    expect(p).toContain("[CLIENTE · 2026-10-01 12:00]");
    expect(p).toContain("CORREO A EVALUAR (del VENDEDOR):");
    expect(p).toContain("Hola María, el despacho es sin costo.");
  });
});

describe("borrador de respuesta", () => {
  it("quita la firma (se agrega sola) y convierte los [datos faltantes] en cosas por confirmar", () => {
    const d = sanitizeDraft({
      draft: "Hola María,\n\nEl despacho a Talca cuesta [costo de despacho] y llega en [plazo de entrega].\n\n\n¿Te parece si lo conversamos el jueves?\n\nSaludos,\nJorge Muñoz\nSOC Ingeniería",
      checks: ["Confirmar el costo de despacho a Talca"],
    })!;
    expect(d.draft).toBe("Hola María,\n\nEl despacho a Talca cuesta [costo de despacho] y llega en [plazo de entrega].\n\n¿Te parece si lo conversamos el jueves?\n\nSaludos,");
    expect(d.checks).toEqual(["Confirmar el costo de despacho a Talca", "Completar: plazo de entrega"]);
  });

  it("rechaza respuestas vacías o sin texto", () => {
    expect(sanitizeDraft({ draft: "ok" })).toBeNull();
    expect(sanitizeDraft({ checks: [] })).toBeNull();
    expect(sanitizeDraft("hola")).toBeNull();
  });

  it("el prompt pide no inventar y usa corchetes para lo que falta", () => {
    const p = buildReplyPrompt({
      companyName: "SOC Ingeniería", sellerName: "Jorge", clientName: "María", thread: [], quote: null, equipment: "- MH130: agua caliente",
      terms: { payment: "30 días", delivery: null, validity: 15 }, playbook: "", whatsappSummary: "Sala de ordeña de 120 vacas", intent: "follow_up",
    });
    expect(p).toContain("NUNCA inventes precios");
    expect(p).toContain("[corchetes]");
    expect(p).toContain("pregúntaselo directamente, sin corchetes");
    expect(p).toContain("SEGUIMIENTO");
    expect(p).toContain("Sala de ordeña de 120 vacas");
  });
});
