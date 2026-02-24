

# Integracion YCloud como proveedor WhatsApp para AutonomIA Suite

## Resumen ejecutivo

Agregar YCloud como tercer proveedor de WhatsApp (junto a Meta Cloud API y Twilio existentes), siguiendo el mismo patron multi-tenant probado. La implementacion prioriza velocidad de onboarding white-glove y aislamiento estricto por tenant.

---

## 1. Arquitectura de datos multi-tenant

### Recomendacion: Un solo portfolio YCloud para todos los tenants

**Pros de un portfolio unico:**
- Solo un API Key global que administrar
- Solo un webhook endpoint que configurar
- Menor complejidad operacional
- Los numeros se distinguen por `phone_number` en el payload del webhook

**Contras de un portfolio por cliente:**
- Multiplicar API Keys y webhook secrets
- Mayor superficie de error y gestion manual
- Sin beneficio real: YCloud ya envia el numero destino (`to`) en cada evento

**Recomendacion final: UN portfolio, UN API Key global, UN webhook endpoint.** Los numeros se asignan dentro del mismo portfolio y el ruteo se hace por numero destino en el webhook.

### Modelo de datos

No se necesita tabla nueva. Se extiende la tabla `workshops` con un nuevo valor en el campo `whatsapp_provider` y columnas adicionales para datos especificos de YCloud:

```text
workshops (cambios)
+---------------------------+--------+--------------------------------------------------+
| Campo                     | Tipo   | Descripcion                                      |
+---------------------------+--------+--------------------------------------------------+
| whatsapp_provider         | TEXT   | Agregar 'ycloud' al CHECK constraint existente   |
| ycloud_phone_number       | TEXT   | Numero E.164 del negocio en YCloud               |
| ycloud_waba_id            | TEXT   | WABA ID asignado en YCloud (ref. operacional)    |
| ycloud_phone_number_id    | TEXT   | Phone Number ID de YCloud (para send API)        |
+---------------------------+--------+--------------------------------------------------+
```

**Campos que NUNCA deben ser visibles al admin:**
- El API Key de YCloud (se guarda como secret global `YCLOUD_API_KEY`, nunca en la tabla)
- El webhook secret de YCloud (se guarda como secret global `YCLOUD_WEBHOOK_SECRET`)

**Campos visibles al admin:** Ninguno extra. El superadmin solo ve el estado de conexion (ya existente: `whatsapp_connected`, `whatsapp_connected_at`).

### Seguridad

- Las columnas `ycloud_*` estan protegidas por las mismas politicas RLS existentes en `workshops`
- El acceso publico ya fue eliminado previamente (no hay SELECT publico a workshops)
- Los secrets globales solo son accesibles desde edge functions via `Deno.env`

---

## 2. Flujo de onboarding white-glove (checklist < 30 min)

### Prerequisitos (una sola vez)

1. Tener cuenta YCloud con un portfolio activo
2. Tener WABA(s) creada(s) dentro de ese portfolio  
3. Guardar el API Key como secret `YCLOUD_API_KEY`
4. Configurar un webhook endpoint en YCloud Console apuntando a: `{SUPABASE_URL}/functions/v1/ycloud-webhook`
   - Suscribir a eventos: `whatsapp.inbound_message.received`
   - Guardar el webhook secret como `YCLOUD_WEBHOOK_SECRET`

### Checklist por cliente nuevo

```text
Paso  | Accion                                         | Donde            | Tiempo est.
------+------------------------------------------------+------------------+-----------
  1   | Crear negocio desde panel superadmin            | UI SuperAdmin    | 2 min
      | (seleccionar canal: WhatsApp, provider: YCloud) |                  |
  2   | En YCloud Console, registrar/asignar numero     | ycloud.com       | 5 min
      | dentro del WABA existente                       |                  |
  3   | Copiar de YCloud:                               | ycloud.com       | 2 min
      |   - Phone Number (E.164)                        |                  |
      |   - WABA ID                                     |                  |
      |   - Phone Number ID                             |                  |
  4   | En dialogo YCloud del superadmin, pegar datos   | UI SuperAdmin    | 1 min
      | y hacer click "Verificar y Conectar"            |                  |
  5   | Enviar mensaje de prueba desde WhatsApp al      | WhatsApp movil   | 2 min
      | numero configurado                              |                  |
  6   | Verificar que aparece en Inbox del negocio      | UI Admin         | 1 min
------+------------------------------------------------+------------------+-----------
                                          TOTAL ESTIMADO:      ~13 min
```

---

## 3. Webhooks y ruteo por tenant

### Estrategia de ruteo

El webhook de YCloud envia un JSON con la estructura:
```text
{
  "type": "whatsapp.inbound_message.received",
  "whatsappInboundMessage": {
    "from": "CUSTOMER-PHONE",      // quien envia
    "to": "BUSINESS-PHONE",        // nuestro numero
    "wabaId": "WABA-ID",
    "text": { "body": "..." },
    ...
  }
}
```

**Ruteo:** Buscar workshop donde `ycloud_phone_number = payload.to` AND `whatsapp_provider = 'ycloud'` AND `is_active = true`.

### Validaciones obligatorias

1. **Verificacion de firma HMAC-SHA256:** Verificar header `YCloud-Signature` con `YCLOUD_WEBHOOK_SECRET` antes de procesar cualquier evento
2. **Ruteo estricto:** Si no se encuentra workshop para el numero destino, responder 200 pero no procesar (loguear en `health_logs`)
3. **Idempotencia:** Usar el `id` del evento (evt_xxx) como clave de idempotencia en la tabla `message_batches`
4. **Respuesta rapida:** Responder 200 inmediatamente, procesar de forma asincrona (el sistema de batching ya hace esto)

### Flujo del webhook

```text
POST /ycloud-webhook
  |
  +-> Verificar firma HMAC-SHA256
  +-> Parsear tipo de evento
  |     |
  |     +-> "whatsapp.inbound_message.received"
  |     |     |
  |     |     +-> Extraer: from, to, text, wabaId
  |     |     +-> Buscar workshop por ycloud_phone_number = to
  |     |     +-> Buscar/crear contacto por whatsapp_id = from
  |     |     +-> Buscar/crear conversacion
  |     |     +-> Insertar mensaje inbound
  |     |     +-> Disparar batch + AI reply (misma logica que Meta/Twilio)
  |     |
  |     +-> Otros eventos -> Log y skip
  |
  +-> Responder { "received": true } (200)
```

---

## 4. Envio de mensajes (outbound)

### Endpoint YCloud

```text
POST https://api.ycloud.com/v2/whatsapp/messages/sendDirectly
Headers:
  X-API-Key: {YCLOUD_API_KEY}
  Content-Type: application/json
Body:
  {
    "from": "+56912345678",    // ycloud_phone_number del workshop
    "to": "+56987654321",      // whatsapp_id del contacto
    "type": "text",
    "text": { "body": "Mensaje aqui" }
  }
```

### Cambios en `send-whatsapp` edge function

Agregar un tercer bloque condicional junto a Meta y Twilio:

```text
if (provider === 'ycloud') {
  -> Leer YCLOUD_API_KEY de env
  -> Verificar que workshop tiene ycloud_phone_number
  -> POST a api.ycloud.com/v2/whatsapp/messages/sendDirectly
  -> Manejar respuesta (id en response.id)
  -> Loguear en health_logs si hay error
}
```

### Manejo de errores

| Error                     | Deteccion                          | Accion                                    |
|---------------------------|------------------------------------|-----------------------------------------|
| API Key invalido          | HTTP 401                           | Log critico, marcar workshop desconectado |
| Numero no aprobado        | HTTP 400 + error code              | Log warning, notificar superadmin         |
| Template no aprobado      | HTTP 400 + error code              | Log warning (solo aplica a templates)     |
| Rate limit                | HTTP 429                           | Reintentar con backoff exponencial        |
| Sesion 24h expirada       | HTTP 400 + whatsapp error          | Bloquear y loguear como con Meta          |

### Idempotencia

Usar el `externalId` de YCloud para pasar nuestro `message_id` y evitar duplicados en reintentos.

---

## 5. Implementacion - Lista de tareas en orden

### Fase 1: Infraestructura (secrets y schema)

1. **Agregar secrets:** `YCLOUD_API_KEY` y `YCLOUD_WEBHOOK_SECRET`
2. **Migracion SQL:**
   - Ampliar CHECK constraint de `whatsapp_provider` para incluir `'ycloud'`
   - Agregar columnas `ycloud_phone_number`, `ycloud_waba_id`, `ycloud_phone_number_id`

### Fase 2: Webhook inbound

3. **Crear `supabase/functions/ycloud-webhook/index.ts`:**
   - Verificacion de firma HMAC-SHA256
   - Parseo del payload YCloud
   - Ruteo por `ycloud_phone_number`
   - Reutilizar logica de contactos, conversaciones, mensajes y batching del webhook existente
4. **Actualizar `supabase/config.toml`:** agregar `[functions.ycloud-webhook]` con `verify_jwt = false`

### Fase 3: Envio outbound

5. **Modificar `supabase/functions/send-whatsapp/index.ts`:**
   - Agregar bloque `else if (workshop.whatsapp_provider === 'ycloud')` 
   - Implementar llamada a `api.ycloud.com/v2/whatsapp/messages/sendDirectly`
   - Mantener la validacion de ventana 24h (YCloud la aplica tambien, pero doble check)

### Fase 4: Verificacion y UI

6. **Crear `supabase/functions/verify-ycloud/index.ts`:**
   - Recibir `workshop_id` + `phone_number`
   - Llamar a YCloud API `GET /v2/whatsapp/phoneNumbers` para verificar que el numero existe
   - Actualizar workshop como conectado
7. **Crear `src/components/admin/YCloudConfigDialog.tsx`:**
   - Dialogo similar a `TwilioConfigDialog`
   - Campos: Phone Number, WABA ID, Phone Number ID
   - Boton "Verificar y Conectar"
8. **Actualizar `src/pages/admin/WorkshopsPage.tsx`:**
   - Agregar `'ycloud'` como opcion en el selector de provider
   - Abrir `YCloudConfigDialog` cuando el provider es `ycloud`

### Fase 5: Integracion con reminders

9. **Actualizar `supabase/functions/send-branded-reminder/index.ts`:**
   - Si el workshop usa YCloud, enviar via YCloud API en vez de Meta/Twilio

---

## 6. Smoke Test (10 minutos)

```text
#  | Test                                        | Resultado esperado
---+---------------------------------------------+--------------------------------------
 1 | Enviar "Hola" desde WhatsApp al numero      | Mensaje aparece en Inbox del negocio
   | YCloud del negocio                           | (canal: whatsapp)
 2 | Esperar respuesta del bot                    | Bot responde automaticamente via
   |                                              | YCloud (verificar en health_logs)
 3 | Escribir "quiero hablar con alguien"         | Bot responde que derivara y pausa
   |                                              | el bot. Notificacion interna creada
 4 | Desde el Inbox, escribir respuesta manual    | Mensaje se envia via YCloud, llega
   |                                              | al celular del cliente
 5 | Verificar health_logs del negocio            | Sin errores. Eventos tipo "info" de
   |                                              | envio/recepcion exitosos
 6 | Desde OTRO negocio, buscar la conversacion   | La conversacion NO aparece. Filtro
   |                                              | por workshop_id funciona correctamente
 7 | Verificar que el webhook firma es validada   | Enviar POST sin firma -> respuesta 401
   |                                              | (no procesa el mensaje)
```

---

## 7. Errores tipicos y como detectarlos

| Error                                     | Sintoma                                  | Deteccion rapida                              |
|-------------------------------------------|------------------------------------------|-----------------------------------------------|
| API Key incorrecto                        | Todos los envios fallan con 401          | health_logs: categoria `whatsapp`, tipo `error`|
| Webhook secret incorrecto                 | Ningun mensaje inbound llega             | Logs de edge function: "Invalid signature"     |
| Numero no registrado en YCloud            | Envios fallan con 400                    | health_logs + verify-ycloud retorna error      |
| Numero asignado a workshop equivocado     | Mensajes llegan al negocio incorrecto    | Verificar `ycloud_phone_number` en workshops   |
| Ventana 24h cerrada                       | Outbound bloqueado                       | health_logs: "24h window closed"               |
| Firma HMAC no coincide                    | Webhook rechaza todo con 401             | Verificar secret en YCloud Console vs env      |

---

## Seccion tecnica: Detalle de implementacion

### Migracion SQL

```sql
-- Ampliar constraint de provider
ALTER TABLE public.workshops 
DROP CONSTRAINT IF EXISTS workshops_whatsapp_provider_check;

ALTER TABLE public.workshops 
ADD CONSTRAINT workshops_whatsapp_provider_check 
CHECK (whatsapp_provider IN ('meta', 'twilio', 'ycloud'));

-- Agregar columnas YCloud
ALTER TABLE public.workshops 
ADD COLUMN IF NOT EXISTS ycloud_phone_number TEXT,
ADD COLUMN IF NOT EXISTS ycloud_waba_id TEXT,
ADD COLUMN IF NOT EXISTS ycloud_phone_number_id TEXT;

COMMENT ON COLUMN public.workshops.ycloud_phone_number IS 'YCloud WhatsApp number in E.164 format';
COMMENT ON COLUMN public.workshops.ycloud_waba_id IS 'YCloud WABA ID for reference';
COMMENT ON COLUMN public.workshops.ycloud_phone_number_id IS 'YCloud Phone Number ID for API calls';
```

### Estructura del webhook YCloud (firma HMAC)

```text
Header: YCloud-Signature: t={unix_timestamp},s={hmac_hex}
Verificacion: HMAC-SHA256("{timestamp}.{raw_body}", YCLOUD_WEBHOOK_SECRET)
Comparar con constante de tiempo (timing-safe)
```

### Payload outbound YCloud

```text
POST https://api.ycloud.com/v2/whatsapp/messages/sendDirectly
X-API-Key: {YCLOUD_API_KEY}

{
  "from": "{workshop.ycloud_phone_number}",
  "to": "{contact.whatsapp_id}",
  "type": "text",
  "text": { "body": "{message_text}" },
  "externalId": "{internal_message_uuid}"
}
```

