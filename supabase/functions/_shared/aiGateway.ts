// One way to ask the AI gateway for JSON (Lovable AI, key LOVABLE_API_KEY).

export type AiResult<T> =
  | { ok: true; data: T; model: string }
  | { ok: false; status: number; error: string };

export function extractJson(raw: string): unknown {
  const text = raw.replace(/```json?|```/g, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

export async function askJson<T = unknown>(input: { model: string; system: string; prompt: string; apiKey?: string }): Promise<AiResult<T>> {
  const apiKey = input.apiKey ?? Deno.env.get('LOVABLE_API_KEY');
  if (!apiKey) return { ok: false, status: 500, error: 'Falta LOVABLE_API_KEY' };
  let response: Response;
  try {
    response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: input.model,
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.prompt },
        ],
      }),
    });
  } catch (err) {
    return { ok: false, status: 502, error: err instanceof Error ? err.message : 'La IA no respondió' };
  }
  if (response.status === 429) return { ok: false, status: 429, error: 'Demasiadas solicitudes a la IA, intenta en un momento' };
  if (response.status === 402) return { ok: false, status: 402, error: 'Se acabaron los créditos de IA' };
  if (!response.ok) {
    console.error('AI gateway error:', response.status, (await response.text()).slice(0, 500));
    return { ok: false, status: 502, error: 'La IA no respondió' };
  }
  const result = await response.json();
  const data = extractJson(result.choices?.[0]?.message?.content ?? '');
  if (data === null) return { ok: false, status: 502, error: 'La IA respondió en un formato inválido' };
  return { ok: true, data: data as T, model: input.model };
}
