

## Plan aprobado: Opción C — Hardening mínimo sin tocar integraciones

Solo lo crítico que NO rompe funcionalidades existentes. Cero cirugía de tokens.

---

### Cambio 1 — Cerrar `bot_settings` al público anónimo

**Problema:** la política `Anyone can view bot_settings for active workshops` permite a cualquier visitante anónimo leer `system_prompt`, `services_json`, `faq_json`, `handoff_rules_json`, `urgency_rules_json` de TODOS los negocios activos. Riesgo: scrapers de competencia copian prompts y precios internos.

**Solución:**
1. Migración SQL:
   - DROP de la política `Anyone can view bot_settings for active workshops`.
   - Crear RPC `get_public_bot_config(_workshop_id uuid)` SECURITY DEFINER + `SET search_path = public` que retorna SOLO campos seguros: `tone`, `business_description`, `welcome_message` derivado (si existe en services). NO expone `system_prompt`, NO `services_json` con precios, NO `handoff_rules_json`, NO `urgency_rules_json`, NO `faq_json` interno.
   - GRANT EXECUTE a anon, authenticated.
2. Auditar uso público: las edge functions (`build-ai-reply`, `web-chat`, `web-chat-widget`) usan service_role → siguen funcionando sin cambios. La página `BookingPage` y el widget público no leen `bot_settings` directamente (usan `landing_config` y `landing_services`) → sin cambios de frontend esperados, pero se verificará con grep.

**Riesgo de regresión:** Bajo. Si algún componente público lee `bot_settings` directo, lo migramos a la nueva RPC en el mismo ciclo.

---

### Cambio 2 — Bucket `quotations` con signed URLs

**Estado actual:** bucket ya es privado (`Is Public: No`). El riesgo es que `generate-manual-quote` esté retornando URLs públicas que no funcionan o, peor, que algún componente esté guardando paths y exponiéndolos.

**Solución:**
1. Auditar `supabase/functions/generate-manual-quote/index.ts`:
   - Si retorna `getPublicUrl()` → cambiar a `createSignedUrl(path, 3600)` (1 hora).
   - Si retorna el path directo → agregar paso de signed URL antes de devolver.
2. Auditar componentes que muestran el PDF de cotización para que usen la signed URL retornada por la función (no construyan URL pública).
3. No requiere migración SQL (bucket ya privado).

**Riesgo de regresión:** Muy bajo. Solo afecta cotizaciones nuevas; las viejas con URL guardada siguen accesibles si el path se conserva (regenerable on-demand).

---

### Cambio 3 — Activar HIBP (Leaked Password Protection)

**Solución:** llamar a `configure_auth` con `password_hibp_enabled: true`.

**Efecto:** nuevos signups y cambios de contraseña son rechazados si la password está en la base de Have I Been Pwned. Usuarios existentes no se ven afectados.

**Riesgo de regresión:** Cero. Solo agrega validación.

---

### Cambio 4 — Reemplazar `USING(true)` permisivo en políticas de service_role

**Problema:** 6 políticas tienen `USING(true)` / `WITH CHECK(true)`. Hoy funcionan bien porque solo edge functions con service_role las usan, pero si en el futuro se asigna esa policy al rol equivocado → fuga total.

**Tablas afectadas:**
- `appointment_actions` → `Service role can manage appointment_actions`
- `internal_notification_logs` → `Service role can manage internal_notification_logs`
- `message_batches` → `Service role can manage batches`
- `email_reminder_logs` → `Service role can insert email_reminder_logs`
- `health_logs` → `Service role can insert health_logs`
- `monthly_reports` → `Service role can manage monthly_reports`

**Solución (1 migración SQL):**
- DROP cada política y recrear con `USING (current_setting('role', true) = 'service_role') WITH CHECK (current_setting('role', true) = 'service_role')`.

**Riesgo de regresión:** Bajo. Las edge functions usan `SUPABASE_SERVICE_ROLE_KEY` → `current_setting('role')` retorna `'service_role'` → policies siguen permitiendo. Verificación post-deploy con un mensaje WhatsApp de prueba (genera registro en `message_batches` y `health_logs`).

---

### Lo que NO se toca (cero riesgo)

- Tokens de WhatsApp/Instagram/Twilio en `workshops` → SE QUEDAN donde están.
- `google_refresh_token` en `profiles` → SE QUEDA donde está.
- RLS de tablas de negocio (contacts, conversations, messages, appointments).
- Lógica del bot, RAG, Firecrawl scraping.
- Realtime, hooks, frontend en general.

---

### Archivos / acciones

| Acción | Detalle |
|---|---|
| Migración SQL #1 | DROP política pública de `bot_settings` + crear RPC `get_public_bot_config` |
| Migración SQL #2 | Reemplazar 6 políticas `USING(true)` por chequeo explícito de `service_role` |
| Edit `supabase/functions/generate-manual-quote/index.ts` | Cambiar a signed URL si aplica |
| Edit componentes que muestren cotizaciones | Usar signed URL retornada |
| Plataforma | `configure_auth` con `password_hibp_enabled: true` |
| Verificación grep | Confirmar que ningún componente público lee `bot_settings` directo |

---

### Auditoría post-implementación

Tras aplicar todo, verifico:

1. **Web chat widget público** sigue cargando y respondiendo (usa service_role, no afectado).
2. **Booking page pública** sigue listando servicios y permitiendo reservar.
3. **WhatsApp inbound** crea `message_batches` y `health_logs` correctamente con la nueva policy estricta.
4. **Recordatorios email** registran en `email_reminder_logs`.
5. **Cotización manual**: generar una nueva, descargar PDF vía signed URL, abrir y validar.
6. **Signup nuevo** con password débil tipo "123456" es rechazado por HIBP.

Reporto bugs encontrados con propuesta de fix antes de cerrar.

---

### Resultado esperado

- Cierre de la fuga de prompts/configuración de bots a scrapers anónimos.
- Cotizaciones blindadas con expiración temporal.
- Defensa en profundidad en políticas de service_role.
- Protección contra contraseñas filtradas para nuevos usuarios.
- Cero impacto en integraciones vivas (WhatsApp, Instagram, Gmail, Calendar, Twilio).

