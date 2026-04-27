## Plan: Migrar SOC Ingeniería de Twilio a Meta WhatsApp Cloud API

### Estado actual

```text
Workshop: Soc Ingenieria
ID: 610fb257-a649-4115-b944-21f31e7952db
whatsapp_provider: twilio
whatsapp_connected: false
whatsapp_phone_number_id: (vacío)
twilio_phone_number: (vacío)
```

Está marcado como Twilio pero ni siquiera tiene número Twilio asignado, así que el cambio es limpio: no se rompe nada en producción.

---

### Qué se va a hacer

**1. Migración de DB (un solo UPDATE)**
Cambiar el provider del workshop a `meta` y limpiar campos de Twilio:

```sql
UPDATE workshops
SET whatsapp_provider = 'meta',
    twilio_phone_number = NULL,
    twilio_phone_sid = NULL,
    whatsapp_connected = false,
    whatsapp_connected_at = NULL
WHERE id = '610fb257-a649-4115-b944-21f31e7952db';
```

No se toca nada más: los mensajes históricos, contactos, conversaciones y bot quedan intactos.

**2. UI: abrir el diálogo correcto**
En el panel Superadmin → Talleres → SOC Ingeniería, después de la migración aparecerá el botón de configurar **WhatsApp (Meta)** en vez de Twilio. Ahí se ingresan:
- **Phone Number ID** (de Meta, lo da developers.facebook.com)
- **Business Account ID** (WABA ID)
- Access Token (opcional — si no se pone, usa el `WHATSAPP_ACCESS_TOKEN` global que ya está configurado como secret)

Y luego **Verificar Conexión** para marcar `whatsapp_connected = true`.

**3. Webhook que vas a poner en Meta**

```text
Callback URL:
https://hblwddfcfiblesjcosjt.supabase.co/functions/v1/whatsapp-webhook

Verify Token:
autonomia2026

Webhook Fields a suscribir:
messages
```

El mismo webhook sirve para todos los talleres con provider `meta`. El ruteo multi-tenant lo hace internamente buscando el `phone_number_id` que Meta envía en el payload contra `workshops.whatsapp_phone_number_id`. Por eso es **crítico** guardar bien el Phone Number ID en el paso 2 — sin eso, los mensajes entran al webhook pero no encuentran a qué taller pertenecen y se descartan.

---

### Pasos en orden (lo que tú vas a hacer en Meta)

1. Yo ejecuto la migración (cambia provider a meta).
2. Tú entras a `developers.facebook.com` → tu App → WhatsApp → Configuration:
   - **Webhook**: pegas la Callback URL y el Verify Token de arriba → "Verify and Save"
   - **Webhook fields**: suscribes `messages`
3. En la sección **Phone Numbers** copias el **Phone Number ID** y el **WhatsApp Business Account ID**.
4. En el panel Superadmin de AutonomIA → Talleres → SOC Ingeniería → botón WhatsApp → pegas ambos IDs → **Guardar** → **Verificar Conexión**.
5. Listo: el badge pasa a "Conectado" y los mensajes entrantes empiezan a fluir al Inbox.

---

### Detalles técnicos

- Edge function `whatsapp-webhook` ya está desplegada y enruta por `phone_number_id` (línea 116 de `supabase/functions/whatsapp-webhook/index.ts`). No requiere cambios.
- Edge function `verify-whatsapp` ya existe y la usa el `WhatsAppConfigDialog` para validar credenciales contra la Graph API.
- `WEBHOOK_VERIFY_TOKEN` ya está configurado como secret (`autonomia2026` según memoria del proyecto).
- `WHATSAPP_ACCESS_TOKEN` global también está configurado, así que no hace falta token por taller a menos que quieras usar uno dedicado.
- Provider check: `workshops_whatsapp_provider_check` permite los valores `meta`, `twilio` y `ycloud`, así que el UPDATE no viola constraints.

### Lo que NO cambia

- Bot, prompts, base de conocimiento, contactos, conversaciones históricas, citas: todo intacto.
- Otros talleres en Twilio o YCloud: cero impacto.
- El número de Twilio nunca se llegó a usar, así que no hay mensajes que migrar.

### Riesgos

- Ninguno funcional. El único "punto de no-retorno" es que mientras no pegues el Phone Number ID en el paso 4, el webhook descartará los mensajes entrantes (los loggea y responde 200 OK a Meta). Apenas pegues el ID, todo fluye.

