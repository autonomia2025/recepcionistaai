

# Plan: Ordenar Clientes por Ultimo Contacto + Mobile-First

## Dos cambios principales

---

## 1. Ordenar clientes por ultimo mensaje (como Inbox)

**Problema actual:** La query de clientes ordena por `lead_score DESC`. El admin no ve quien le escribio mas recientemente.

**Solucion:** Hacer un LEFT JOIN con `conversations` para obtener el `MAX(last_message_at)` por contacto, y ordenar por esa fecha descendente (mas reciente primero). Tambien mostrar "hace X minutos" en la UI.

**Cambios en `ClientsPage.tsx`:**
- Modificar la query para hacer una segunda consulta a `conversations` agrupada por `contact_id`, obteniendo el `MAX(last_message_at)` de cada contacto
- Merge el resultado con los contactos y ordenar por `last_contact_at` DESC
- Agregar campo visual "Ultimo contacto: hace 2h" en cada fila (visible en mobile y desktop)
- La interfaz de contacto incluira `last_contact_at` como campo nuevo

**No se necesita migracion SQL** - la data ya existe en `conversations.last_message_at`.

---

## 2. Mobile-First para todo el software

**Principio:** No cambiar NADA en desktop (md+ breakpoints). Solo mejorar la experiencia en pantallas < 768px.

### 2a. ClientsPage - Vista mobile de cards en vez de tabla

En mobile, reemplazar la tabla (que se corta) por una lista de cards compactas con la info clave:
- Nombre + emoji de score
- Telefono
- Score badge
- "Hace 2h" (ultimo contacto)
- Boton de acciones

La tabla desktop se mantiene identica.

### 2b. DashboardPage
- Ya usa `grid-cols-1 sm:grid-cols-2` - esta bien
- No requiere cambios

### 2c. CalendarPage
- El FullCalendar ya es responsive
- No requiere cambios significativos

### 2d. TeamPage
- Ya usa Cards que se apilan en mobile
- No requiere cambios

### 2e. BotSettingsPage
- Formularios se apilan naturalmente
- El ChatSimulator se esconde en mobile con `hidden lg:block` actualmente - hacer visible en mobile como tab o debajo del form

### 2f. RequestsPage
- El Kanban es horizontal - en mobile, forzar vista "lista" por defecto en vez de kanban
- Las columnas kanban overflow horizontal ya existen

### 2g. AutomationsPage / EmailSettingsPage
- Formularios simples, ya responsive
- No requiere cambios

### 2h. Sidebar (AppSidebar)
- Ya tiene soporte mobile con hamburger menu + overlay
- El breakpoint es `1023px` - cambiar a `767px` para alinear con `md` de Tailwind y que tablets vean el sidebar fijo
- **DECISION:** Mantener como esta (1023px) ya que en tablets el sidebar ocupa mucho espacio y es mejor como drawer

### 2i. AppLayout header
- Ya tiene boton hamburger `md:hidden`
- Esta correcto

---

## Resumen de archivos a modificar

| Archivo | Cambio |
|---------|--------|
| `src/pages/ClientsPage.tsx` | Query con last_contact_at + sort + mobile card view |
| `src/pages/BotSettingsPage.tsx` | Mostrar ChatSimulator en mobile |
| `src/pages/RequestsPage.tsx` | Default a vista lista en mobile |

## Orden de implementacion

1. ClientsPage: query + sort + mobile cards
2. BotSettingsPage: ChatSimulator visible en mobile
3. RequestsPage: default list view en mobile

