// Scheduled tasks: one endpoint, tasks addressed by name. pg_cron (or an
// external cron) POSTs {"task": "<name>", "trigger": "<who>"} with the
// x-cron-secret header. Adding a task = one entry in SCHEDULED_TASKS plus one
// cron.schedule() row calling public.invoke_scheduled_task('<name>').

export interface TaskContext {
  // deno-lint-ignore no-explicit-any
  supabase: any
  trigger: string
}

export type ScheduledTask = (ctx: TaskContext) => Promise<Record<string, unknown>>

// Test task: proves the whole chain (cron → HTTP → function → database) works.
export const heartbeat: ScheduledTask = async ({ supabase, trigger }) => {
  const ranAt = new Date().toISOString()
  const { error } = await supabase.from('health_logs').insert({
    workshop_id: null,
    event_type: 'info',
    category: 'cron',
    message: 'Latido de tareas programadas',
    metadata: { task: 'heartbeat', trigger, ran_at: ranAt },
  })
  if (error) throw new Error(`heartbeat insert failed: ${error.message}`)
  return { ran_at: ranAt }
}

export const SCHEDULED_TASKS: Record<string, ScheduledTask> = {
  heartbeat,
}

export interface HandlerDeps {
  // deno-lint-ignore no-explicit-any
  supabase: any
  tasks: Record<string, ScheduledTask>
  verifySecret: (token: string) => Promise<boolean>
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

export function createScheduledTasksHandler({ supabase, tasks, verifySecret }: HandlerDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

    const token = req.headers.get('x-cron-secret') || ''
    let authorized = false
    try {
      authorized = token.length > 0 && await verifySecret(token)
    } catch (err) {
      console.error('Cron secret verification failed:', err)
      return json(500, { error: 'Secret verification unavailable' })
    }
    if (!authorized) return json(401, { error: 'Unauthorized' })

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return json(400, { error: 'Invalid JSON body' })
    }

    const name = typeof body.task === 'string' ? body.task : ''
    const task = Object.hasOwn(tasks, name) ? tasks[name] : undefined
    if (!task) return json(400, { error: `Unknown task: ${name || '(none)'}` })

    const trigger = typeof body.trigger === 'string' ? body.trigger.slice(0, 40) : 'unknown'
    const startedAt = Date.now()
    try {
      const result = await task({ supabase, trigger })
      const durationMs = Date.now() - startedAt
      console.log('Scheduled task done:', { task: name, trigger, durationMs })
      return json(200, { ok: true, task: name, duration_ms: durationMs, result })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('Scheduled task failed:', { task: name, trigger, message })
      try {
        await supabase.from('health_logs').insert({
          workshop_id: null,
          event_type: 'error',
          category: 'cron',
          message: `Tarea programada falló: ${name}`,
          metadata: { task: name, trigger, error: message.slice(0, 1000) },
        })
      } catch (logErr) {
        console.error('Failed to log scheduled task failure:', logErr)
      }
      return json(500, { ok: false, task: name, error: message })
    }
  }
}
