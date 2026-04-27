import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // === DIAGNOSTIC LOGGING - Log ALL incoming requests ===
  const requestTimestamp = new Date().toISOString();
  const requestMethod = req.method;
  const requestUrl = req.url;
  const requestHeaders: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    // Don't log authorization tokens fully for security
    if (key.toLowerCase() === 'authorization') {
      requestHeaders[key] = value.substring(0, 20) + '...';
    } else {
      requestHeaders[key] = value;
    }
  });

  console.log('=== INCOMING REQUEST ===');
  console.log('Timestamp:', requestTimestamp);
  console.log('Method:', requestMethod);
  console.log('URL:', requestUrl);
  console.log('Headers:', JSON.stringify(requestHeaders, null, 2));

  // For POST requests, clone and log the body
  let bodyText = '';
  if (requestMethod === 'POST') {
    try {
      const clonedReq = req.clone();
      bodyText = await clonedReq.text();
      console.log('Body (first 1000 chars):', bodyText.substring(0, 1000));
    } catch (e) {
      console.log('Could not read body:', e);
    }
  }
  console.log('=== END INCOMING REQUEST ===');
  // === END DIAGNOSTIC LOGGING ===

  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const webhookVerifyToken = Deno.env.get('WEBHOOK_VERIFY_TOKEN')!;
  const globalWhatsAppToken = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // GET: Webhook verification from Meta (uses global verify token)
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');

      console.log('Webhook verification request:', { mode, token: token?.substring(0, 10) + '...' });

      if (mode === 'subscribe' && token === webhookVerifyToken) {
        console.log('Webhook verified successfully');
        return new Response(challenge, {
          status: 200,
          headers: { 'Content-Type': 'text/plain' }
        });
      }

      console.log('Webhook verification failed - token mismatch');
      return new Response('Forbidden', { status: 403 });
    }

    // POST: Receive incoming messages
    if (req.method === 'POST') {
      const body = await req.json();
      console.log('Received webhook:', JSON.stringify(body, null, 2));

      // Detect provider format: Kapso vs Meta Cloud API
      const isKapso = !!(body?.message && body?.phone_number_id && !body?.entry);

      let phoneNumberId: string | undefined;
      let messageId: string | undefined;
      let senderPhone: string | undefined;
      let messageText = '';
      let senderName: string | undefined;
      let messageTimestamp = Date.now();

      if (isKapso) {
        const kapsoEvent = req.headers.get('x-webhook-event') || '';
        console.log('Kapso event detected:', kapsoEvent);

        const km = body.message;

        // Ignore outbound echoes from Kapso
        if (km?.kapso?.direction && km.kapso.direction !== 'inbound') {
          console.log('Kapso outbound message, ignoring');
          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Only process messages with actual content
        const kapsoText = km?.text?.body || km?.kapso?.content || '';
        if (!km || !kapsoText) {
          console.log('Kapso event without text message, ignoring');
          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        phoneNumberId = body.phone_number_id || body.conversation?.phone_number_id;
        messageId = km.id;
        senderPhone = km.from || body.conversation?.phone_number;
        messageText = kapsoText;
        senderName = body.conversation?.contact_name || senderPhone;
        messageTimestamp = km.timestamp ? parseInt(km.timestamp) * 1000 : Date.now();
      } else {
        // Meta Cloud API format
        const entry = body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;

        // Handle status updates (delivery receipts, read receipts)
        if (value?.statuses) {
          console.log('Status update received, ignoring');
          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        if (!value?.messages?.[0]) {
          console.log('No messages in webhook payload');
          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        phoneNumberId = value.metadata?.phone_number_id;
        const message = value.messages[0];
        messageId = message.id;
        senderPhone = message.from;
        messageText = message.text?.body || '';
        senderName = value.contacts?.[0]?.profile?.name || senderPhone;
        messageTimestamp = message.timestamp ? parseInt(message.timestamp) * 1000 : Date.now();
      }

      if (!phoneNumberId || !senderPhone || !messageId) {
        console.log('Missing required fields after normalization', { phoneNumberId, senderPhone, messageId });
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.log('Processing message:', { messageId, phoneNumberId, senderPhone, messageText: messageText.substring(0, 50) });

      // Find workshop by phone_number_id (multi-tenant routing)
      const { data: workshop, error: workshopError } = await supabase
        .from('workshops')
        .select('id, name, whatsapp_access_token, bot_enabled, booking_url, slug')
        .eq('whatsapp_phone_number_id', phoneNumberId)
        .eq('whatsapp_connected', true)
        .eq('is_active', true)
        .single();

      if (workshopError || !workshop) {
        console.log('Workshop not found for phone_number_id:', phoneNumberId);
        return new Response(JSON.stringify({ error: 'Workshop not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.log('Found workshop:', workshop.name, 'bot_enabled:', workshop.bot_enabled);

      // Check if number is blocked
      const { data: isBlocked } = await supabase.rpc('is_number_blocked', {
        _workshop_id: workshop.id,
        _phone: senderPhone
      });

      if (isBlocked) {
        console.log('Blocked number detected, ignoring message from:', senderPhone);
        return new Response(JSON.stringify({ success: true, blocked: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Find or create contact
      let contact;
      const { data: existingContact } = await supabase
        .from('contacts')
        .select('id, name')
        .eq('workshop_id', workshop.id)
        .eq('whatsapp_id', senderPhone)
        .single();

      if (existingContact) {
        contact = existingContact;
        // Update name if we got a better one from WhatsApp
        if (senderName && senderName !== senderPhone && existingContact.name === senderPhone) {
          await supabase
            .from('contacts')
            .update({ name: senderName })
            .eq('id', existingContact.id);
        }
      } else {
        // Create new contact
        const { data: newContact, error: contactError } = await supabase
          .from('contacts')
          .insert({
            workshop_id: workshop.id,
            whatsapp_id: senderPhone,
            phone: senderPhone,
            name: senderName,
            lead_score: 50,
          })
          .select('id, name')
          .single();

        if (contactError) {
          console.error('Error creating contact:', contactError);
          throw contactError;
        }
        contact = newContact;
      }

      // Find or create conversation - use ANY non-closed conversation for this contact
      // Valid statuses: 'new', 'in_progress', 'booked', 'closed', 'lost'
      let conversation;
      const { data: existingConversations } = await supabase
        .from('conversations')
        .select('id, status, assigned_to_user_id')
        .eq('workshop_id', workshop.id)
        .eq('contact_id', contact.id)
        .not('status', 'in', '("closed","lost")')
        .order('created_at', { ascending: false })
        .limit(1);

      // Helper function to get a staff member for assignment (round-robin or first available)
      const getStaffForAssignment = async (workshopId: string): Promise<string | null> => {
        // Get all active staff members for this workshop
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

      if (existingConversations && existingConversations.length > 0) {
        conversation = existingConversations[0];
        console.log('Using existing conversation:', conversation.id, 'status:', conversation.status);

        // If conversation has no assignment, assign it now
        if (!conversation.assigned_to_user_id) {
          const staffId = await getStaffForAssignment(workshop.id);
          if (staffId) {
            await supabase
              .from('conversations')
              .update({ assigned_to_user_id: staffId })
              .eq('id', conversation.id);
            console.log('Assigned existing conversation to staff:', staffId);
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

        // Get a staff member to assign
        const staffId = await getStaffForAssignment(workshop.id);

        if (anyConv && anyConv.length > 0) {
          // Reopen the most recent conversation instead of creating a new one
          conversation = anyConv[0];
          const updateData: { status: string; assigned_to_user_id?: string } = { status: 'new' };
          if (!conversation.assigned_to_user_id && staffId) {
            updateData.assigned_to_user_id = staffId;
          }
          await supabase
            .from('conversations')
            .update(updateData)
            .eq('id', conversation.id);
          console.log('Reopened existing conversation:', conversation.id, 'assigned to:', updateData.assigned_to_user_id || 'unchanged');
        } else {
          // Only create new if contact has no conversations at all
          const { data: newConv, error: convError } = await supabase
            .from('conversations')
            .insert({
              workshop_id: workshop.id,
              contact_id: contact.id,
              status: 'new',
              assigned_to_user_id: staffId,
            })
            .select('id')
            .single();

          if (convError) {
            console.error('Error creating conversation:', convError);
            throw convError;
          }
          conversation = newConv;
          console.log('Created new conversation:', conversation.id, 'assigned to:', staffId);
        }
      }

      // Insert inbound message
      const { error: messageError } = await supabase
        .from('messages')
        .insert({
          workshop_id: workshop.id,
          conversation_id: conversation.id,
          text: messageText,
          direction: 'inbound',
          channel: 'whatsapp',
        });

      if (messageError) {
        console.error('Error inserting message:', messageError);
        throw messageError;
      }

      // Update conversation
      await supabase
        .from('conversations')
        .update({ last_message_at: new Date().toISOString(), status: 'new' })
        .eq('id', conversation.id);

      // If bot is enabled AND not paused for this conversation, use batching system
      const isBotPaused = (conversation as { bot_paused?: boolean }).bot_paused;
      if (workshop.bot_enabled && !isBotPaused) {
        const BATCH_WINDOW_MS = 8000; // 8 second window
        const conversationId = conversation.id;

        const STALE_BATCH_TIMEOUT_MS = 60000; // 1 minute - batch is orphaned if processing takes longer

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
            const lastMsgAt = new Date(existingBatch.last_message_at).getTime();
            const timeSinceLastMsg = Date.now() - lastMsgAt;

            if (timeSinceLastMsg > STALE_BATCH_TIMEOUT_MS) {
              // Batch is orphaned - delete it and create fresh
              console.log('Detected orphaned batch, deleting:', batchId, 'age:', timeSinceLastMsg, 'ms');

              // Log orphan detection to health_logs
              try {
                await supabase.from('health_logs').insert({
                  workshop_id: workshop.id,
                  event_type: 'warning',
                  category: 'whatsapp',
                  message: `Zombie batch detected and recovered for conversation ${conversationId}`,
                  metadata: { batch_id: batchId, age_ms: timeSinceLastMsg, message_count: existingBatch.message_count }
                });
              } catch (logErr) {
                console.error('Failed to log zombie batch:', logErr);
              }

              await supabase
                .from('message_batches')
                .delete()
                .eq('id', batchId);

              // Create a fresh batch
              const { data: freshBatch } = await supabase
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

              batchId = freshBatch!.id;
              console.log('Created fresh batch after zombie cleanup:', batchId);
            } else {
              // Batch is actively being processed by another worker
              console.log('Batch being processed by another worker, message will be included. Batch:', batchId);
              return new Response(JSON.stringify({ success: true, batched: true, batch_id: batchId }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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

            console.log('Updated batch window, message count:', existingBatch.message_count + 1, 'Batch:', batchId);
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
              console.log('Batch race condition, checking existing...');
              const { data: raceBatch } = await supabase
                .from('message_batches')
                .select('id, is_processing, created_at, last_message_at')
                .eq('conversation_id', conversationId)
                .eq('is_completed', false)
                .single();

              if (raceBatch) {
                // Check for orphaned batch in race condition too
                const batchAge = Date.now() - new Date(raceBatch.last_message_at || raceBatch.created_at).getTime();
                if (raceBatch.is_processing && batchAge <= STALE_BATCH_TIMEOUT_MS) {
                  console.log('Batch already processing (race), skipping');
                  return new Response(JSON.stringify({ success: true, batched: true }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                  });
                }
                batchId = raceBatch.id;
              } else {
                console.error('Batch creation failed:', batchError);
                throw batchError;
              }
            } else {
              console.error('Batch creation error:', batchError);
              throw batchError;
            }
          } else {
            batchId = newBatch!.id;
            console.log('Created new batch:', batchId);
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
              console.log('Batch no longer exists, aborting');
              return false;
            }

            if (currentBatch.is_completed) {
              console.log('Batch already completed by another worker');
              return false;
            }

            if (currentBatch.is_processing) {
              console.log('Batch being processed by another worker');
              return false;
            }

            // Check if window has passed since last message
            const lastMsgTime = new Date(currentBatch.last_message_at).getTime();
            const timeSinceLastMsg = Date.now() - lastMsgTime;

            if (timeSinceLastMsg >= BATCH_WINDOW_MS) {
              console.log('Batch window complete, time since last message:', timeSinceLastMsg, 'ms');
              return true; // Window complete, proceed to process
            }

            console.log('Window still active, waiting... Time since last:', timeSinceLastMsg, 'ms');
          }

          console.log('Max wait time exceeded, proceeding anyway');
          return true;
        };

        const shouldProcess = await waitForBatchWindow();

        if (!shouldProcess) {
          return new Response(JSON.stringify({ success: true, deferred: true }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Step 3: Try to claim the batch for processing (atomic update)
        const { data: claimedBatch, error: claimError } = await supabase
          .from('message_batches')
          .update({ is_processing: true })
          .eq('id', batchId!)
          .eq('is_processing', false)
          .eq('is_completed', false)
          .select('id')
          .single();

        if (claimError || !claimedBatch) {
          console.log('Failed to claim batch (already processing or completed):', claimError?.message);
          return new Response(JSON.stringify({ success: true, already_processing: true }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        console.log('Claimed batch for processing:', batchId);

        try {
          // Step 4: Get ALL inbound messages in the batch window
          const { data: batchInfo } = await supabase
            .from('message_batches')
            .select('batch_started_at')
            .eq('id', batchId!)
            .single();

          const { data: batchMessages } = await supabase
            .from('messages')
            .select('id, text, created_at')
            .eq('conversation_id', conversationId)
            .eq('direction', 'inbound')
            .gte('created_at', batchInfo?.batch_started_at || new Date(Date.now() - 60000).toISOString())
            .order('created_at', { ascending: true });

          const messageCount = batchMessages?.length || 0;
          console.log('Processing batch with', messageCount, 'messages');

          // Combine all messages
          const combinedMessage = batchMessages && batchMessages.length > 1
            ? batchMessages.map(m => m.text).join(' | ')
            : messageText;

          console.log('Combined message for AI:', combinedMessage.substring(0, 150));

          // Call build-ai-reply function
          const aiReplyUrl = `${supabaseUrl}/functions/v1/build-ai-reply`;
          const aiResponse = await fetch(aiReplyUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseServiceKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              conversation_id: conversation.id,
              workshop_id: workshop.id,
              message_text: combinedMessage,
              contact_name: contact.name,
            }),
          });

          if (aiResponse.ok) {
            const aiResult = await aiResponse.json();
            console.log('AI reply result:', aiResult);

            // Support both old format (reply) and new format (replies array)
            const replies: string[] = aiResult.replies || (aiResult.reply ? [aiResult.reply] : []);

            if (replies.length > 0) {
              // Send WhatsApp replies
              // Use workshop-specific token first (multi-tenant), fallback to global
              const accessToken = (workshop.whatsapp_access_token || globalWhatsAppToken || '').trim();

              if (accessToken && accessToken.length > 10) {
                const metaApiUrl = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`;

                console.log('Sending WhatsApp replies to:', senderPhone, 'count:', replies.length);

                // Send each message with a small delay between them
                for (let i = 0; i < replies.length; i++) {
                  const replyText = replies[i];

                  // Add small delay between messages (except first)
                  if (i > 0) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                  }

                  const sendResponse = await fetch(metaApiUrl, {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${accessToken}`,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      messaging_product: 'whatsapp',
                      to: senderPhone,
                      type: 'text',
                      text: { body: replyText },
                    }),
                  });

                  const sendResult = await sendResponse.json();
                  console.log(`WhatsApp send result (${i + 1}/${replies.length}):`, sendResult);

                  if (sendResponse.ok) {
                    // Insert outbound message with metadata
                    await supabase
                      .from('messages')
                      .insert({
                        workshop_id: workshop.id,
                        conversation_id: conversation.id,
                        text: replyText,
                        direction: 'outbound',
                        channel: 'whatsapp',
                        metadata: {
                          intent: aiResult.intent,
                          confidence: aiResult.confidence,
                          reasoning: aiResult.reasoning,
                          is_last_in_batch: i === replies.length - 1
                        }
                      });
                  } else {
                    console.error('Failed to send WhatsApp message:', sendResult);
                  }
                }

                // Update conversation status after all messages sent
                // If handoff requested, pause the bot for this conversation
                const newStatus = aiResult.should_handoff ? 'in_progress' : 'new';
                const updateData: Record<string, unknown> = {
                  last_message_at: new Date().toISOString(),
                  status: newStatus,
                };

                if (aiResult.should_handoff) {
                  updateData.bot_paused = true;
                  console.log('Human handoff requested - pausing bot for this conversation');

                  // Create notification for the team
                  await supabase
                    .from('notifications')
                    .insert({
                      workshop_id: workshop.id,
                      type: 'human_handoff',
                      title: '🙋 Cliente solicita atención humana',
                      message: `${contact.name} ha solicitado hablar con una persona. El bot ha sido pausado para esta conversación.`,
                    });

                  // Send internal email notification for handoff
                  try {
                    await fetch(`${supabaseUrl}/functions/v1/send-internal-notification`, {
                      method: 'POST',
                      headers: {
                        'Authorization': `Bearer ${supabaseServiceKey}`,
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify({
                        workshop_id: workshop.id,
                        notification_type: 'human_handoff',
                        contact_id: contact.id,
                        conversation_id: conversation.id
                      })
                    });
                  } catch (notifError) {
                    console.error('Failed to send handoff notification:', notifError);
                  }
                }

                await supabase
                  .from('conversations')
                  .update(updateData)
                  .eq('id', conversation.id);

                console.log('Bot replies sent and saved:', replies.length);
              } else if (!accessToken || accessToken.length <= 10) {
                console.log('No access token available for sending');
              }
            }
          } else {
            const errorText = await aiResponse.text();
            console.error('AI reply error:', aiResponse.status, errorText);
          }
        } catch (aiError) {
          console.error('Error generating AI reply:', aiError);
          // Don't fail the webhook, just log the error
        } finally {
          // Step 5: Mark batch as completed (always, even on error)
          await supabase
            .from('message_batches')
            .update({ is_completed: true, is_processing: false })
            .eq('id', batchId!);

          console.log('Batch completed:', batchId);
        }
      } else if (isBotPaused) {
        console.log('Bot paused for this conversation (human handoff), skipping AI reply');
      } else {
        console.log('Bot disabled for this workshop, skipping AI reply');
      }

      // Trigger async analysis (for lead scoring, etc.)
      try {
        const analyzeUrl = `${supabaseUrl}/functions/v1/analyze-conversation`;
        fetch(analyzeUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            conversation_id: conversation.id,
            contact_id: contact.id,
          }),
        }).catch(err => console.error('Async analyze error:', err));
      } catch (e) {
        console.error('Failed to trigger analysis:', e);
      }

      console.log('Message processed successfully');
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response('Method not allowed', { status: 405 });
  } catch (error: unknown) {
    console.error('Webhook error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';

    // Log error to health_logs for monitoring
    try {
      await supabase.from('health_logs').insert({
        workshop_id: null, // Will be null if we couldn't identify the workshop
        event_type: 'error',
        category: 'whatsapp',
        message: `WhatsApp webhook error: ${message}`,
        metadata: { error: message, timestamp: new Date().toISOString() }
      });
    } catch (logErr) {
      console.error('Failed to log to health_logs:', logErr);
    }

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
