## Plan: Conectar Soc Ingeniería con Kapso vía Webhook

**Buenas noticias:** Kapso replica el formato de Meta Cloud API (webhook entrante idéntico, endpoint de envío `/{phone_number_id}/messages` idéntico). Esto significa que el webhook actual (`whatsapp-webhook`) funciona **sin cambios** para recibir mensajes de Kapso. Solo hay que ajustar el envío saliente y guardar la API key + phone_number_id.

---

### Lo que tú necesitas tener listo en Kapso

1. **API Key de Kapso** (panel de Kapso → API Keys). La guardamos como secret `KAPSO_API_KEY`.
2. **El `phone_number_id` de tu número conectado** (lo ves en Kapso al lado del número). Es un número largo tipo `647015955153740`.
3. **Verify token para el webhook**: usaremos el que ya tienes: `autonomia2026`.

---

### Lo que configuras en Kapso (UI Kapso)

En el dashboard de Kapso, configura el webhook con estos datos:

- **Webhook URL:** `https://hblwddfcfiblesjcosjt.supabase.co/functions/v1/whatsapp-webhook`
- **Verify Token:** `autonomia2026`
- **Eventos suscritos:** `messages`

Kapso reenviará los mensajes en formato Meta exacto, así que el webhook actual los procesará sin tocar nada.

---

### Cambios técnicos en el código

**1. Migración de DB**
- Agregar `'kapso'` al CHECK constraint de `workshops.whatsapp_provider`.
- Actualizar la fila de Soc Ingeniería:
  - `whatsapp_provider = 'kapso'`
  - `whatsapp_phone_number_id = <tu phone_number_id>`
  - `whatsapp_connected = true`

**2. Secret nuevo**
- `KAPSO_API_KEY` (te la pediré con el formulario seguro de secrets).

**3. Edge function `send-whatsapp/index.ts`**
Agregar una rama `else if (provider === 'kapso')`:

```ts
// Kapso usa mismo formato que Meta, solo cambia URL y header de auth
const kapsoUrl = `https://api.kapso.ai/meta/whatsapp/v24.0/${workshop.whatsapp_phone_number_id}/messages`;
const response = await fetch(kapsoUrl, {
  method: 'POST',
  headers: {
    'X-API-Key': Deno.env.get('KAPSO_API_KEY')!,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    messaging_product: 'whatsapp',
    to: recipientPhone,
    type: 'text',
    text: { body: text },
  }),
});
```

**4. Edge function `whatsapp-webhook/index.ts`**
**Sin cambios.** El payload de Kapso es idéntico al de Meta — el lookup por `phone_number_id` ya funciona.

**5. UI Superadmin (`WorkshopsPage.tsx`)**
- Agregar `"Kapso"` al selector de proveedor de WhatsApp.
- Mostrar campo `whatsapp_phone_number_id` cuando provider = kapso.

---

### Flujo final

```
Cliente envía WhatsApp al número de Soc Ingeniería
        ↓
Kapso recibe (es Meta Business Partner oficial)
        ↓
Kapso reenvía a tu webhook en formato Meta
        ↓
whatsapp-webhook lo rutea por phone_number_id → Soc Ingeniería
        ↓
Bot procesa y responde via send-whatsapp
        ↓
send-whatsapp detecta provider='kapso' → POST a api.kapso.ai
        ↓
Kapso envía el mensaje al cliente
```

---

### Lo que necesito de ti para empezar

1. Confirmas el plan.
2. Me das tu **`phone_number_id` de Kapso** (lo copias del dashboard de Kapso).
3. Yo te abro el formulario seguro para que pegues la **`KAPSO_API_KEY`**.

Después de eso ejecuto migración + cambios en código + deploy en una sola pasada y queda listo para probar.
