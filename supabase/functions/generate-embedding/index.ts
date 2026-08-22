import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// bot_knowledge.embedding is vector(768) -> ask the model for 768 dims.
const EMBEDDING_MODEL = 'openai/text-embedding-3-small';
const EMBEDDING_DIMS = 768;
const MAX_CHARS = 24000; // ~8k tokens safety cap per input

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text } = await req.json();

    if (!text || typeof text !== 'string' || !text.trim()) {
      return new Response(JSON.stringify({ error: 'Missing text field' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!apiKey) {
      console.error('Missing LOVABLE_API_KEY');
      return new Response(JSON.stringify({ error: 'Missing LOVABLE_API_KEY' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const input = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;

    const res = await fetch('https://ai.gateway.lovable.dev/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input,
        dimensions: EMBEDDING_DIMS,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Embedding gateway error:', res.status, errText);
      return new Response(JSON.stringify({ error: errText, status: res.status }), {
        status: res.status === 429 || res.status >= 500 ? res.status : 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const json = await res.json();
    const embedding = json?.data?.[0]?.embedding ?? null;

    if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMS) {
      console.error('Unexpected embedding shape:', embedding?.length);
      return new Response(JSON.stringify({ error: 'Invalid embedding response' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, embedding, model: EMBEDDING_MODEL }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('Generate embedding error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
