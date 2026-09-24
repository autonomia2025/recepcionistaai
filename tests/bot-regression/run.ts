// Bot regression: replays real conversations against the deployed
// build-ai-reply in dry_run mode (nothing is written to the database) and
// compares every turn with a saved baseline.
//
//   bun run bot:regression capture [--contact "JT"] [--contact "José Luis"]
//   bun run bot:regression [--max-turns 20] [--save-baseline]
//
// Needs a SUPERADMIN login in the environment (never commit it):
//   BOT_REGRESSION_EMAIL=... BOT_REGRESSION_PASSWORD=... bun run bot:regression
//
// Real conversations contain customer data, so fixtures and results live in
// tests/bot-regression/.data/, which is git-ignored.

import { createClient } from "@supabase/supabase-js";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { findInventedCodes, extractQuotedCodes } from "../../supabase/functions/_shared/catalog.ts";
import { normalizeProductCode } from "../../supabase/functions/_shared/datasheets.ts";

const DATA_DIR = join(import.meta.dir, ".data");
const FIXTURES = join(DATA_DIR, "fixtures.json");
const BASELINE = join(DATA_DIR, "baseline.json");
const DEFAULT_CONTACTS = ["JT", "José Luis"];
const GENERIC_FALLBACK = "Un asesor te contactará pronto";
const CALL_TIMEOUT_MS = 90_000;

type Direction = "inbound" | "outbound";
interface HistoryMessage { direction: Direction; text: string }
interface Turn {
  index: number;
  message_text: string;            // inbound messages of the turn, joined like whatsapp-webhook does
  history: HistoryMessage[];       // everything before the turn
  real_replies: string[];          // what production actually sent back then
}
interface FixtureConversation {
  conversation_id: string;
  workshop_id: string;
  contact_name: string;
  turns: Turn[];
}
interface TurnResult {
  key: string;
  conversation_id: string;
  contact_name: string;
  turn: number;
  message_text: string;
  ok: boolean;
  failures: string[];
  warnings: string[];
  status: number;
  replies: string[];
  intent?: string;
  should_handoff?: boolean;
  codes: string[];
  conversation_state?: unknown;
  layer?: string;
  catalog_driven?: boolean;
  detected_zone?: string | null;
  real_replies: string[];
  ms: number;
}

// ---- args / env -----------------------------------------------------------------
const args = process.argv.slice(2);
const command = args[0] === "capture" ? "capture" : "run";
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const values: string[] = [];
  args.forEach((arg, i) => { if (arg === `--${name}` && args[i + 1]) values.push(args[i + 1]); });
  return values;
};

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const EMAIL = process.env.BOT_REGRESSION_EMAIL;
const PASSWORD = process.env.BOT_REGRESSION_PASSWORD;

function die(message: string): never {
  console.error(`\n✖ ${message.length > 300 ? `${message.slice(0, 300)}…` : message}\n`);
  process.exit(2);
}

if (!SUPABASE_URL || !ANON_KEY) die("Faltan VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY (se leen del .env).");
if (!EMAIL || !PASSWORD) die("Faltan BOT_REGRESSION_EMAIL y BOT_REGRESSION_PASSWORD (cuenta SUPERADMIN).");

const supabase = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

async function login(): Promise<string> {
  const { data, error } = await supabase.auth.signInWithPassword({ email: EMAIL!, password: PASSWORD! });
  if (error || !data.session) die(`No se pudo iniciar sesión: ${error?.message ?? "sin sesión"}`);
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  if (profile?.role !== "SUPERADMIN") die("La cuenta debe ser SUPERADMIN (el modo prueba del bot lo exige).");
  return data.session.access_token;
}

// ---- capture ----------------------------------------------------------------------
function buildTurns(messages: HistoryMessage[]): Turn[] {
  const turns: Turn[] = [];
  let i = 0;
  while (i < messages.length) {
    if (messages[i].direction !== "inbound") { i++; continue; }
    const start = i;
    const inbound: string[] = [];
    while (i < messages.length && messages[i].direction === "inbound") inbound.push(messages[i++].text);
    const replies: string[] = [];
    while (i < messages.length && messages[i].direction === "outbound") replies.push(messages[i++].text);
    turns.push({
      index: turns.length,
      message_text: inbound.length > 1 ? inbound.join(" | ") : inbound[0],
      history: messages.slice(Math.max(0, start - 30), start),
      real_replies: replies,
    });
  }
  return turns;
}

async function capture() {
  await login();
  const patterns = option("contact").length > 0 ? option("contact") : DEFAULT_CONTACTS;
  const conversations: FixtureConversation[] = [];

  for (const pattern of patterns) {
    const { data: contacts, error } = await supabase
      .from("contacts").select("id, name, workshop_id").ilike("name", `%${pattern}%`);
    if (error) die(`Error leyendo contactos: ${error.message}`);
    if (!contacts?.length) { console.warn(`⚠ Ningún contacto calza con "${pattern}"`); continue; }

    for (const contact of contacts) {
      const { data: convs } = await supabase
        .from("conversations").select("id, workshop_id").eq("contact_id", contact.id);
      for (const conv of convs ?? []) {
        const { data: rows, error: msgError } = await supabase
          .from("messages").select("direction, text, created_at")
          .eq("conversation_id", conv.id).order("created_at", { ascending: true }).limit(2000);
        if (msgError) die(`Error leyendo mensajes: ${msgError.message}`);
        const messages = (rows ?? [])
          .filter((m) => typeof m.text === "string" && m.text.trim().length > 0)
          .map((m) => ({ direction: m.direction as Direction, text: m.text as string }));
        const turns = buildTurns(messages);
        if (turns.length === 0) continue;
        conversations.push({ conversation_id: conv.id, workshop_id: conv.workshop_id, contact_name: contact.name, turns });
        console.log(`✓ ${contact.name}: conversación ${conv.id.slice(0, 8)}, ${turns.length} turnos`);
      }
    }
  }

  if (conversations.length === 0) die("No se capturó ninguna conversación.");
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FIXTURES, JSON.stringify({ captured_at: new Date().toISOString(), conversations }, null, 2));
  console.log(`\nGuardado en ${FIXTURES} (${conversations.reduce((n, c) => n + c.turns.length, 0)} turnos).`);
}

// ---- run --------------------------------------------------------------------------
const normalize = (text: string) => (text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

async function callBot(token: string, body: Record<string, unknown>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/build-ai-reply`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json: Record<string, any> = {};
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
    return { status: res.status, json };
  } catch (error) {
    return { status: 0, json: { error: error instanceof Error ? error.message : String(error) } };
  } finally {
    clearTimeout(timer);
  }
}

async function replayConversation(token: string, conv: FixtureConversation, maxTurns: number, catalog: Set<string>): Promise<TurnResult[]> {
  const results: TurnResult[] = [];
  let state: unknown = {};
  let zone: string | null = null;

  for (const turn of conv.turns.slice(0, maxTurns)) {
    const started = Date.now();
    const { status, json } = await callBot(token, {
      workshop_id: conv.workshop_id,
      message_text: turn.message_text,
      contact_name: conv.contact_name,
      dry_run: true,
      history: turn.history,
      bot_state: state,
      contact_zone: zone,
      // conversation_id is deliberately omitted: a build-ai-reply without
      // dry_run support rejects the call with 400 before touching anything.
    });

    const failures: string[] = [];
    const warnings: string[] = [];
    const replies: string[] = Array.isArray(json.replies) ? json.replies.map(String) : [];

    if (status === 400 && String(json.error || "").includes("conversation_id")) {
      die("La versión desplegada de build-ai-reply no tiene modo prueba. Pide a Lovable que la despliegue y vuelve a correr.");
    }
    if (status !== 200 || json.success !== true) failures.push(`HTTP ${status}: ${String(json.error ?? json.raw ?? "").slice(0, 160)}`);
    else if (json.dry_run !== true) die("La función respondió sin dry_run: detengo todo por seguridad.");

    if (status === 200) {
      if (replies.length === 0 || replies.some((r) => r.trim().length === 0)) failures.push("respuesta vacía");
      if (json.debug?.parse_fallback) failures.push("la IA devolvió JSON inválido (parse_fallback)");
      if (replies.some((r) => r.includes(GENERIC_FALLBACK))) failures.push("salió el mensaje genérico de respaldo");
      const invented = catalog.size > 0 ? [...new Set(replies.flatMap((r) => findInventedCodes(r, catalog)))] : [];
      if (invented.length > 0) failures.push(`códigos que no existen en el catálogo: ${invented.join(", ")}`);

      const lastBot = [...turn.history].reverse().find((m) => m.direction === "outbound")?.text;
      if (lastBot && replies.some((r) => normalize(r) === normalize(lastBot))) {
        warnings.push("repite textual el mensaje anterior del bot");
      }
      if (json.should_handoff) warnings.push("deriva a un humano");

      state = json.debug?.conversation_state ?? state;
      zone = zone ?? json.debug?.detected_zone ?? null;
    }

    results.push({
      key: `${conv.conversation_id}#${turn.index}`,
      conversation_id: conv.conversation_id,
      contact_name: conv.contact_name,
      turn: turn.index,
      message_text: turn.message_text,
      ok: failures.length === 0,
      failures,
      warnings,
      status,
      replies,
      intent: json.intent,
      should_handoff: json.should_handoff,
      codes: [...new Set(replies.flatMap((r) => extractQuotedCodes(r)).map(normalizeProductCode))].sort(),
      conversation_state: json.debug?.conversation_state,
      layer: json.debug?.layer,
      catalog_driven: json.debug?.catalog_driven,
      detected_zone: json.debug?.detected_zone ?? null,
      real_replies: turn.real_replies,
      ms: Date.now() - started,
    });
    process.stdout.write(failures.length ? "✖" : warnings.length ? "!" : "·");
  }
  return results;
}

function compare(current: TurnResult, base: TurnResult | undefined): string[] {
  if (!base) return ["turno nuevo (no está en la línea base)"];
  const changes: string[] = [];
  // The state is computed by deterministic code: any difference is a code change.
  if (JSON.stringify(current.conversation_state) !== JSON.stringify(base.conversation_state)) {
    changes.push(`estado: ${JSON.stringify(base.conversation_state)} → ${JSON.stringify(current.conversation_state)}`);
  }
  if (current.should_handoff !== base.should_handoff) changes.push(`derivación: ${base.should_handoff} → ${current.should_handoff}`);
  if (current.catalog_driven !== base.catalog_driven) changes.push(`respuesta por catálogo: ${base.catalog_driven} → ${current.catalog_driven}`);
  if (current.intent !== base.intent) changes.push(`intención: ${base.intent} → ${current.intent}`);
  if (JSON.stringify(current.codes) !== JSON.stringify(base.codes)) {
    changes.push(`códigos: [${base.codes.join(", ")}] → [${current.codes.join(", ")}]`);
  }
  if (base.ok && !current.ok) changes.push("antes pasaba y ahora falla");
  return changes;
}

async function run() {
  if (!existsSync(FIXTURES)) die("No hay conversaciones capturadas. Corre primero: bun run bot:regression capture");
  const fixtures = JSON.parse(readFileSync(FIXTURES, "utf8")) as { conversations: FixtureConversation[] };
  const maxTurns = Number(option("max-turns")[0] ?? Infinity);
  const token = await login();

  const workshopIds = [...new Set(fixtures.conversations.map((c) => c.workshop_id))];
  const catalog = new Set<string>();
  for (const workshopId of workshopIds) {
    const { data } = await supabase.from("product_catalog").select("sku_normalized").eq("workshop_id", workshopId).limit(5000);
    for (const row of data ?? []) catalog.add(row.sku_normalized);
  }
  if (catalog.size === 0) console.warn("⚠ No se pudo leer el catálogo: se omite la revisión de códigos inventados.");

  const total = fixtures.conversations.reduce((n, c) => n + Math.min(c.turns.length, maxTurns), 0);
  console.log(`Repitiendo ${total} turnos de ${fixtures.conversations.length} conversaciones (modo prueba, sin escribir en la base)…`);

  const results: TurnResult[] = [];
  const queue = [...fixtures.conversations];
  await Promise.all(Array.from({ length: 2 }, async () => {
    for (let conv = queue.shift(); conv; conv = queue.shift()) {
      results.push(...await replayConversation(token, conv, maxTurns, catalog));
    }
  }));
  console.log("\n");

  const baseline = existsSync(BASELINE)
    ? new Map((JSON.parse(readFileSync(BASELINE, "utf8")).results as TurnResult[]).map((r) => [r.key, r]))
    : null;

  results.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  let failed = 0, warned = 0, changed = 0;
  for (const r of results) {
    const changes = baseline ? compare(r, baseline.get(r.key)) : [];
    if (!r.ok) failed++;
    if (r.warnings.length) warned++;
    if (changes.length) changed++;
    if (r.ok && r.warnings.length === 0 && changes.length === 0) continue;

    console.log(`${r.ok ? (changes.length ? "≠" : "!") : "✖"} ${r.contact_name} · turno ${r.turn}: "${r.message_text.slice(0, 80)}"`);
    for (const f of r.failures) console.log(`    FALLA   ${f}`);
    for (const w of r.warnings) console.log(`    aviso   ${w}`);
    for (const c of changes) console.log(`    cambio  ${c}`);
    console.log(`    bot     ${r.replies.join(" ⏎ ").replace(/\n/g, " ").slice(0, 220)}`);
  }

  mkdirSync(join(DATA_DIR, "runs"), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const report = { ran_at: new Date().toISOString(), total: results.length, failed, warned, changed, results };
  writeFileSync(join(DATA_DIR, "runs", `${stamp}.json`), JSON.stringify(report, null, 2));
  writeFileSync(join(DATA_DIR, "runs", "latest.json"), JSON.stringify(report, null, 2));
  if (flag("save-baseline")) writeFileSync(BASELINE, JSON.stringify(report, null, 2));

  const avg = Math.round(results.reduce((n, r) => n + r.ms, 0) / Math.max(1, results.length));
  console.log(`\nResultado: ${results.length} turnos · ${failed} fallas · ${warned} con aviso · ${baseline ? `${changed} con cambios vs. línea base` : "sin línea base"} · ${avg} ms promedio`);
  console.log(`Detalle: ${join(DATA_DIR, "runs", "latest.json")}`);
  if (flag("save-baseline")) console.log(`Línea base guardada en ${BASELINE}`);
  else if (!baseline) console.log("Para fijar esta corrida como referencia: bun run bot:regression --save-baseline");

  process.exit(failed > 0 ? 1 : 0);
}

await (command === "capture" ? capture() : run());
