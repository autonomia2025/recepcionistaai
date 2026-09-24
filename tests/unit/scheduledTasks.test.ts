import { describe, expect, it } from "vitest";
import { createScheduledTasksHandler, SCHEDULED_TASKS, type ScheduledTask } from "../../supabase/functions/_shared/scheduledTasks.ts";
import { parseFeatures } from "../../supabase/functions/_shared/features.ts";

const SECRET = "s".repeat(64);

function fakeSupabase() {
  const inserted: Array<{ table: string; row: Record<string, unknown> }> = [];
  return {
    inserted,
    client: {
      from: (table: string) => ({
        insert: async (row: Record<string, unknown>) => {
          inserted.push({ table, row });
          return { error: null };
        },
      }),
    },
  };
}

function setup(tasks: Record<string, ScheduledTask> = SCHEDULED_TASKS) {
  const db = fakeSupabase();
  const handler = createScheduledTasksHandler({
    supabase: db.client,
    tasks,
    verifySecret: async (token) => token === SECRET,
  });
  const post = (body: unknown, secret: string | null = SECRET) =>
    handler(new Request("http://local/scheduled-tasks", {
      method: "POST",
      headers: secret === null ? {} : { "x-cron-secret": secret },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }));
  return { db, handler, post };
}

describe("scheduled-tasks", () => {
  it("solo acepta POST", async () => {
    const { handler } = setup();
    expect((await handler(new Request("http://local", { method: "GET" }))).status).toBe(405);
  });

  it("sin secreto o con secreto incorrecto → 401 y no escribe nada", async () => {
    const { db, post } = setup();
    expect((await post({ task: "heartbeat" }, null)).status).toBe(401);
    expect((await post({ task: "heartbeat" }, "otro")).status).toBe(401);
    expect(db.inserted).toHaveLength(0);
  });

  it("JSON inválido, tarea desconocida o del prototipo → 400", async () => {
    const { db, post } = setup();
    expect((await post("{nope")).status).toBe(400);
    expect((await post({ task: "borrar_todo" })).status).toBe(400);
    expect((await post({ task: "constructor" })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect(db.inserted).toHaveLength(0);
  });

  it("heartbeat escribe un latido sin workshop en health_logs", async () => {
    const { db, post } = setup();
    const res = await post({ task: "heartbeat", trigger: "pg_cron" });
    expect(res.status).toBe(200);
    expect(db.inserted).toHaveLength(1);
    expect(db.inserted[0].table).toBe("health_logs");
    expect(db.inserted[0].row).toMatchObject({ workshop_id: null, category: "cron", event_type: "info" });
    expect(db.inserted[0].row.metadata).toMatchObject({ task: "heartbeat", trigger: "pg_cron" });
  });

  it("una tarea que falla responde 500 y deja el error registrado", async () => {
    const { db, post } = setup({ boom: async () => { throw new Error("kaput"); } });
    const res = await post({ task: "boom", trigger: "external" });
    expect(res.status).toBe(500);
    expect(db.inserted[0].row).toMatchObject({ event_type: "error", category: "cron" });
    expect(db.inserted[0].row.metadata).toMatchObject({ task: "boom", error: "kaput" });
  });

  it("si la validación del secreto falla, 500 sin filtrar detalles", async () => {
    const handler = createScheduledTasksHandler({
      supabase: fakeSupabase().client,
      tasks: SCHEDULED_TASKS,
      verifySecret: async () => { throw new Error("db down"); },
    });
    const res = await handler(new Request("http://local", { method: "POST", headers: { "x-cron-secret": SECRET }, body: "{}" }));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("db down");
  });
});

describe("parseFeatures", () => {
  it("solo true explícito activa una función", () => {
    expect(parseFeatures({ zones: true })).toEqual({ zones: true, commercial: false });
    expect(parseFeatures({ zones: "true", commercial: 1 })).toEqual({ zones: false, commercial: false });
    expect(parseFeatures(null)).toEqual({ zones: false, commercial: false });
  });
});
