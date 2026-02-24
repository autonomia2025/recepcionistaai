import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    try {
        const { contact_id } = await req.json();
        if (!contact_id) {
            throw new Error('contact_id is required');
        }

        // --- Auth check ---
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            return new Response(JSON.stringify({ error: 'Missing authorization' }), {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');

        // Verify caller identity
        const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
            global: { headers: { Authorization: authHeader } },
        });
        const { data: { user }, error: userError } = await userClient.auth.getUser();
        if (userError || !user) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Get caller profile for permission check
        const { data: callerProfile } = await supabase
            .from('profiles')
            .select('role, workshop_id')
            .eq('id', user.id)
            .single();

        if (!callerProfile) {
            return new Response(JSON.stringify({ error: 'Profile not found' }), {
                status: 403,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // 1. Fetch contact details
        const { data: contact, error: contactError } = await supabase
            .from('contacts')
            .select('workshop_id, name')
            .eq('id', contact_id)
            .single();

        if (contactError || !contact) {
            throw new Error('Contact not found');
        }

        // Permission check: must be SUPERADMIN or same workshop
        if (callerProfile.role !== 'SUPERADMIN' && callerProfile.workshop_id !== contact.workshop_id) {
            return new Response(JSON.stringify({ error: 'Access denied: wrong workshop' }), {
                status: 403,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // 2. Fetch conversation history
        const { data: latestConv } = await supabase
            .from('conversations')
            .select('id')
            .eq('contact_id', contact_id)
            .order('last_message_at', { ascending: false })
            .limit(1)
            .single();

        if (!latestConv) {
            return new Response(JSON.stringify({ success: false, message: 'No conversation found' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const { data: messages, error: messagesError } = await supabase
            .from('messages')
            .select('text, direction, created_at')
            .eq('workshop_id', contact.workshop_id)
            .eq('conversation_id', latestConv.id)
            .order('created_at', { ascending: true });

        if (messagesError) throw messagesError;
        if (!messages || messages.length === 0) {
            return new Response(JSON.stringify({ success: false, message: 'No conversation history found' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const historyText = messages
            .map(m => `${m.direction === 'inbound' ? 'Cliente' : 'Asistente'}: ${m.text}`)
            .join('\n');

        // 3. Call AI via Lovable gateway
        const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${lovableApiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'openai/gpt-5-mini',
                messages: [
                    {
                        role: 'system',
                        content: `Eres un asistente de ventas experto en extraer información estructurada de conversaciones para generar cotizaciones. 
Analiza la conversación y extrae una lista de productos o servicios que el cliente ha solicitado cotizar.

Para cada ítem, identifica:
- product_name: Nombre claro del producto o servicio.
- quantity: Cantidad (default 1).
- unit: Unidad (unidades, litros, horas, etc.).
- duration: Si aplica (ej: "2 días", "por mes").
- location: Ubicación si se menciona.
- specifications: Objeto JSON con detalles técnicos (ej: { "modelo": "X", "marca": "Y" }).
- unit_price: Precio unitario si se mencionó (0 si no se sabe).
- total_price: Precio total si se mencionó (0 si no se sabe).

Responde ÚNICAMENTE con un JSON: { "items": [...] }`
                    },
                    {
                        role: 'user',
                        content: `Historial de chat:\n${historyText}`
                    }
                ],
                temperature: 0,
                response_format: { type: "json_object" }
            }),
        });

        const aiData = await aiResponse.json();
        console.log('AI response status:', aiResponse.status, 'has choices:', !!aiData?.choices);
        
        if (!aiResponse.ok || !aiData?.choices?.[0]?.message?.content) {
            console.error('AI gateway error:', JSON.stringify(aiData));
            throw new Error('AI gateway returned invalid response: ' + (aiData?.error?.message || aiResponse.status));
        }
        
        const result = JSON.parse(aiData.choices[0].message.content);
        const items = Array.isArray(result) ? result : (result.items || []);

        if (items.length === 0) {
            return new Response(JSON.stringify({ success: false, message: 'No products found to quote' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // 4. Delete existing pending quotation items for this contact
        await supabase
            .from('quotation_items')
            .delete()
            .eq('contact_id', contact_id)
            .eq('status', 'pending');

        // 5. Insert new items
        const itemsToInsert = items.map((item: any) => ({
            workshop_id: contact.workshop_id,
            contact_id: contact_id,
            conversation_id: latestConv.id,
            product_name: item.product_name || 'Servicio/Producto',
            quantity: item.quantity || 1,
            unit: item.unit || 'unidad',
            duration: item.duration || null,
            location: item.location || null,
            specifications: item.specifications || {},
            unit_price: item.unit_price || 0,
            total_price: item.total_price || (item.unit_price * (item.quantity || 1)) || 0,
            confidence: 0.9,
            status: 'pending'
        }));

        const { error: insertError } = await supabase
            .from('quotation_items')
            .insert(itemsToInsert);

        if (insertError) throw insertError;

        return new Response(JSON.stringify({ success: true, items_count: itemsToInsert.length }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });

    } catch (error) {
        console.error('Error generating manual quote:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
});
