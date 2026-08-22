# Panel de Diagnóstico RAG

Nueva página de solo lectura para entender por qué el bot no encuentra información o inventa datos.

## Alcance

- Nueva página `/rag-diagnostics`, visible solo para ADMIN y SUPERADMIN.
- Nueva edge function `test-rag-search` (única pieza de backend nueva).
- No se toca `build-ai-reply` ni `process-rag-document` en su comportamiento.

## Sección 1 — Salud general

Cuatro tarjetas del negocio actual (respeta la suplantación de Superadmin):

- Total de documentos cargados.
- Documentos con error (rojo si > 0).
- Documentos colgados en "processing" hace más de 15 minutos (ámbar si > 0).
- Total de fragmentos en la base de conocimiento.

## Sección 2 — Tabla de documentos

Columnas: nombre, tipo (pdf / xlsx / web / texto, derivado de `file_type` y extensión), estado con badge (ready verde, processing ámbar, error rojo), fragmentos declarados, fragmentos reales, indicador ⚠️ cuando no cuadran, fecha de carga y mensaje de error completo en un bloque expandible.

Botón "Ver fragmentos" abre un modal con todos los chunks del documento: número, cantidad de caracteres y el texto completo extraído, con scroll. Los fragmentos con menos de 100 caracteres se marcan en rojo (extracción fallida).

## Sección 3 — Probador de búsqueda

Campo de texto + botón "Probar búsqueda". Ejecuta exactamente la misma búsqueda que usa el bot y muestra:

1. Las keywords generadas (códigos de producto detectados, expansión con IA, keywords básicas, versiones sin acento).
2. Cuántos fragmentos se encontraron.
3. Cada fragmento con su contenido y documento de origen.
4. Si no hay resultados: "❌ No se encontraron fragmentos. El bot va a responder sin información de contexto y puede inventar datos."

También se avisa cuando la consulta es un saludo o mensaje corto, porque en ese caso el bot omite la búsqueda a propósito.

## Sección 4 — Últimas respuestas del bot

Los últimos 20 mensajes salientes del negocio, emparejados con el último mensaje entrante previo de la misma conversación: mensaje del cliente, respuesta del bot, fecha/hora y el razonamiento guardado en los metadatos del mensaje cuando exista.

## Navegación

Ítem "Diagnóstico IA" en el menú lateral con ícono Stethoscope, junto a las opciones de configuración, visible solo para ADMIN y SUPERADMIN.

## Detalles técnicos

- Ruta en `src/App.tsx`: `/rag-diagnostics` dentro de `AppLayout`, envuelta en `ProtectedRoute` + `AdminOnlyRoute` (ya existe y cubre ADMIN y SUPERADMIN).
- Página `src/pages/RagDiagnosticsPage.tsx` con hooks de React Query; el `workshop_id` sale de `useAuth()` (`impersonatedWorkshopId ?? profile.workshop_id`).
- Consultas de lectura vía cliente de Supabase sobre `bot_documents` y `bot_knowledge` (agregado de chunks reales por `document_id` en el cliente), y sobre `messages` para la sección 4.
- Compartido: se extrae la lógica de búsqueda actual de `build-ai-reply` (`sanitizeKeyword`, `removeAccents`, `expandQueryWithAI`, `searchKnowledge` y su scoring) a `supabase/functions/_shared/rag-search.ts`. `build-ai-reply` pasa a importarla sin cambios de comportamiento, y `test-rag-search` usa la misma función, para que el resultado sea idéntico al del bot real.
- `supabase/functions/test-rag-search/index.ts`: recibe `{ workshop_id, query }`, valida el JWT y que el usuario sea ADMIN del negocio o SUPERADMIN, y devuelve `{ keywords_generated, results_count, results: [{ content, document_name, chunk_index }] }`. La versión compartida de `searchKnowledge` retorna además las keywords usadas para poder mostrarlas.
- La tabla `messages` no tiene columna `reasoning`; el razonamiento se lee de `metadata` si el campo está presente.
