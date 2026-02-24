import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const twilioAuthToken = Deno.env.get('TWILIO_AUTH_TOKEN');

    if (!twilioAuthToken) {
      console.error('TWILIO_AUTH_TOKEN not configured');
      return new Response('Configuration error', { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Twilio sends form-urlencoded data
    const formData = await req.formData();
    
    const from = formData.get('From') as string; // e.g., whatsapp:+5491112345678
    const to = formData.get('To') as string; // e.g., whatsapp:+14155238886
    const body = formData.get('Body') as string;
    const messageSid = formData.get('MessageSid') as string;
    const accountSid = formData.get('AccountSid') as string;

    console.log('[twilio-webhook] Received message:', { from, to, messageSid, bodyLength: body?.length });

    if (!from || !body) {
      console.error('[twilio-webhook] Missing required fields');
      return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
        headers: { ...corsHeaders, 'Content-Type': 'text/xml' }
      });
    }

    // Extract phone numbers (remove whatsapp: prefix)
    const senderPhone = from.replace('whatsapp:', '');
    const recipientPhone = to.replace('whatsapp:', '');

    // Find workshop by Twilio phone number
    const { data: workshop, error: workshopError } = await supabase
      .from('workshops')
      .select('*')
      .eq('whatsapp_provider', 'twilio')
      .eq('twilio_phone_number', recipientPhone)
      .eq('is_active', true)
      .single();

    if (workshopError || !workshop) {
      console.error('[twilio-webhook] Workshop not found for number:', recipientPhone, workshopError);
      return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
        headers: { ...corsHeaders, 'Content-Type': 'text/xml' }
      });
    }

    console.log('[twilio-webhook] Found workshop:', workshop.id, workshop.name);

    // Find or create contact
    let contact;
    const { data: existingContact } = await supabase
      .from('contacts')
      .select('*')
      .eq('workshop_id', workshop.id)
      .eq('whatsapp_id', senderPhone)
      .single();

    if (existingContact) {
      contact = existingContact;
    } else {
      // Create new contact
      const { data: newContact, error: contactError } = await supabase
        .from('contacts')
        .insert({
          workshop_id: workshop.id,
          whatsapp_id: senderPhone,
          phone: senderPhone,
          name: senderPhone, // Will be updated if they provide name
          lead_score: 50,
        })
        .select()
        .single();

      if (contactError) {
        console.error('[twilio-webhook] Error creating contact:', contactError);
        throw contactError;
      }
      contact = newContact;
      console.log('[twilio-webhook] Created new contact:', contact.id);
    }

    // Helper function to get a staff member for assignment (round-robin)
    const getStaffForAssignment = async (workshopId: string): Promise<string | null> => {
      const { data: staffMembers } = await supabase
        .from('profiles')
        .select('id')
        .eq('workshop_id', workshopId)
        .eq('status', 'active')
        .in('role', ['STAFF', 'ADMIN'])
        .order('created_at', { ascending: true });

      if (!staffMembers || staffMembers.length === 0) {
        return null;
      }

      // Simple round-robin: count conversations per staff and assign to the one with least
      const { data: convCounts } = await supabase
        .from('conversations')
        .select('assigned_to_user_id')
        .eq('workshop_id', workshopId)
        .not('status', 'in', '("closed","lost")');

      const countMap: Record<string, number> = {};
      staffMembers.forEach(s => countMap[s.id] = 0);
      convCounts?.forEach(c => {
        if (c.assigned_to_user_id && countMap[c.assigned_to_user_id] !== undefined) {
          countMap[c.assigned_to_user_id]++;
        }
      });

      // Find staff with minimum conversations
      let minStaff = staffMembers[0].id;
      let minCount = countMap[minStaff] || 0;
      for (const staff of staffMembers) {
        if ((countMap[staff.id] || 0) < minCount) {
          minCount = countMap[staff.id] || 0;
          minStaff = staff.id;
        }
      }

      return minStaff;
    };

    // Find or create conversation
    let conversation;
    const { data: existingConversations } = await supabase
      .from('conversations')
      .select('id, status, assigned_to_user_id, bot_paused')
      .eq('workshop_id', workshop.id)
      .eq('contact_id', contact.id)
      .not('status', 'in', '("closed","lost")')
      .order('created_at', { ascending: false })
      .limit(1);

    if (existingConversations && existingConversations.length > 0) {
      conversation = existingConversations[0] as { id: string; status: string; assigned_to_user_id: string | null; bot_paused: boolean | null };
      console.log('[twilio-webhook] Using existing conversation:', conversation.id, 'status:', conversation.status);
      
      // If conversation has no assignment, assign it now
      if (!conversation.assigned_to_user_id) {
        const staffId = await getStaffForAssignment(workshop.id);
        if (staffId) {
          await supabase
            .from('conversations')
            .update({ assigned_to_user_id: staffId })
            .eq('id', conversation.id);
          console.log('[twilio-webhook] Assigned existing conversation to staff:', staffId);
        }
      }
    } else {
      // Check if there are ANY conversations for this contact (even closed)
      const { data: anyConv } = await supabase
        .from('conversations')
        .select('id, assigned_to_user_id')
        .eq('workshop_id', workshop.id)
        .eq('contact_id', contact.id)
        .order('created_at', { ascending: false })
        .limit(1);

      const staffId = await getStaffForAssignment(workshop.id);

      if (anyConv && anyConv.length > 0) {
        // Reopen the most recent conversation instead of creating a new one
        conversation = anyConv[0] as { id: string; assigned_to_user_id: string | null; bot_paused?: boolean | null };
        const updateData: { status: string; assigned_to_user_id?: string } = { status: 'new' };
        if (!conversation.assigned_to_user_id && staffId) {
          updateData.assigned_to_user_id = staffId;
        }
        await supabase
          .from('conversations')
          .update(updateData)
          .eq('id', conversation.id);
        console.log('[twilio-webhook] Reopened existing conversation:', conversation.id);
      } else {
        // Only create new if contact has no conversations at all
        const { data: newConversation, error: convError } = await supabase
          .from('conversations')
          .insert({
            workshop_id: workshop.id,
            contact_id: contact.id,
            status: 'new',
            last_message_at: new Date().toISOString(),
            assigned_to_user_id: staffId,
          })
          .select('id, bot_paused')
          .single();

        if (convError) {
          console.error('[twilio-webhook] Error creating conversation:', convError);
          throw convError;
        }
        conversation = newConversation as { id: string; bot_paused: boolean | null; assigned_to_user_id?: string | null };
        console.log('[twilio-webhook] Created new conversation:', conversation.id);
      }
    }

    // Insert message
    const { error: messageError } = await supabase
      .from('messages')
      .insert({
        workshop_id: workshop.id,
        conversation_id: conversation.id,
        text: body,
        direction: 'inbound',
        channel: 'whatsapp',
      });

    if (messageError) {
      console.error('[twilio-webhook] Error inserting message:', messageError);
      throw messageError;
    }

    // Update conversation last_message_at
    await supabase
      .from('conversations')
      .update({ last_message_at: new Date().toISOString(), status: 'new' })
      .eq('id', conversation.id);

    console.log('[twilio-webhook] Message saved successfully');

    // Check if bot is enabled and not paused - use batching system
    const isBotPaused = conversation.bot_paused;
    if (workshop.bot_enabled && !isBotPaused) {
      const BATCH_WINDOW_MS = 8000; // 8 second window (same as Meta webhook)
      const STALE_BATCH_TIMEOUT_MS = 120000; // 2 minutes - batch is orphaned if processing takes longer
      const conversationId = conversation.id;

      // Step 1: Check for existing active batch or create one
      const { data: existingBatch } = await supabase
        .from('message_batches')
        .select('id, batch_started_at, last_message_at, message_count, is_processing, created_at')
        .eq('conversation_id', conversationId)
        .eq('is_completed', false)
        .single();

      let batchId: string;

      if (existingBatch) {
        batchId = existingBatch.id;

        // Check if batch is stale/orphaned (processing for too long)
        if (existingBatch.is_processing) {
          const batchCreatedAt = new Date(existingBatch.created_at).getTime();
          const timeSinceCreation = Date.now() - batchCreatedAt;

          if (timeSinceCreation > STALE_BATCH_TIMEOUT_MS) {
            // Batch is orphaned - reset it
            console.log('[twilio-webhook] Detected orphaned batch, resetting:', batchId, 'age:', timeSinceCreation, 'ms');
            await supabase
              .from('message_batches')
              .update({
                is_processing: false,
                last_message_at: new Date().toISOString(),
                message_count: existingBatch.message_count + 1
              })
              .eq('id', batchId);
          } else {
            // Batch is actively being processed by another worker
            console.log('[twilio-webhook] Batch being processed by another worker, message will be included. Batch:', batchId);
            return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
              headers: { ...corsHeaders, 'Content-Type': 'text/xml' }
            });
          }
        } else {
          // Update the last_message_at to reset window
          await supabase
            .from('message_batches')
            .update({
              last_message_at: new Date().toISOString(),
              message_count: existingBatch.message_count + 1
            })
            .eq('id', batchId);

          console.log('[twilio-webhook] Updated batch window, message count:', existingBatch.message_count + 1, 'Batch:', batchId);
        }
      } else {
        // Create new batch
        const { data: newBatch, error: batchError } = await supabase
          .from('message_batches')
          .insert({
            conversation_id: conversationId,
            workshop_id: workshop.id,
            batch_started_at: new Date().toISOString(),
            last_message_at: new Date().toISOString(),
            message_count: 1,
            is_processing: false,
            is_completed: false,
          })
          .select('id')
          .single();

        if (batchError) {
          // If unique constraint error, batch was just created by another request
          if (batchError.code === '23505') {
            console.log('[twilio-webhook] Batch race condition, checking existing...');
            const { data: raceBatch } = await supabase
              .from('message_batches')
              .select('id, is_processing, created_at')
              .eq('conversation_id', conversationId)
              .eq('is_completed', false)
              .single();

            if (raceBatch) {
              // Check for orphaned batch in race condition too
              const batchAge = Date.now() - new Date(raceBatch.created_at).getTime();
              if (raceBatch.is_processing && batchAge <= STALE_BATCH_TIMEOUT_MS) {
                console.log('[twilio-webhook] Batch already processing (race), skipping');
                return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
                  headers: { ...corsHeaders, 'Content-Type': 'text/xml' }
                });
              }
              batchId = raceBatch.id;
            } else {
              console.error('[twilio-webhook] Batch creation failed:', batchError);
              throw batchError;
            }
          } else {
            console.error('[twilio-webhook] Batch creation error:', batchError);
            throw batchError;
          }
        } else {
          batchId = newBatch!.id;
          console.log('[twilio-webhook] Created new batch:', batchId);
        }
      }

      // Step 2: Wait for the full 8-second window
      // But check periodically if new messages arrived (window reset)
      const waitForBatchWindow = async (): Promise<boolean> => {
        const checkInterval = 1000; // Check every 1 second
        let totalWaited = 0;

        while (totalWaited < BATCH_WINDOW_MS * 2) { // Max 16 seconds total
          await new Promise(resolve => setTimeout(resolve, checkInterval));
          totalWaited += checkInterval;

          // Check current batch state
          const { data: currentBatch } = await supabase
            .from('message_batches')
            .select('last_message_at, is_processing, is_completed')
            .eq('id', batchId!)
            .single();

          if (!currentBatch) {
            console.log('[twilio-webhook] Batch no longer exists, aborting');
            return false;
          }

          if (currentBatch.is_completed) {
            console.log('[twilio-webhook] Batch already completed by another worker');
            return false;
          }

          if (currentBatch.is_processing) {
            console.log('[twilio-webhook] Batch being processed by another worker');
            return false;
          }

          // Check if window has passed since last message
          const lastMsgTime = new Date(currentBatch.last_message_at).getTime();
          const timeSinceLastMsg = Date.now() - lastMsgTime;

          if (timeSinceLastMsg >= BATCH_WINDOW_MS) {
            console.log('[twilio-webhook] Batch window completed, time since last msg:', timeSinceLastMsg);
            return true;
          }

          console.log('[twilio-webhook] Waiting for batch window...', timeSinceLastMsg, 'ms elapsed');
        }

        // Safety: if we waited too long, proceed anyway
        console.log('[twilio-webhook] Max wait time reached, proceeding');
        return true;
      };

      const shouldProcess = await waitForBatchWindow();

      if (!shouldProcess) {
        console.log('[twilio-webhook] Not processing this batch (handled elsewhere)');
        return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
          headers: { ...corsHeaders, 'Content-Type': 'text/xml' }
        });
      }

      // Step 3: Try to claim the batch for processing
      const { data: claimResult, error: claimError } = await supabase
        .from('message_batches')
        .update({ is_processing: true })
        .eq('id', batchId!)
        .eq('is_processing', false) // Only claim if not already processing
        .eq('is_completed', false)
        .select('id')
        .single();

      if (claimError || !claimResult) {
        console.log('[twilio-webhook] Failed to claim batch (already claimed):', batchId);
        return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
          headers: { ...corsHeaders, 'Content-Type': 'text/xml' }
        });
      }

      console.log('[twilio-webhook] Claimed batch for processing:', batchId);

      try {
        // Get all messages in this batch window
        const { data: batchMessages } = await supabase
          .from('messages')
          .select('text, direction')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: false })
          .limit(10);

        // Get just the inbound messages (most recent first, so reverse for chronological)
        const recentInbound = batchMessages
          ?.filter(m => m.direction === 'inbound')
          .reverse()
          .map(m => m.text)
          .slice(-5) || []; // Last 5 inbound messages max

        const combinedMessage = recentInbound.join('\n');
        console.log('[twilio-webhook] Combined batch message:', combinedMessage.substring(0, 100));

        // Trigger AI reply with combined message
        const aiResponse = await fetch(`${supabaseUrl}/functions/v1/build-ai-reply`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            conversation_id: conversationId,
            workshop_id: workshop.id,
            message_text: combinedMessage,
            contact_name: contact?.name || senderPhone,
          }),
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          console.log('[twilio-webhook] AI reply generated:', aiData);

          // Handle replies array format from build-ai-reply
          const replyText = Array.isArray(aiData.replies)
            ? aiData.replies.join('\n\n')
            : aiData.reply;

          if (replyText) {
            // Send the reply via send-whatsapp function
            const sendResponse = await fetch(`${supabaseUrl}/functions/v1/send-whatsapp`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${supabaseServiceKey}`,
              },
              body: JSON.stringify({
                conversation_id: conversationId,
                text: replyText,
              }),
            });
            console.log('[twilio-webhook] Send WhatsApp response:', sendResponse.status);
          }
        } else {
          console.error('[twilio-webhook] AI response not ok:', aiResponse.status);
        }

        // Mark batch as completed
        await supabase
          .from('message_batches')
          .update({ is_completed: true })
          .eq('id', batchId!);

        console.log('[twilio-webhook] Batch completed:', batchId);

        // Trigger async conversation analysis
        try {
          fetch(`${supabaseUrl}/functions/v1/analyze-conversation`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({
              conversation_id: conversationId,
              contact_id: contact.id,
            }),
          }).catch(e => console.log('[twilio-webhook] Async analysis error (non-blocking):', e));
        } catch (e) {
          // Ignore analysis errors
        }

      } catch (aiError) {
        console.error('[twilio-webhook] Error processing batch:', aiError);
        // Mark batch as completed even on error to prevent infinite retries
        await supabase
          .from('message_batches')
          .update({ is_completed: true })
          .eq('id', batchId!);
      }
    } else {
      console.log('[twilio-webhook] Bot disabled or paused, skipping AI reply');
    }

    // Return empty TwiML response
    return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      headers: { ...corsHeaders, 'Content-Type': 'text/xml' }
    });

  } catch (error) {
    console.error('[twilio-webhook] Error:', error);
    return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
      status: 200 // Always return 200 to Twilio to prevent retries
    });
  }
});
