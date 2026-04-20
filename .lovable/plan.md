

## Diagnóstico

**1. STAFF ve todas las zonas en el Inbox**
- En `InboxPage.tsx`, el dropdown `zoneFilter` se muestra cuando `workshop_id === SOC_WORKSHOP_ID` para **cualquier rol**, y el filtro inicial es `'all'`. El STAFF puede cambiar entre Santiago, Talca y Puerto Montt manualmente.
- En `useConversations.ts` ya existe filtro por `contacts.zone` para STAFF, pero el `inner` join + el dropdown de UI permiten al STAFF ver/cambiar zonas igualmente.

**2. STAFF ve métricas de todo el workshop en el Dashboard**
- `DashboardPage.tsx` hace `count` de conversations/contacts/appointments/messages **sin filtrar por zona**. El STAFF de Talca ve el total de SOC Ingeniería completo (Santiago + Talca + Puerto Montt).
- Además se renderiza `<ZoneMetrics>` que muestra tabs con todas las zonas — STAFF no debería ver eso.

**3. La invitación entra directo a la app sin pedir contraseña**
- En `AcceptInvitePage.tsx` hay un `useEffect` (líneas 104-116) que auto-acepta el invite si `user` ya está logueado, **sin mostrar el formulario de contraseña**.
- Caso típico: el invitado fue creado vía Supabase Auth (signInWithOtp/magic link/edge function), abre el link de invitación ya con sesión activa → el efecto dispara `acceptInviteWithRetry()` directamente y lo lleva a `/dashboard` **sin que jamás haya creado su propia contraseña**.

---

## Plan

### Paso 1 — Forzar creación de contraseña en `AcceptInvitePage.tsx`

- **Eliminar el `useEffect` de auto-aceptación** (líneas 104-116). El usuario SIEMPRE debe pasar por el formulario.
- Si detectamos que `user` ya tiene sesión activa al abrir el link, mostrar un nuevo card con dos opciones:
  - **"Crear contraseña ahora"** (opción primaria) → form que llama `supabase.auth.updateUser({ password })` y luego `accept_invite`. Garantiza que el invitado defina su propia contraseña antes de entrar.
  - **"Cerrar sesión y empezar de nuevo"** (secundaria) → `signOut()` y vuelve al modo signup normal.
- Validar email match: si la sesión activa no coincide con `invite.email`, forzar signOut.
- Mantener el flujo signup/login existente para usuarios no logueados.

### Paso 2 — Restringir zonas en el Inbox para STAFF

**`src/pages/InboxPage.tsx`:**
- Mostrar el dropdown de zona **solo** si el usuario es ADMIN o SUPERADMIN del workshop SOC. STAFF nunca lo ve.
- Si el STAFF tiene `profile.zone`, fijar `zoneFilter` automáticamente a esa zona (no editable) y mostrar un badge visual "Zona: Santiago" en el header (no como dropdown).
- Asegurar que `filteredByZone` aplique siempre el zone del STAFF aunque el state local intente otra cosa.

**`src/hooks/useConversations.ts`:** ya filtra por `contacts.zone` para STAFF — verificar que el `!inner` join no dé conversaciones sin zona. Cambiar de `contacts!inner` a filtro explícito que excluya conversaciones cuyos contactos no tengan zona asignada cuando el STAFF tiene zona.

### Paso 3 — Restringir métricas en Dashboard para STAFF

**`src/pages/DashboardPage.tsx`:**
- Detectar `staffZone = profile.role === 'STAFF' ? profile.zone : null`.
- Si `staffZone` existe, cambiar las queries de count para usar joins/filtros por zona:
  - `contacts`: agregar `.eq('zone', staffZone)`
  - `conversations`: hacer query con `contacts!inner(zone)` y filtrar `contacts.zone = staffZone` (igual que en useConversations)
  - `appointments`: igual, join con contacts y filtrar por zona
  - `messages`: join con conversations.contacts.zone, filtrar
  - `closedClients`: `.eq('zone', staffZone)`
- **Ocultar `<ZoneMetrics>` para STAFF** (solo ADMIN/SUPERADMIN ve las tabs cross-zone).
- Cambiar el título del banner del STAFF: "Estás viendo solo las métricas de tu zona: **Santiago**".

### Paso 4 — Verificar filtros consistentes en otras páginas STAFF

Revisar rápido `ClientsPage`, `RequestsPage`, `CalendarPage` para confirmar que también filtran por zona cuando el usuario es STAFF con zona asignada. Si no lo hacen, agregar el mismo filtro `.eq('zone', staffZone)` en sus hooks de datos. (Solo lectura — confirmaré durante implementación si necesitan cambios.)

---

## Archivos a modificar

| Archivo | Cambio |
|---|---|
| `src/pages/AcceptInvitePage.tsx` | Eliminar auto-accept; forzar form de contraseña incluso para usuarios logueados |
| `src/pages/InboxPage.tsx` | Ocultar dropdown de zona a STAFF; fijar zona automáticamente |
| `src/hooks/useConversations.ts` | Reforzar filtro de zona para STAFF |
| `src/pages/DashboardPage.tsx` | Filtrar todas las métricas por `staff.zone`; ocultar `ZoneMetrics` a STAFF |
| `src/hooks/useServiceRequests.ts`, `useCalendarEvents.ts` (si aplica) | Agregar filtro por zona del STAFF |

No tocaré: `AppSidebar`, `App.tsx` (route guards ya están), migraciones SQL, `ZoneMetrics` component (solo lo oculto a STAFF), ni el flujo de invitación email.

