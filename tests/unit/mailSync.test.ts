import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A tiny in-memory stand-in for the Supabase client: enough of the query
// builder for mailSync (select/eq/not/gte/order/limit/maybeSingle/insert/update).
type Row = Record<string, any>;
function fakeSupabase(tables: Record<string, Row[]>) {
  const uploads: string[] = [];
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let op: "select" | "insert" | "update" = "select";
    let payload: Row | null = null;
    let single = false;
    let limit = Infinity;
    const rows = () => (tables[table] ??= []);
    const run = () => {
      if (op === "insert") {
        const row = payload!;
        if (table === "contact_emails" && rows().some(r => r.workshop_id === row.workshop_id && r.mailbox_email === row.mailbox_email && r.provider_message_id === row.provider_message_id)) {
          return { data: null, error: { code: "23505", message: "duplicate" } };
        }
        rows().push({ ...row });
        return { data: row, error: null };
      }
      const matched = rows().filter(r => filters.every(f => f(r)));
      if (op === "update") { matched.forEach(r => Object.assign(r, payload)); return { data: null, error: null }; }
      const out = matched.slice(0, limit);
      return { data: single ? out[0] ?? null : out, error: null };
    };
    const builder: any = {
      select: () => builder,
      insert: (row: Row) => { op = "insert"; payload = row; return builder; },
      update: (patch: Row) => { op = "update"; payload = patch; return builder; },
      eq: (c: string, v: unknown) => { filters.push(r => r[c] === v); return builder; },
      not: (c: string) => { filters.push(r => r[c] != null); return builder; },
      gte: (c: string, v: string) => { filters.push(r => r[c] >= v); return builder; },
      order: () => builder,
      limit: (n: number) => { limit = n; return builder; },
      maybeSingle: () => { single = true; return builder; },
      then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => Promise.resolve(run()).then(resolve, reject),
    };
    return builder;
  };
  return {
    from,
    storage: { from: () => ({ upload: async (path: string) => { uploads.push(path); return { error: null }; } }) },
    uploads,
  };
}

const W = "w-soc";
const now = Date.now();
const iso = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();
const person = (address: string, name?: string) => ({ emailAddress: { address, name } });

const INBOX = [
  { id: "m-banco", conversationId: "c-banco", internetMessageId: "<1>", subject: "Tu cartola", from: person("avisos@banco.cl"), toRecipients: [person("jorge@soc.cl")], ccRecipients: [], receivedDateTime: iso(50), sentDateTime: iso(50), hasAttachments: false },
  { id: "m-maria", conversationId: "c-maria", internetMessageId: "<2>", subject: "Consulta despacho", from: person("Maria@Agricola.cl", "María Soto"), toRecipients: [person("jorge@soc.cl")], ccRecipients: [], receivedDateTime: iso(40), sentDateTime: iso(41), hasAttachments: true },
  { id: "m-colega", conversationId: "c-colega", internetMessageId: "<4>", subject: "Reunión interna", from: person("gerencia@soc.cl"), toRecipients: [person("jorge@soc.cl")], ccRecipients: [person("maria@agricola.cl")], receivedDateTime: iso(35), sentDateTime: iso(35), hasAttachments: false },
  { id: "m-respuesta", conversationId: "c-cot", internetMessageId: "<3>", subject: "Re: Cotización COT-2026-0001", from: person("compras@agricola.cl", "Compras Agrícola"), toRecipients: [person("jorge@soc.cl")], ccRecipients: [], receivedDateTime: iso(30), sentDateTime: iso(30), hasAttachments: false },
];
const SENT = [
  { id: "m-mama", conversationId: "c-mama", subject: "Almuerzo", from: person("jorge@soc.cl"), toRecipients: [person("mama@gmail.com")], ccRecipients: [], receivedDateTime: iso(20), sentDateTime: iso(20), hasAttachments: false },
  { id: "m-a-juan", conversationId: "c-juan", subject: "Ficha técnica", from: person("jorge@soc.cl", "Jorge"), toRecipients: [person("gerencia@soc.cl")], ccRecipients: [person("juan@x.cl")], receivedDateTime: iso(10), sentDateTime: iso(10), hasAttachments: false },
];

function fakeGraph() {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: string) => {
    const url = decodeURIComponent(String(input));
    calls.push(url);
    const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.includes("/mailFolders/inbox/messages")) return ok({ value: INBOX });
    if (url.includes("/mailFolders/sentitems/messages")) return ok({ value: SENT });
    if (url.match(/\/attachments\/[^/]+\/\$value$/)) return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    if (url.includes("/attachments")) return ok({ value: [
      { id: "a1", name: "Orden de compra.pdf", contentType: "application/pdf", size: 3, isInline: false, "@odata.type": "#microsoft.graph.fileAttachment" },
      { id: "a2", name: "logo.png", contentType: "image/png", size: 3, isInline: true, "@odata.type": "#microsoft.graph.fileAttachment" },
    ] });
    const single = url.match(/\/me\/messages\/([^?/]+)\?\$select=uniqueBody/);
    if (single) return ok({ uniqueBody: { contentType: "text", content: `Texto de ${single[1]}\n\nEl lun, 28 sept 2026, Jorge escribió:\n> antes` } });
    return new Response("{}", { status: 404 });
  });
  return { fetchMock, calls };
}

describe("sincronización del correo de Outlook", () => {
  let graph: ReturnType<typeof fakeGraph>;
  beforeEach(() => {
    (globalThis as any).Deno = { env: { get: () => "" } };
    graph = fakeGraph();
    vi.stubGlobal("fetch", graph.fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const setup = () => {
    const tables: Record<string, Row[]> = {
      contacts: [
        { id: "c-maria", workshop_id: W, email: "maria@agricola.cl" },
        { id: "c-juan", workshop_id: W, email: "JUAN@x.cl" },
        { id: "c-otro-negocio", workshop_id: "w-eco", email: "avisos@banco.cl" },
      ],
      quotes: [],
      service_requests: [{ id: "r-maria", contact_id: "c-maria" }],
      contact_emails: [
        // The quote sent from the panel: the client's answer arrives from another address.
        { id: "e0", workshop_id: W, contact_id: "c-maria", mailbox_email: "jorge@soc.cl", provider_message_id: "m-cot", conversation_id: "c-cot", quote_id: "q1", service_request_id: "r-maria", sent_from_panel: true, sent_at: iso(60) },
      ],
      staff_mailboxes: [{ user_id: "u-jorge", workshop_id: W, email: "Jorge@soc.cl", status: "active" }],
      notifications: [],
    };
    const supabase = fakeSupabase(tables);
    const mailbox = { user_id: "u-jorge", workshop_id: W, email: "Jorge@soc.cl", access_token: "AT", refresh_token: "RT",
      token_expires_at: new Date(now + 3600_000).toISOString(), inbox_synced_until: null, sent_synced_until: null };
    return { tables, supabase, mailbox };
  };

  it("guarda solo los correos con clientes; nunca el resto de la bandeja", async () => {
    const { syncMailbox } = await import("../../supabase/functions/_shared/mailSync.ts");
    const { tables, supabase, mailbox } = setup();
    const result = await syncMailbox(supabase, mailbox as any, Date.now() + 10_000);

    const stored = tables.contact_emails.filter(e => e.id !== "e0");
    expect(stored.map(e => e.provider_message_id).sort()).toEqual(["m-a-juan", "m-maria", "m-respuesta"]);
    expect(result).toMatchObject({ scanned: 6, stored: 3 });
    // The bank email and the personal one were never opened (no body request).
    expect(graph.calls.some(u => u.includes("m-banco?"))).toBe(false);
    expect(graph.calls.some(u => u.includes("m-mama?"))).toBe(false);
    expect(graph.calls.some(u => u.includes("m-colega?"))).toBe(false);
  });

  it("vincula contacto, solicitud y cotización; guarda solo el texto nuevo y los adjuntos reales", async () => {
    const { syncMailbox } = await import("../../supabase/functions/_shared/mailSync.ts");
    const { tables, supabase, mailbox } = setup();
    await syncMailbox(supabase, mailbox as any, Date.now() + 10_000);
    const by = (id: string) => tables.contact_emails.find(e => e.provider_message_id === id)!;

    expect(by("m-maria")).toMatchObject({ contact_id: "c-maria", service_request_id: "r-maria", quote_id: null, direction: "in", from_address: "maria@agricola.cl", from_name: "María Soto", mailbox_email: "jorge@soc.cl", body_text: "Texto de m-maria" });
    expect(by("m-maria").attachments).toEqual([{ filename: "Orden de compra.pdf", content_type: "application/pdf", size: 3, path: expect.stringMatching(/^w-soc\/mail\/.+\/1-Orden_de_compra.pdf$/) }]);
    expect(by("m-respuesta")).toMatchObject({ contact_id: "c-maria", quote_id: "q1", service_request_id: "r-maria", direction: "in" });
    expect(by("m-a-juan")).toMatchObject({ contact_id: "c-juan", direction: "out", cc_addresses: ["juan@x.cl"] });
  });

  it("avisa al vendedor solo cuando responden una cotización enviada desde el panel", async () => {
    const { syncMailbox } = await import("../../supabase/functions/_shared/mailSync.ts");
    const { tables, supabase, mailbox } = setup();
    await syncMailbox(supabase, mailbox as any, Date.now() + 10_000);
    expect(tables.notifications).toHaveLength(1);
    expect(tables.notifications[0]).toMatchObject({ user_id: "u-jorge", type: "quote_reply", workshop_id: W });
  });

  it("repetir la sincronización no duplica y avanza la marca de tiempo", async () => {
    const { syncMailbox } = await import("../../supabase/functions/_shared/mailSync.ts");
    const { tables, supabase, mailbox } = setup();
    await syncMailbox(supabase, mailbox as any, Date.now() + 10_000);
    const count = tables.contact_emails.length;
    const again = await syncMailbox(supabase, { ...mailbox, ...tables.staff_mailboxes[0] } as any, Date.now() + 10_000);
    expect(tables.contact_emails.length).toBe(count);
    expect(again.stored).toBe(0);
    expect(tables.staff_mailboxes[0]).toMatchObject({ inbox_synced_until: iso(30), sent_synced_until: iso(10), status: "active", last_error: null });
  });

  it("pide los correos a Outlook con ids inmutables y solo desde la última vez", async () => {
    const { syncMailbox } = await import("../../supabase/functions/_shared/mailSync.ts");
    const { supabase, mailbox } = setup();
    await syncMailbox(supabase, { ...mailbox, inbox_synced_until: iso(35) } as any, Date.now() + 10_000);
    const list = graph.fetchMock.mock.calls.find(c => String(c[0]).includes("/mailFolders/inbox/"))!;
    expect(decodeURIComponent(String(list[0]))).toContain(`receivedDateTime ge ${iso(40)}`); // 5 min de margen
    expect((list[1] as RequestInit).headers).toMatchObject({ Prefer: 'IdType="ImmutableId"', Authorization: "Bearer AT" });
  });
});
