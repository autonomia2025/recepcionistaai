

## Diagnóstico

El bot debe **detectar la zona del cliente durante la conversación** y, en ese momento, asignar el contacto al pool de la zona correspondiente para que el STAFF de esa zona lo vea automáticamente en su Inbox.

Hoy:
- Los contactos se crean con `zone = NULL`.
- El bot no tiene instrucción explícita de preguntar la zona.
- El filtro del STAFF ya funciona (`contacts.zone = profile.zone`), pero como nadie asigna zona, no ve nada.

---

## Plan

### Paso 1 — Toggle de configuración por workshop (opt-in)

Como dijiste *"si es que lo tienen configurado así"*, agrego un switch para que SOC (y futuros workshops multi-zona) lo activen.

**Migración SQL:**
- Agregar columna `workshops.zone_detection_enabled boolean DEFAULT false`.
- Activarla solo para SOC Ingeniería (`610fb257…`).

**UI (`BotSettingsEditor.tsx` o sección bot):**
- Switch visible solo para ADMIN/SUPERADMIN: *"Detección automática de zona"* con descripción: *"El bot preguntará al cliente desde qué ciudad escribe y lo asignará a la zona correspondiente."*

### Paso 2 — El bot pregunta la zona en cuanto sea necesario

**`supabase/functions/build-ai-reply/index.ts`:**
- Si `workshop.zone_detection_enabled === true` Y `contact.zone IS NULL`:
  - Inyectar al system prompt: *"REGLA CRÍTICA: Antes de cotizar, agendar o derivar al equipo, debes preguntar al cliente desde qué ciudad/comuna escribe. Las zonas válidas son: **Talca/Maule**, **Puerto Montt/Los Lagos**, **Santiago/RM**. Hazlo de forma natural en el saludo o cuando el cliente mencione su necesidad."*
- Esto asegura que en los primeros 1-2 mensajes el bot pida la zona.

### Paso 3 — Detección y asignación en tiempo real

**`build-ai-reply/index.ts`:**
- Pedir al modelo que devuelva en su JSON un campo `detected_zone: "talca" | "puerto_montt" | "santiago" | null` analizando el último mensaje del cliente.
- Si viene zona y `contact.zone IS NULL`:
  - `UPDATE contacts SET zone = ... WHERE id = contact_id` inmediatamente.
  - Loggear evento `health_logs` tipo `info` para auditoría: *"Contacto X asignado a zona Y"*.
- Fallback regex: si el modelo no detecta pero el texto del cliente menciona claramente "Talca", "Puerto Montt", "Santiago", "Maule", "Los Lagos", "RM", o comunas conocidas → aplicar zona vía regex.

### Paso 4 — Asignación automática al STAFF de esa zona

Cuando se asigna `contact.zone`, también actualizar la conversación:
- Buscar STAFF activos de ese workshop con `profile.zone = nueva_zona`.
- Si hay uno solo → `UPDATE conversations SET assigned_to_user_id = staff.id WHERE contact_id = ...` (auto-asignación directa).
- Si hay varios → asignación round-robin simple (al de menor carga actual de conversaciones abiertas en esa zona).
- Si no hay ninguno → dejar sin asignar pero con `zone` ya seteada (el ADMIN lo ve en el Inbox con el badge de zona).

### Paso 5 — Indicador visual en Inbox para ADMIN

**`ConversationList.tsx`** (solo ADMIN/SUPERADMIN, solo workshops con `zone_detection_enabled`):
- Badge amarillo *"⚠ Sin zona"* en conversaciones cuyo contacto tiene `zone IS NULL` (para que sepan que el bot aún no la detectó o el cliente no la dijo).
- Badge informativo cuando una conversación se auto-asigna por zona: *"🎯 Auto-asignado por zona"* (visible 1 vez al cambiar).

### Paso 6 — Selector manual de zona (override) en `ChatView.tsx`

Para ADMIN/SUPERADMIN: agregar un `Select` pequeño en el header del chat para sobrescribir o asignar manualmente la zona del contacto. Útil cuando el cliente no responde la pregunta o el bot no detecta.

---

## Flujo completo (ejemplo)

```text
Cliente: "Hola, quiero una cotización"
Bot:    "¡Hola! Con gusto. ¿Desde qué ciudad nos escribes?"
Cliente: "Desde Talca"
Bot:    [Detecta zone=talca → UPDATE contacts.zone='talca'
         → busca STAFF con zone='talca' → asigna conversation
         → STAFF de Talca ve la conversación en su Inbox al instante]
Bot:    "Perfecto, en Talca atendemos... ¿qué servicio necesitas?"
```

---

## Archivos a modificar

| Archivo | Cambio |
|---|---|
| Migración SQL | Agregar `workshops.zone_detection_enabled`; activar para SOC |
| `src/components/admin/BotSettingsEditor.tsx` | Switch de detección de zona |
| `supabase/functions/build-ai-reply/index.ts` | Inyectar regla de pregunta + parsear `detected_zone` + UPDATE inmediato + auto-asignación a STAFF |
| `src/components/inbox/ConversationList.tsx` | Badge "Sin zona" para ADMIN |
| `src/components/inbox/ChatView.tsx` | Selector manual de zona (override) para ADMIN/SUPERADMIN |

No tocaré: filtros del STAFF (ya funcionan), `analyze-conversation` (queda como respaldo), RLS, ni `whatsapp-webhook` (la detección queda concentrada en el bot, no en el primer mensaje crudo).

