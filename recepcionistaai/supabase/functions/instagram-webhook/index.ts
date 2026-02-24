import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  console.log("=== Instagram Webhook Request ===");
  console.log("Method:", req.method);
  console.log("URL:", req.url);
  
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Handle webhook verification from Meta
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    console.log("Verification request - mode:", mode, "token:", token);

    // Get verify token from environment or use default
    const verifyToken = Deno.env.get('INSTAGRAM_VERIFY_TOKEN') || 'instagram_webhook_verify';

    if (mode === 'subscribe' && token === verifyToken) {
      console.log("Webhook verified successfully");
      return new Response(challenge, { status: 200 });
    } else {
      console.log("Webhook verification failed");
      return new Response('Forbidden', { status: 403 });
    }
  }

  // Handle POST (incoming messages)
  if (req.method === 'POST') {
    try {
      const body = await req.json();
      console.log("Webhook body:", JSON.stringify(body, null, 2));

      // Instagram webhook structure
      const entry = body.entry?.[0];
      if (!entry) {
        console.log("No entry in webhook body");
        return new Response('OK', { status: 200, headers: corsHeaders });
      }

      const messaging = entry.messaging?.[0];
      if (!messaging) {
        console.log("No messaging in entry");
        return new Response('OK', { status: 200, headers: corsHeaders });
      }

      // Extract message details
      const senderId = messaging.sender?.id; // IGSID (Instagram-scoped ID)
      const recipientId = messaging.recipient?.id; // Page/Business ID
      const messageText = messaging.message?.text;
      const timestamp = messaging.timestamp;

      if (!senderId || !messageText) {
        console.log("Missing sender or message text");
        return new Response('OK', { status: 200, headers: corsHeaders });
      }

      console.log(`Instagram message from ${senderId} to ${recipientId}: ${messageText}`);

      // Find workshop by Instagram page ID
      const { data: workshop, error: workshopError } = await supabase
        .from('workshops')
        .select('*')
        .eq('instagram_page_id', recipientId)
        .eq('instagram_connected', true)
        .single();

      if (workshopError || !workshop) {
        console.error("Workshop not found for Instagram page:", recipientId);
        return new Response('OK', { status: 200, headers: corsHeaders });
      }

      console.log("Found workshop:", workshop.name);

      // Find or create contact using IGSID
      let contact;
      const { data: existingContact, error: contactFetchError } = await supabase
        .from('contacts')
        .select('*')
        .eq('workshop_id', workshop.id)
        .eq('instagram_id', senderId)
        .maybeSingle();

      if (contactFetchError) {
        console.error("Error fetching contact:", contactFetchError);
        return new Response('OK', { status: 200, headers: corsHeaders });
      }

      if (existingContact) {
        contact = existingContact;
        console.log("Found existing contact:", contact.name);
      } else {
        // Create new contact for Instagram user
        const { data: newContact, error: createContactError } = await supabase
          .from('contacts')
          .insert({
            workshop_id: workshop.id,
            instagram_id: senderId,
            name: `Instagram User ${senderId.slice(-4)}`,
            source: 'instagram',
          })
          .select()
          .single();

        if (createContactError) {
          console.error("Error creating contact:", createContactError);
          return new Response('OK', { status: 200, headers: corsHeaders });
        }

        contact = newContact;
        console.log("Created new contact:", contact.id);
      }

      // Staff assignment function
      async function getStaffForAssignment(workshopId: string): Promise<string | null> {
        const { data: staffMembers, error: staffError } = await supabase
          .from('profiles')
          .select('id')
          .eq('workshop_id', workshopId)
          .eq('role', 'staff')
          .eq('is_active', true);

        if (staffError || !staffMembers || staffMembers.length === 0) {
          return null;
        }

        // Get conversation counts per staff
        const staffIds = staffMembers.map(s => s.id);
        const { data: conversations, error: convError } = await supabase
          .from('conversations')
          .select('assigned_to')
          .in('assigned_to', staffIds)
          .in('status', ['new', 'in_progress']);

        if (convError) {
          return staffMembers[0].id;
        }

        // Count per staff
        const counts: Record<string, number> = {};
        staffIds.forEach(id => counts[id] = 0);
        conversations?.forEach(c => {
          if (c.assigned_to) counts[c.assigned_to] = (counts[c.assigned_to] || 0) + 1;
        });

        // Return staff with lowest count
        let minStaff = staffIds[0];
        let minCount = counts[minStaff];
        staffIds.forEach(id => {
          if (counts[id] < minCount) {
            minCount = counts[id];
            minStaff = id;
          }
        });

        return minStaff;
      }

      // Find or create conversation
      let conversation;
      const { data: existingConv, error: convFetchError } = await supabase
        .from('conversations')
        .select('*')
        .eq('contact_id', contact.id)
        .eq('workshop_id', workshop.id)
        .in('status', ['new', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingConv) {
        conversation = existingConv;
        console.log("Found existing conversation:", conversation.id);
      } else {
        // Try to reopen closed conversation or create new
        const { data: closedConv } = await supabase
          .from('conversations')
          .select('*')
          .eq('contact_id', contact.id)
          .eq('workshop_id', workshop.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (closedConv) {
          // Reopen conversation
          const assignee = closedConv.assigned_to || await getStaffForAssignment(workshop.id);
          const { data: reopened, error: reopenError } = await supabase
            .from('conversations')
            .update({
              status: 'in_progress',
              assigned_to: assignee,
              bot_paused: false,
            })
            .eq('id', closedConv.id)
            .select()
            .single();

          if (reopenError) {
            console.error("Error reopening conversation:", reopenError);
            return new Response('OK', { status: 200, headers: corsHeaders });
          }
          conversation = reopened;
          console.log("Reopened conversation:", conversation.id);
        } else {
          // Create new conversation
          const assignee = await getStaffForAssignment(workshop.id);
          const { data: newConv, error: createConvError } = await supabase
            .from('conversations')
            .insert({
              workshop_id: workshop.id,
              contact_id: contact.id,
              channel: 'instagram',
              status: 'new',
              assigned_to: assignee,
            })
            .select()
            .single();

          if (createConvError) {
            console.error("Error creating conversation:", createConvError);
            return new Response('OK', { status: 200, headers: corsHeaders });
          }
          conversation = newConv;
          console.log("Created new conversation:", conversation.id);
        }
      }

      // Insert message
      const { error: msgError } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversation.id,
          text: messageText,
          direction: 'inbound',
          channel: 'instagram',
        });

      if (msgError) {
        console.error("Error inserting message:", msgError);
        return new Response('OK', { status: 200, headers: corsHeaders });
      }

      // Update conversation timestamp
      await supabase
        .from('conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', conversation.id);

      console.log("Message saved successfully");

      // Check if bot is enabled and not paused
      if (!workshop.bot_enabled || conversation.bot_paused) {
        console.log("Bot disabled or paused, not generating AI reply");
        return new Response('OK', { status: 200, headers: corsHeaders });
      }

      // ============= MESSAGE BATCHING (8-second window) =============
      const BATCH_WINDOW_MS = 8000;
      const now = new Date();
      const windowStart = new Date(now.getTime() - BATCH_WINDOW_MS);

      // Check for existing batch
      const { data: existingBatch } = await supabase
        .from('message_batches')
        .select('*')
        .eq('conversation_id', conversation.id)
        .eq('is_completed', false)
        .gte('created_at', windowStart.toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingBatch && !existingBatch.is_processing) {
        // Reset timer by updating the batch
        console.log("Message added to existing batch, resetting timer:", existingBatch.id);
        await supabase
          .from('message_batches')
          .update({ updated_at: now.toISOString() })
          .eq('id', existingBatch.id);
        return new Response('OK', { status: 200, headers: corsHeaders });
      }

      if (existingBatch && existingBatch.is_processing) {
        // Stale batch recovery (2 minutes)
        const processingStart = new Date(existingBatch.updated_at);
        const twoMinutesAgo = new Date(now.getTime() - 120000);

        if (processingStart < twoMinutesAgo) {
          console.log("Recovering stale batch:", existingBatch.id);
          await supabase
            .from('message_batches')
            .update({ is_processing: false, updated_at: now.toISOString() })
            .eq('id', existingBatch.id);
        } else {
          console.log("Batch is processing, skipping");
          return new Response('OK', { status: 200, headers: corsHeaders });
        }
      }

      // Create new batch if none exists
      if (!existingBatch) {
        const { error: batchError } = await supabase
          .from('message_batches')
          .insert({
            conversation_id: conversation.id,
            is_processing: false,
            is_completed: false,
          });

        if (batchError) {
          console.error("Error creating batch:", batchError);
        }
        console.log("Created new message batch, waiting for timer...");
        return new Response('OK', { status: 200, headers: corsHeaders });
      }

      // Check if batch window has expired (ready to process)
      const batchCreatedAt = new Date(existingBatch.created_at);
      const batchAge = now.getTime() - batchCreatedAt.getTime();

      if (batchAge < BATCH_WINDOW_MS) {
        console.log(`Batch not ready yet (${batchAge}ms < ${BATCH_WINDOW_MS}ms)`);
        return new Response('OK', { status: 200, headers: corsHeaders });
      }

      // Claim the batch for processing
      const { data: claimedBatch, error: claimError } = await supabase
        .from('message_batches')
        .update({ is_processing: true, updated_at: now.toISOString() })
        .eq('id', existingBatch.id)
        .eq('is_processing', false)
        .select()
        .single();

      if (claimError || !claimedBatch) {
        console.log("Failed to claim batch (already claimed by another worker)");
        return new Response('OK', { status: 200, headers: corsHeaders });
      }

      console.log("Claimed batch for processing:", claimedBatch.id);

      // Fetch recent inbound messages from batch window
      const { data: recentMessages, error: recentMsgError } = await supabase
        .from('messages')
        .select('text, created_at')
        .eq('conversation_id', conversation.id)
        .eq('direction', 'inbound')
        .gte('created_at', batchCreatedAt.toISOString())
        .order('created_at', { ascending: true });

      if (recentMsgError) {
        console.error("Error fetching recent messages:", recentMsgError);
        await supabase
          .from('message_batches')
          .update({ is_processing: false })
          .eq('id', claimedBatch.id);
        return new Response('OK', { status: 200, headers: corsHeaders });
      }

      // Combine messages
      const combinedMessage = recentMessages?.map(m => m.text).join('\n') || messageText;
      console.log("Combined message for AI:", combinedMessage);

      // Call AI reply function
      try {
        const aiResponse = await fetch(`${supabaseUrl}/functions/v1/build-ai-reply`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            workshop_id: workshop.id,
            conversation_id: conversation.id,
            user_message: combinedMessage,
          }),
        });

        if (!aiResponse.ok) {
          const errorText = await aiResponse.text();
          console.error("AI reply error:", aiResponse.status, errorText);
          throw new Error(`AI reply failed: ${aiResponse.status}`);
        }

        const aiResult = await aiResponse.json();
        console.log("AI reply result:", aiResult);

        if (aiResult.reply) {
          // Send reply via Instagram
          const sendResponse = await fetch(`${supabaseUrl}/functions/v1/send-instagram`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({
              conversation_id: conversation.id,
              text: aiResult.reply,
            }),
          });

          if (!sendResponse.ok) {
            console.error("Send Instagram error:", await sendResponse.text());
          } else {
            console.log("Instagram reply sent successfully");
          }
        }
      } catch (aiError) {
        console.error("Error calling AI:", aiError);
      }

      // Mark batch as completed
      await supabase
        .from('message_batches')
        .update({ is_completed: true, is_processing: false })
        .eq('id', claimedBatch.id);

      // Trigger async analysis
      fetch(`${supabaseUrl}/functions/v1/analyze-conversation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({ conversation_id: conversation.id }),
      }).catch(e => console.log("Async analysis triggered"));

      return new Response('OK', { status: 200, headers: corsHeaders });
    } catch (error) {
      console.error("Instagram webhook error:", error);
      return new Response('OK', { status: 200, headers: corsHeaders });
    }
  }

  return new Response('Method not allowed', { status: 405, headers: corsHeaders });
});