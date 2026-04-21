

## Plan: Soporte real para archivos hasta 100MB en base de conocimiento

Sí se puede hacer 100MB sin perder efectividad. La clave es **cambiar el pipeline**, no solo subir el límite. Aquí están las soluciones a cada cuello de botella.

---

### Solución 1 — Subir vía Storage, no en base64 por el body

**Problema actual:** el archivo se convierte a base64 en el navegador y se manda en el body de la edge function. 100MB en base64 = 133MB en JSON = el navegador y la edge function colapsan.

**Solución:** subir el archivo directo a Supabase Storage (`bot-documents` bucket) usando upload chunked nativo, y pasar solo la URL/path a la edge function.

- `DocumentUploader.tsx`: reemplazar el flujo base64 por `supabase.storage.from('bot-documents').upload(path, file)`. El SDK ya hace upload por chunks, soporta archivos grandes sin tocar memoria del browser de forma agresiva.
- La edge function recibe `{ document_id, workshop_id, storage_path }` y descarga el archivo desde storage cuando lo necesita.

**Resultado:** elimina el límite de body de edge function (que ronda los 6MB efectivos por la sobrecarga de base64).

---

### Solución 2 — Procesamiento por páginas/lotes en background

**Problema actual:** Gemini procesa el PDF entero de una vez con `max_tokens: 16000`. Un PDF de 100 páginas devuelve solo las primeras ~25 páginas.

**Solución:** dividir el PDF en lotes de páginas y procesar cada lote por separado.

- Nueva función `process-rag-document-large` que:
  1. Descarga el PDF desde Storage.
  2. Usa `pdf-lib` (Deno-compatible) para dividir el PDF en lotes de **10 páginas**.
  3. Procesa cada lote con Gemini en paralelo (máx 3 concurrentes para no saturar rate limits).
  4. Concatena el texto extraído.
  5. Hace chunking y guarda en `bot_knowledge`.
- Subir `max_tokens` de 16.000 → **32.000** por lote (Gemini 2.5 Flash lo soporta).
- Estado del documento se actualiza progresivamente: `processing` → `processing (45/100 páginas)` → `ready`. El usuario ve progreso real.

**Resultado:** un PDF de 100MB / 200 páginas se procesa completo, sin perder contenido.

---

### Solución 3 — Procesamiento asíncrono con cola

**Problema actual:** edge functions de Supabase tienen límite de ~150 segundos. Un PDF de 100MB tarda más.

**Solución:** patrón async ya usado en el proyecto (igual que `scrape-website` según `mem://technical/web-scraping-architecture-async`).

- `DocumentUploader` invoca la función y retorna inmediato con `status: 'queued'`.
- La edge function usa `EdgeRuntime.waitUntil()` para procesar en background sin bloquear la respuesta HTTP.
- El frontend hace polling al estado del documento (o usa Realtime sobre `bot_documents`) para mostrar progreso.

**Resultado:** sin timeouts. El usuario sube y sigue trabajando.

---

### Solución 4 — Chunking inteligente para mantener calidad RAG

**Problema actual:** búsqueda por palabra clave (no embeddings reales) se diluye con documentos enormes.

**Solución:** chunking más granular con metadata enriquecida.

- Reducir tamaño de chunk: de actual a **500-800 caracteres con overlap de 100**.
- Añadir metadata por chunk: `{ source_file, page_number, section_title, chunk_index }`.
- En `build-ai-reply`, cuando se recupere un chunk, incluir el nombre del archivo y página en el contexto que se pasa al modelo. Así el bot puede responder "según el manual X, página 12...".
- Para PDFs >50MB, generar un **resumen ejecutivo** del documento completo (1-2 páginas) que se inyecta siempre al system prompt como contexto general, y los chunks específicos como detalle.

**Resultado:** mejor recuperación, respuestas con citación de fuente, y el bot no se pierde en docs grandes.

---

### Cambios concretos

**Frontend — `src/components/bot/DocumentUploader.tsx`**
- `MAX_FILE_SIZE`: 10MB → **100MB**.
- Reemplazar lectura como base64 por `supabase.storage.from('bot-documents').upload()`.
- Cambiar `maxDocuments` default a **50**.
- Mostrar barra de progreso de upload (Storage SDK lo soporta).
- Mostrar estado de procesamiento en tiempo real (suscripción Realtime a `bot_documents`).
- Mensajes claros: "Subiendo... 45%", "Procesando página 12 de 80", "Listo".

**Frontend — `src/components/bot/DocumentList.tsx`**
- Mostrar progreso (`processing_progress` nuevo campo).
- Indicador visual de tamaño del archivo.

**Frontend — `src/pages/BotPage.tsx`**
- Pasar `maxDocuments={50}`.
- Activar Realtime subscription para refrescar la lista automáticamente.

**Backend — Migración SQL**
- Añadir columnas a `bot_documents`: `processing_progress INT DEFAULT 0`, `total_pages INT`, `processed_pages INT`, `storage_path TEXT`.
- Configurar bucket `bot-documents` con `file_size_limit: 104857600` (100MB).
- Activar Realtime sobre `bot_documents` para el frontend.

**Backend — `supabase/functions/process-rag-document/index.ts`**
- Aceptar `storage_path` en vez de `file_content` (mantener compatibilidad temporal con base64 para archivos pequeños <5MB).
- Descargar desde Storage con `supabase.storage.from('bot-documents').download(path)`.
- Para PDFs: usar `pdf-lib` para detectar número de páginas y dividir en lotes de 10.
- Procesar lotes con concurrencia limitada (p-limit pattern, máx 3 paralelos).
- Subir `max_tokens` de Gemini a 32.000.
- Usar `EdgeRuntime.waitUntil()` para background processing.
- Actualizar `processing_progress` después de cada lote.
- Manejo robusto de errores: si falla un lote, reintentar 2 veces antes de marcar el documento parcial.

**Backend — `supabase/functions/build-ai-reply/index.ts`**
- Incluir `file_name` y `page_number` (si existe en metadata) en el contexto que se pasa al modelo.
- Para workshops con muchos documentos grandes, recuperar más chunks (de 5 → 10) y dejar que el modelo filtre.

---

### Recomendaciones de uso para el cliente final

Cuando entregues el bot, el sistema mostrará tooltips con:
- **PDFs con texto nativo (no escaneados):** hasta 100MB OK, mejor calidad.
- **PDFs escaneados (imágenes):** mejor mantener bajo 30MB (OCR es más lento).
- **Word/Excel/PPT:** hasta 100MB OK, procesamiento muy rápido.
- **Tip dorado:** dividir manuales muy largos por capítulos sigue dando mejor calidad de respuesta, aunque ya no sea obligatorio.

---

### Lo que NO cambia

- Tipos de archivo aceptados (los mismos).
- RLS policies (siguen igual, solo se ajusta tamaño en bucket).
- Bots ya entrenados (cero impacto, los documentos viejos siguen funcionando).
- Integraciones (WhatsApp, Instagram, Gmail, Calendar): cero impacto.

### Resultado esperado

- Archivos hasta **100MB** (10x el límite actual).
- Hasta **50 documentos** por bot (5x).
- Capacidad total: **5 GB** por bot.
- **Sin pérdida de contenido** en PDFs grandes (procesamiento por lotes).
- **Sin timeouts** (procesamiento async en background).
- **Mejor calidad RAG** con citación de fuente y chunking refinado.
- Progreso en tiempo real visible para el usuario.

