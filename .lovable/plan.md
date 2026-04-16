

## Diagnóstico

Tres problemas distintos:

**1. STAFF ve todo como si fuera ADMIN** (puede configurar el bot, ve todas las opciones)
- Las rutas/menús no están restringidos por rol. STAFF debería ver solo: Inbox, Solicitudes, Clientes, Calendario, Dashboard. NO debería ver: Bot, Automatizaciones, Equipo, Configuración Email, Wizard, etc.
- Esto es un bug de autorización en `AppSidebar.tsx` y posiblemente falta de guards de ruta en `App.tsx`.

**2. STAFF no ve para qué empresa trabaja ni su zona**
- En sesiones previas se intentó agregar esto a `AppSidebar` y al `DashboardPage`, pero el usuario reporta que no aparece — probablemente no está visible o no se guarda el `workshop_id`/`zone` correctamente al aceptar el invite.
- Hay que verificar qué muestra realmente la sidebar y reforzar.

**3. El invitado debe crear su propia contraseña**
- Hoy `AcceptInvitePage` tiene 2 modos confusos: "signUp" (crear cuenta) y "login" (existente). Cuando el admin invita por email, Supabase puede o no crear el row en `auth.users` dependiendo del flujo del Edge Function `create-workshop-user`.
- El usuario quiere flujo limpio: **el invitado siempre crea su contraseña** la primera vez, sin confusión.

---

## Plan

### Paso 1 — Restringir UI por rol (lo más crítico)

**`src/components/layout/AppSidebar.tsx`**: filtrar items del menú por rol.
- STAFF ve solo: Dashboard, Inbox, Solicitudes, Clientes, Calendario.
- ADMIN ve todo lo del workshop (incluido Bot, Automatizaciones, Equipo, Email, Wizard).
- SUPERADMIN ve todo + sección admin.

**`src/App.tsx`**: agregar guard `<RoleProtectedRoute requiredRoles={['ADMIN','SUPERADMIN']}>` en rutas sensibles (`/bot`, `/bot-settings`, `/automations`, `/team`, `/email-settings`, `/landing-wizard`). Si un STAFF intenta entrar por URL directa, redirigir a `/dashboard`.

### Paso 2 — Reforzar visibilidad de empresa + zona para STAFF

**`src/components/layout/AppSidebar.tsx`** (footer del usuario):
- Hacer query simple a `workshops` para obtener `name` por `profile.workshop_id`.
- Mostrar siempre debajo del rol: nombre del workshop (con ícono Building2) y, si tiene `zone`, badge con color por zona (Santiago=azul, Talca=verde, Puerto Montt=violeta).

**`src/pages/DashboardPage.tsx`**: banner superior solo para STAFF: "Bienvenido, [nombre]. Trabajas en [empresa] · Zona [zona]". Fondo `bg-primary/5 border-primary/20`.

### Paso 3 — Flujo de creación de contraseña limpio

**`src/pages/AcceptInvitePage.tsx`**: simplificar a un solo modo "Crea tu cuenta":
- Mostrar siempre el formulario de signup (nombre + contraseña). Email pre-rellenado y deshabilitado.
- Mostrar la **zona asignada** en la card antes del formulario (badge), además del workshop y rol.
- Al submit:
  1. `supabase.auth.signUp(email, password, { data: { full_name }})`
  2. Si error "already registered" → mostrar mensaje claro: "Ya tienes una cuenta. Ingresa tu contraseña existente para unirte" + cambiar a campo de password de login.
  3. Esperar 800ms (para que el trigger `handle_new_user` cree el profile).
  4. Llamar `accept_invite(token)` con retry (2 intentos espaciados 500ms).
  5. `refreshProfile()` y `navigate('/dashboard')`.
- Eliminar el `useEffect` de auto-aceptar para usuarios ya logueados durante submit (causa race conditions).
- Toggle secundario "Ya recibí un correo de acceso" solo si quieren login OTP.

### Paso 4 — Endurecer RPC `accept_invite` (migración SQL)

Bug actual en el RPC: marca el invite como `accepted` aunque no se haya actualizado ningún profile (ROW_COUNT = 0). Esto deja invites "fantasma" imposibles de reusar.

Nueva migración:
- Mover `UPDATE invites SET status='accepted'` DENTRO del bloque `IF v_profile_exists > 0`.
- Si no hay profile aún, RAISE EXCEPTION 'Profile not yet created, retry' (sin tocar el invite).
- Data fix: revertir invites con `status='accepted'` cuyo email no exista en `auth.users` → volver a `pending` con `expires_at = now() + 7 days`.

---

## Archivos a modificar

| Archivo | Cambio |
|---|---|
| `src/components/layout/AppSidebar.tsx` | Filtrar menú por rol; mostrar workshop name + zona en footer |
| `src/App.tsx` | Agregar `RoleProtectedRoute` en rutas sensibles |
| `src/pages/DashboardPage.tsx` | Banner contextual para STAFF |
| `src/pages/AcceptInvitePage.tsx` | Flujo único "crea contraseña", mostrar zona, retry RPC, sin race |
| `supabase/migrations/<new>.sql` | Endurecer RPC + limpiar invites fantasma |

No tocaré: `AuthContext`, `UserSettingsDialog`, `TeamPage`, `RequestsPage`, `ConversationList` (ya están bien de las tareas previas).

