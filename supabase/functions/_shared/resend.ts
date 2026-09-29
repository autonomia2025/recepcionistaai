// Minimal Resend API client (https://resend.com/docs/api-reference).
// The key lives in the RESEND_API_KEY secret of the project.

const API = 'https://api.resend.com';

export interface ResendResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

export async function resendRequest<T = Record<string, unknown>>(
  path: string,
  init: { method?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<ResendResult<T>> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) return { ok: false, status: 500, data: null, error: 'Falta configurar RESEND_API_KEY' };

  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (err) {
    return { ok: false, status: 0, data: null, error: err instanceof Error ? err.message : 'Sin conexión con Resend' };
  }

  const text = await response.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }

  if (!response.ok) {
    const message = (parsed as { message?: string } | null)?.message ?? (text.slice(0, 300) || `HTTP ${response.status}`);
    return { ok: false, status: response.status, data: null, error: message };
  }
  return { ok: true, status: response.status, data: parsed as T, error: null };
}

export interface ResendDomainRecord {
  record: string;
  name: string;
  type: string;
  value: string;
  ttl?: string;
  status?: string;
  priority?: number;
}

export interface ResendDomain {
  id: string;
  name: string;
  status: string;
  region?: string;
  capabilities?: { sending?: string; receiving?: string };
  records?: ResendDomainRecord[];
}
