
# Plan de Implementacion - 4 Tareas Criticas

## Resumen

Se implementaran 4 mejoras sin romper multi-tenancy, RLS, ni impersonacion.

---

## TAREA 1 - Recuperacion de Contrasena

### Diagnostico
- La pagina de login (`AuthPage.tsx`) no tiene boton "Olvide mi contrasena"
- No existen las rutas `/reset-password` ni `/update-password`
- Supabase Auth ya tiene soporte nativo para `resetPasswordForEmail` y `updateUser`

### Cambios

**1.1 Crear `src/pages/ResetPasswordPage.tsx`**
- Input de email
- Boton "Enviar enlace de recuperacion"
- Llama a `supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/update-password' })`
- Estados: loading, success ("Revisa tu correo"), error
- UX coherente con AuthPage (misma Card, logo, estilo)

**1.2 Crear `src/pages/UpdatePasswordPage.tsx`**
- Input de nueva contrasena (min 6 chars) con confirmacion
- Detecta token de recovery en URL hash (`type=recovery`)
- Llama a `supabase.auth.updateUser({ password: newPassword })`
- Redirige a `/auth` tras exito
- Manejo de token invalido/expirado

**1.3 Modificar `src/pages/AuthPage.tsx`**
- Agregar link "Olvide mi contrasena" debajo del formulario de login que navega a `/reset-password`

**1.4 Modificar `src/App.tsx`**
- Agregar rutas publicas:
  - `/reset-password` -> `ResetPasswordPage`
  - `/update-password` -> `UpdatePasswordPage`

### Seguridad
- No expone datos de usuarios
- No afecta multi-tenancy
- Usa API nativa de Supabase Auth
- No requiere edge functions ni cambios en DB

---

## TAREA 2 - Arreglar Botones Cotizar y Analizar

### Diagnostico

**Boton Analizar (Inbox - ChatView.tsx)**
- Funciona: llama a `analyze-conversation` edge function
- El edge function ya fue corregido para SUPERADMIN (profile lookup via service role, check `role !== 'SUPERADMIN'`)
- Estado: **Funcionando correctamente** tras fixes previos

**Boton Cotizar (ClientDetailDialog.tsx)**
- Llama a `generate-manual-quote` edge function
- **ERROR DE BUILD**: linea 148 tiene `error.message` donde `error` es de tipo `unknown` (TypeScript strict)
- La funcion usa `OPENAI_API_KEY` directamente en vez del gateway de Lovable AI
- No tiene autenticacion (no verifica Authorization header)
- No tiene validacion de workshop_id ni permisos

### Cambios

**2.1 Corregir `supabase/functions/generate-manual-quote/index.ts`**
- Fix build error: cambiar `error.message` a `error instanceof Error ? error.message : 'Unknown error'`
- Cambiar de OpenAI directo a Lovable AI gateway (`https://ai.gateway.lovable.dev/v1/chat/completions` con `LOVABLE_API_KEY`)
- Cambiar modelo de `openai/gpt-5-mini` a `openai/gpt-5-mini` (via gateway)
- Agregar autenticacion: verificar Authorization header
- Agregar validacion de permisos: SUPERADMIN o usuario del mismo workshop
- Usar service role para queries internas (no depender de RLS del caller)

**2.2 Verificar que `quotation_items` table tiene columna `status`**
- La funcion hace `.delete().eq('status', 'pending')` - verificar que la columna existe
- Si no existe, ajustar el query

### Seguridad
- Agrega autenticacion que faltaba
- Valida workshop_id del caller
- Respeta multi-tenancy
- SUPERADMIN puede cotizar para cualquier workshop (impersonacion)

---

## TAREA 3 - Mostrar Mensajes Outbound en Impersonacion

### Diagnostico
- Ya se creo la RPC `get_conversation_messages` (SECURITY DEFINER) en migracion previa
- `useMessages.ts` ya usa esta RPC
- La RPC retorna `id, conversation_id, workshop_id, text, direction, channel, created_at`
- **Problema**: la RPC NO retorna `metadata` (campo JSONB que contiene reasoning del bot, intent, confidence)
- Por eso los mensajes outbound aparecen pero SIN metadata (sin "Bot Meta", sin razonamiento IA)
- La interfaz `Message` en `useMessages.ts` espera `metadata`

### Cambios

**3.1 Actualizar RPC `get_conversation_messages` via migracion SQL**
- Agregar `metadata` a la lista de columnas retornadas:

```text
CREATE OR REPLACE FUNCTION public.get_conversation_messages(_conversation_id uuid)
RETURNS TABLE(
  id uuid,
  conversation_id uuid,
  workshop_id uuid,
  text text,
  direction text,
  channel text,
  created_at timestamptz,
  metadata jsonb          -- NUEVO
)
```

**3.2 Actualizar `useMessages.ts`**
- Asegurar que el tipo de retorno del RPC incluye `metadata`
- El cast `as Message[]` ya deberia funcionar si el RPC retorna el campo

### Seguridad
- No cambia la logica de autorizacion de la RPC
- Solo agrega un campo de lectura adicional
- Respeta SECURITY DEFINER existente

---

## TAREA 4 - Sincronizacion Segura de Schema con GitHub

### Diagnostico
- El proyecto ya usa `supabase/migrations/` con archivos SQL versionados
- Los migrations solo contienen DDL (schema), no datos reales
- El `.gitignore` ya excluye archivos sensibles
- **El schema ya esta versionado correctamente**

### Recomendacion
- **NO se requiere cambio adicional**. El proyecto ya versiona schema via migrations en `supabase/migrations/`
- Los secrets estan en variables de entorno (no en codigo)
- Los tokens/emails/mensajes reales solo estan en la DB en produccion, no en migrations
- Recomendacion: verificar que `.gitignore` incluya `.env`, `supabase/.temp/`, y cualquier archivo con datos sensibles

### Seguridad
- Sin riesgo: solo DDL en migrations
- Sin datos reales expuestos

---

## Archivos a crear/modificar

| Archivo | Accion |
|---------|--------|
| `src/pages/ResetPasswordPage.tsx` | Crear |
| `src/pages/UpdatePasswordPage.tsx` | Crear |
| `src/pages/AuthPage.tsx` | Modificar (agregar link) |
| `src/App.tsx` | Modificar (agregar 2 rutas) |
| `supabase/functions/generate-manual-quote/index.ts` | Modificar (fix build + auth + gateway) |
| `supabase/migrations/XXXX_update_rpc_metadata.sql` | Crear (RPC con metadata) |
| `src/hooks/useMessages.ts` | Verificar (ya deberia funcionar) |

## Orden de implementacion

1. Fix build error en `generate-manual-quote` (desbloquea build)
2. Crear paginas de recuperacion de contrasena
3. Actualizar RPC para metadata
4. Verificar tarea 4 (no requiere cambios)

## Garantias de seguridad

- Multi-tenancy: todas las queries validan workshop_id
- RLS: no se modifican policies existentes
- Impersonacion: AuthContext sigue funcionando igual, RPC respeta SUPERADMIN
- Edge functions: se agrega auth donde faltaba
- No se tocan tablas sensibles ni schemas reservados
