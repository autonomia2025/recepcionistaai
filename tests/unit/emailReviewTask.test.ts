import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Minimal in-memory Supabase client for the review task.
type Row = Record<string, any>;
function fakeSupabase(tables: Record<string, Row[]>, pending: string[]) {
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let op: "select" | "upsert" = "select";
    let payload: Row | null = null;
    let single = false;
    let limit = Infinity;
    let order: { col: string; asc: boolean } | null = null;
    const rows = () => (tables[table] ??= []);
    const run = () => {
      if (op === "upsert") {
        const i = rows().findIndex(r => r.contact_email_id === payload!.contact_email_id);
        if (i >= 0) rows()[i] = payload!; else rows().push(payload!);
        return { data: payload, error: null };
      }
      let out = rows().filter(r => filters.every(f => f(r)));
      if (order) out = [...out].sort((a, b) => (a[order!.col] < b[order!.col] ? -1 : 1) * (order!.asc ? 1 : -1));
      out = out.slice(0, limit);
      return { data: single ? out[0] ?? null : out, error: null };
    };
    const b: any = {
      select: () => b,
      upsert: (row: Row) => { op = "upsert"; payload = row; return b; },
      eq: (c: string, v: unknown) => { filters.push(r => r[c] === v); return b; },
      lt: (c: string, v: string) => { filters.push(r => r[c] < v); return b; },
      gte: (c: string, v: string) => { filters.push(r => r[c] >= v); return b; },
      order: (col: string, o?: { ascending?: boolean }) => { order = { col, asc: o?.ascending !== false }; return b; },
      limit: (n: number) => { limit = n; return b; },
      maybeSingle: () => { single = true; return b; },
      then: (ok: (v: unknown) => void, ko: (e: unknown) => void) => Promise.resolve(run()).then(ok, ko),
    };
    return b;
  };
  return { from, rpc: async () => ({ data: pending.map(id => ({ id })), error: null }) };
}

const at = (h: number) => new Date(Date.UTC(2026, 9, 1, h)).toISOString();
const base = { workshop_id: "w", contact_id: "c", mailbox_user_id: "jorge", quote_id: null, subject: "Re: COT", internet_message_id: null };

function setup() {
  const tables: Record<string, Row[]> = {
    contact_emails: [
      { ...base, id: "old-q", provider_message_id: "1", direction: "in", sent_at: at(9), body_text: "¿Tienen garantía?" },
      { ...base, id: "prev-out", provider_message_id: "2", direction: "out", sent_at: at(10), body_text: "Sí, 1 año de garantía." },
      { ...base, id: "new-q", provider_message_id: "3", direction: "in", sent_at: at(11), body_text: "Gracias. ¿El despacho a Talca tiene costo?" },
      { ...base, id: "reply", provider_message_id: "4", direction: "out", sent_at: at(12), body_text: "Hola María, te confirmo la visita del jueves." },
    ],
    contacts: [{ id: "c", name: "María", company_name: "Agrícola El Sol" }],
    profiles: [{ id: "jorge", full_name: "Jorge" }],
    commercial_settings: [{ workshop_id: "w", legal_name: "SOC Ingeniería" }],
    workshops: [{ id: "w", name: "SOC" }],
    email_reviews: [],
  };
  return tables;
}

describe("tarea de revisión de correos", () => {
  let prompts: string[];
  let aiReply: () => Response;
  beforeEach(() => {
    (globalThis as any).Deno = { env: { get: (k: string) => (k === "LOVABLE_API_KEY" ? "key" : "") } };
    prompts = [];
    aiReply = () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      tone: 4, tone_label: "cordial", answered: "all",
      unanswered: ["¿El despacho a Talca tiene costo?", "¿Tienen garantía?"], next_step: true, next_step_text: "Visita el jueves",
      risks: [], strengths: ["Propone fecha"], improve: "Responder el costo de despacho.", summary: "Cordial pero no respondió el despacho.",
    }) } }] }), { status: 200 });
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => { prompts.push(JSON.parse(String(init.body)).messages[1].content); return aiReply(); }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("evalúa solo lo que el cliente preguntó después del correo anterior del vendedor", async () => {
    const { reviewPendingEmails } = await import("../../supabase/functions/_shared/emailReviewTask.ts");
    const tables = setup();
    const result = await reviewPendingEmails(fakeSupabase(tables, ["reply"]));
    expect(result).toMatchObject({ pending: 1, done: 1, failed: 0, stopped: false });
    const review = tables.email_reviews[0];
    // "¿Tienen garantía?" ya se respondió en el correo anterior: no cuenta.
    expect(review).toMatchObject({ contact_email_id: "reply", seller_id: "jorge", status: "done", answered: "partial", unanswered: ["¿El despacho a Talca tiene costo?"], next_step: true });
    expect(prompts[0]).toContain("CORREO A EVALUAR (del VENDEDOR):\nAsunto: Re: COT\nHola María, te confirmo la visita del jueves.");
    expect(prompts[0].indexOf("¿Tienen garantía?")).toBeLessThan(prompts[0].indexOf("¿El despacho a Talca"));
  });

  it("sin créditos se detiene y no marca nada como revisado", async () => {
    const { reviewPendingEmails } = await import("../../supabase/functions/_shared/emailReviewTask.ts");
    aiReply = () => new Response("{}", { status: 402 });
    const tables = setup();
    const result = await reviewPendingEmails(fakeSupabase(tables, ["reply", "prev-out"]));
    expect(result).toMatchObject({ done: 0, stopped: true });
    expect(tables.email_reviews).toHaveLength(0);
  });

  it("si la IA responde basura, queda como fallida (no se reintenta en bucle)", async () => {
    const { reviewPendingEmails } = await import("../../supabase/functions/_shared/emailReviewTask.ts");
    aiReply = () => new Response(JSON.stringify({ choices: [{ message: { content: '{"tone":"nada"}' } }] }), { status: 200 });
    const tables = setup();
    const result = await reviewPendingEmails(fakeSupabase(tables, ["reply"]));
    expect(result).toMatchObject({ done: 0, failed: 1 });
    expect(tables.email_reviews[0]).toMatchObject({ contact_email_id: "reply", status: "failed" });
  });
});
