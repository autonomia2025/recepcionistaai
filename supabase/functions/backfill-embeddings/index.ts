import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await req.json().catch(() => ({}));
    const workshopId = body.workshop_id || null; // optional: limit to one workshop
    const batchSize = body.batch_size || 20;
    const delayMs = body.delay_ms || 300;

    // Find chunks without embeddings
    let query = supabase
      .from('bot_knowledge')
      .select('id, content, workshop_id, file_name')
      .is('embedding', null)
      .order('created_at', { ascending: true })
      .limit(batchSize);

    if (workshopId) {
      query = query.eq('workshop_id', workshopId);
    }

    const { data: chunks, error: fetchError } = await query;

    if (fetchError) {
      throw new Error(`Fetch error: ${fetchError.message}`);
    }

    if (!chunks || chunks.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No chunks pending embedding generation',
        processed: 0,
        remaining: 0,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Processing ${chunks.length} chunks without embeddings`);

    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    for (const chunk of chunks) {
      try {
        // Call generate-embedding function
        const embResponse = await fetch(`${supabaseUrl}/functions/v1/generate-embedding`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text: chunk.content }),
        });

        if (!embResponse.ok) {
          const errText = await embResponse.text();
          console.error(`Embedding failed for chunk ${chunk.id}:`, embResponse.status, errText);
          errors.push(`${chunk.id}: ${embResponse.status}`);
          errorCount++;

          // If rate limited, wait longer
          if (embResponse.status === 429) {
            console.log('Rate limited, waiting 5s...');
            await new Promise(r => setTimeout(r, 5000));
          }
          continue;
        }

        const embResult = await embResponse.json();
        const embedding = embResult.embedding;

        if (!embedding) {
          errors.push(`${chunk.id}: no embedding returned`);
          errorCount++;
          continue;
        }

        // Update the chunk with the embedding
        const { error: updateError } = await supabase
          .from('bot_knowledge')
          .update({ embedding: `[${embedding.join(',')}]` })
          .eq('id', chunk.id);

        if (updateError) {
          console.error(`Update failed for chunk ${chunk.id}:`, updateError);
          errors.push(`${chunk.id}: update failed`);
          errorCount++;
        } else {
          successCount++;
          console.log(`✓ Chunk ${chunk.id} (${chunk.file_name}) embedded`);
        }

        // Delay between requests
        await new Promise(r => setTimeout(r, delayMs));
      } catch (chunkErr) {
        console.error(`Error processing chunk ${chunk.id}:`, chunkErr);
        errors.push(`${chunk.id}: ${chunkErr instanceof Error ? chunkErr.message : 'unknown'}`);
        errorCount++;
      }
    }

    // Count remaining
    let remainingQuery = supabase
      .from('bot_knowledge')
      .select('id', { count: 'exact', head: true })
      .is('embedding', null);

    if (workshopId) {
      remainingQuery = remainingQuery.eq('workshop_id', workshopId);
    }

    const { count: remaining } = await remainingQuery;

    return new Response(JSON.stringify({
      success: true,
      processed: successCount,
      errors: errorCount,
      remaining: remaining || 0,
      error_details: errors.length > 0 ? errors : undefined,
      message: remaining && remaining > 0
        ? `Processed ${successCount}/${chunks.length}. Call again to continue (${remaining} remaining).`
        : `All done! ${successCount} embeddings generated.`,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('Backfill error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
