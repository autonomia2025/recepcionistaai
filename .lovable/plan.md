## Diagnóstico

**Sí, el webhook está recibiendo los mensajes** (lo confirmé en los logs: el body con `"text": {"body": "Hola que tal?"}` llega correctamente). Pero el bot no responde por una sola razón: **el formato del payload de Kapso es distinto al de Meta Cloud API**, y nuestro webhook está hardcodeado para el formato Meta.

### Comparación de payloads

**Meta Cloud API (lo que el código espera):**
```
{ entry: [{ changes: [{ value: { messages: [...], metadata: { phone_number_id }, contacts: [...] } }] }] }
```

**Kapso (lo que llega realmente):**
```
{
  message: { from: "56984385819", text: { body: "Hola que tal?" }, id: "wamid...", type: "text", timestamp: "1777325393" },
  conversation: { contact_name: "Felipiño", phone_number: "56984385819", phone_number_id: "1016639578210295" },
  phone_number_id: "1016639578210295",
  is_new_conversation: false
}
```

Por eso en los logs ves `"No messages in webhook payload"` y el flujo termina ahí — nunca llega a buscar el workshop, ni a procesar el mensaje, ni a llamar al bot.

Nota adicional: Kapso manda **dos eventos** por cada mensaje nuevo (`whatsapp.conversation.created` + `whatsapp.message.received`). Tenemos que procesar solo el de mensaje y deduplicar por `message.id` (la lógica de idempotencia ya existe en el webhook).

---

## Cambios

### 1. `supabase/functions/whatsapp-webhook/index.ts`
Detectar el formato al inicio del POST y normalizarlo a una estructura común antes de continuar:

- Si `body.message` y `body.phone_number_id` existen en el root → es Kapso. Mapear:
  - `phoneNumberId` ← `body.phone_number_id`
  - `message` ← `body.message`
  - `senderPhone` ← `body.message.from`
  - `messageText` ← `body.message.text?.body` (también soportar `body.message.kapso?.content` como fallback)
  - `senderName` ← `body.conversation?.contact_name || senderPhone`
  - `messageId` ← `body.message.id`
  - `messageTimestamp` ← `parseInt(body.message.timestamp) * 1000`
- Ignorar el evento `whatsapp.conversation.created` (header `x-webhook-event`) o cuando viene sin `body.message` → responder 200 OK sin procesar.
- Ignorar mensajes outbound de Kapso: si `body.message.kapso?.direction === 'outbound'` → responder 200 OK.
- Si no es Kapso, mantener la lógica Meta actual intacta.

El resto del flujo (búsqueda de workshop por `phone_number_id`, contacto, conversación, batching, llamada al bot) **no cambia** — ya funciona perfecto, solo necesita los datos normalizados.

### 2. Sin cambios en `send-whatsapp`
El envío saliente vía `api.kapso.ai` ya quedó implementado en el paso anterior y está listo para responder cuando el bot procese el mensaje.

---

## Resultado esperado tras el deploy

1. Mandas "Hola" al WhatsApp de Soc Ingeniería.
2. Kapso → webhook → se detecta formato Kapso → se rutea a Soc Ingeniería por `phone_number_id`.
3. Se crea el contacto "Felipiño" + conversación, se guarda el mensaje inbound.
4. Tras 8s de batching, se llama a `build-ai-reply` y la respuesta sale por `send-whatsapp` → `api.kapso.ai` → tu WhatsApp.

¿Lo ejecuto?
