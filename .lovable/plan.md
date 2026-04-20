

## Plan aprobado: Pasos 1 + 2 (Anti-alucinación + Firecrawl)

Dejamos el Paso 3 (WooCommerce REST API) para más adelante.

---

### Paso 1 — Reforzar anti-alucinación en `build-ai-reply`

**`supabase/functions/build-ai-reply/index.ts`:**
- Agregar al system prompt una sección **REGLA ANTI-INVENCIÓN** explícita:
  > "PROHIBIDO inventar productos, categorías, precios, marcas, servicios o características que no aparezcan literalmente en el bloque de CONOCIMIENTO. Si el cliente pregunta por algo que no está documentado, responde: *'No tengo esa información específica documentada, déjame conectarte con un ejecutivo'* y marca `should_handoff: true`."
- Si la búsqueda RAG devuelve 0 chunks relevantes para una consulta de producto/precio/categoría → forzar handoff automático y respuesta de derivación, sin permitir que el modelo improvise.
- Loggear en `health_logs` (tipo `info`) cada vez que se dispare el handoff por RAG vacío para auditoría: *"Handoff por falta de conocimiento: query=...".*

### Paso 2 — Firecrawl como nuevo motor de scraping universal

**Conectar Firecrawl** (vía `standard_connectors--connect` con `connector_id: firecrawl`):
- Te lo pediré al ejecutar. Firecrawl renderiza JavaScript, evita anti-bot y devuelve markdown limpio. Es el estándar para scraping moderno.

**Reemplazar `supabase/functions/scrape-website/index.ts`:**
- Eliminar el crawler BFS + regex actual.
- Usar Firecrawl REST v2:
  1. `POST https://api.firecrawl.dev/v2/crawl` con:
     - `url`: el sitio del usuario
     - `limit: 50`
     - `excludePaths: ['/cart', '/checkout', '/mi-cuenta', '/wp-admin', '/wp-login', '/feed']`
     - `scrapeOptions: { formats: ['markdown'], onlyMainContent: true }`
  2. Polling a `GET /v2/crawl/{id}` cada 5s hasta `status === 'completed'` (dentro de `EdgeRuntime.waitUntil`).
  3. Concatenar el `markdown` de cada página con separador `===== PÁGINA: {url} =====`, capear a 500K chars.
  4. Actualizar `bot_documents` (`file_size`, `status`) y llamar `process-rag-document` con el texto agregado.
  5. En caso de error o timeout (>5 min), marcar documento `status: 'error'` con mensaje claro.
- Header `Authorization: Bearer ${FIRECRAWL_API_KEY}` (el connector lo inyecta).

### Paso 3 — Backfill SOC

Una vez desplegado Firecrawl:
- Borrar el documento actual `🌐 soc.cl` de `bot_documents` (RAG corrupto).
- Re-importar `https://www.soc.cl` desde la UI del bot → ahora con renderizado JS real.
- Validar en el simulador del bot:
  - Preguntas sobre productos reales → responde con datos del RAG.
  - Preguntas sobre productos ficticios → responde *"no tengo esa información, te derivo con un ejecutivo"* y NO inventa.

---

## Archivos a modificar

| Archivo | Cambio |
|---|---|
| `supabase/functions/build-ai-reply/index.ts` | Sección REGLA ANTI-INVENCIÓN + handoff forzado cuando RAG vacío + log a `health_logs` |
| `supabase/functions/scrape-website/index.ts` | Reemplazo completo: BFS+regex → Firecrawl `/v2/crawl` + polling async |

## Acciones de plataforma

- Conectar Firecrawl al proyecto (te pediré aprobación al iniciar).
- Después de desplegar, ejecutar borrado del documento SOC y re-importar.

No tocaré: `process-rag-document`, RLS, filtros de zona, ni `analyze-conversation`. WooCommerce queda pendiente para cuando lo decidas.

