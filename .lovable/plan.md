

# Problemas Detectados para Usuarios Admin

Se encontraron **5 problemas concretos** que afectan la experiencia del admin. Aqui estan ordenados por impacto.

---

## Problema 1: No se muestra el ultimo mensaje en la lista de conversaciones

**Impacto:** Alto - El admin no ve una preview del ultimo mensaje en la lista del Inbox.

**Causa:** La tabla `conversations` NO tiene columna `last_message_text`, pero el codigo (`ConversationList.tsx` linea 170 y `useConversations.ts`) espera ese campo. Siempre es `undefined`, asi que la lista solo muestra el resumen IA cuando existe, pero nunca el texto real del ultimo mensaje.

**Solucion:**
1. Agregar columna `last_message_text` a la tabla `conversations`
2. Crear un trigger que actualice automaticamente este campo cada vez que se inserta un mensaje nuevo
3. Backfill: actualizar registros existentes con el ultimo mensaje de cada conversacion

---

## Problema 2: Admin no puede eliminar contactos (falla silenciosamente)

**Impacto:** Medio - El boton "Eliminar" en ClientsPage existe pero falla porque no hay politica RLS de DELETE en la tabla `contacts`.

**Causa:** La politica `Users can manage contacts in their workshop` usa comando `ALL`, que en teoria cubre DELETE. Sin embargo, hay relaciones de clave foranea en `conversations`, `appointments`, `messages`, `service_requests` y `quotation_items` que bloquean el DELETE por restricciones de integridad referencial (foreign key constraints).

**Solucion:**
1. Agregar `ON DELETE CASCADE` o manejar la eliminacion en cascada desde el frontend/edge function
2. Alternativa mas segura: soft-delete con campo `archived` en contacts, y filtrar en las queries

---

## Problema 3: Warning de accesibilidad en Dialogs (DialogContent sin Description)

**Impacto:** Bajo (funcional) pero visible en consola - Genera warnings continuos que ensucian la consola de debug.

**Causa:** Varios `DialogContent` y `SheetContent` no incluyen `DialogDescription` o `aria-describedby`. El warning exacto: "Missing Description or aria-describedby for DialogContent".

**Solucion:**
- Agregar `DialogDescription` (puede ser visualmente oculto con `sr-only`) a los dialogos que lo necesiten:
  - `ClientDetailDialog`
  - `EventDetailDialog`
  - Otros dialogs que usen `DialogContent` sin description

---

## Problema 4: El boton "Cotizar" solo aparece en modo `chatbot_only`

**Impacto:** Medio - Admins con modo `with_scheduling` no tienen acceso a la funcion de cotizacion automatica desde el panel de clientes, aunque podrian beneficiarse de ella.

**Causa:** En `ClientDetailDialog.tsx` linea 355, el boton de re-analizar/cotizar esta condicionado a `isChatbotOnly`. Los quotation items tampoco se cargan si no es chatbot_only (linea 272: `enabled: isChatbotOnly`).

**Solucion:**
- Hacer el boton de cotizacion disponible para todos los modos, no solo chatbot_only
- Cargar quotation items independientemente del modo

---

## Problema 5: Envio de mensajes solo via WhatsApp

**Impacto:** Medio - El boton de enviar en el Inbox siempre invoca `send-whatsapp`, sin importar el canal original de la conversacion. Si el contacto llego por Instagram, email o web chat, la respuesta manual va por WhatsApp.

**Causa:** `useSendMessage` en `useMessages.ts` linea 140 siempre llama a `send-whatsapp`. No detecta el canal de la conversacion.

**Solucion:**
- Detectar el canal de la conversacion (WhatsApp, Instagram, email, web)
- Invocar la funcion de envio correspondiente (`send-whatsapp`, `send-instagram`, `send-gmail`)
- Mostrar indicador visual del canal activo en el chat

---

## Resumen de cambios propuestos

| # | Problema | Archivos | Dificultad |
|---|----------|----------|------------|
| 1 | last_message_text faltante | migration SQL + trigger | Media |
| 2 | Delete contactos falla | migration SQL (CASCADE o soft-delete) | Media |
| 3 | Dialog aria warnings | ClientDetailDialog, EventDetailDialog | Baja |
| 4 | Cotizar solo chatbot_only | ClientDetailDialog.tsx | Baja |
| 5 | Envio solo por WhatsApp | useMessages.ts, ChatView.tsx | Alta |

## Orden de implementacion recomendado

1. **Problema 3** - Warnings de accesibilidad (rapido, limpia la consola)
2. **Problema 1** - last_message_text (mejora UX inmediata en Inbox)
3. **Problema 4** - Cotizar para todos los modos (cambio pequeno, alto valor)
4. **Problema 2** - Delete contactos (requiere decision de arquitectura)
5. **Problema 5** - Multi-canal (cambio complejo, requiere testing por canal)

