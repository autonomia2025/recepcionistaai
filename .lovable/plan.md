# Ampliar la capacidad de la base de conocimiento (hasta 1 GB por negocio)

## Situación actual (verificada)

- El subidor limita cada archivo a 100 MB (`DocumentUploader.tsx`) y el bucket privado `bot-documents` también está en 100 MB por archivo.
- El tope real que te bloquea es la **cantidad**: `maxDocuments = 50` en la página del Bot. Con fichas PDF individuales de 1-5 MB, 50 archivos son apenas ~150 MB.
- Cada archivo ya se guarda siempre en almacenamiento privado, así que subir cientos de fichas no rompe el envío de PDF por WhatsApp.

Conclusión: no hace falta subir el límite por archivo. Hay que quitar el tope de cantidad y pasar a un tope por **espacio total** (1 GB), más una subida masiva cómoda.

## Qué se va a hacer

1. **Cuota por espacio, no por cantidad**
   - Se elimina el límite de 50 documentos.
   - Nuevo límite: 1 GB de espacio total por negocio (configurable, se puede subir a 2-5 GB si hace falta).
   - En la página del Bot verás una barra: "312 MB de 1 GB usados · 148 documentos".

2. **Subida masiva de fichas**
   - Podrás arrastrar carpetas completas o cientos de PDFs de una vez.
   - Se procesan en cola de a 3 en paralelo, con progreso por archivo y resumen final ("142 subidos, 2 con error").
   - Si un archivo falla, no detiene el resto: queda marcado y se puede reintentar solo ese.
   - Detección de duplicados por nombre + tamaño, para no cargar dos veces la misma ficha.

3. **Que no pierda efectividad el RAG**
   - Las fichas PDF individuales chicas se siguen procesando igual que hoy (ruta ya probada).
   - Para que la búsqueda no se degrade con cientos de documentos, la búsqueda de fichas seguirá priorizando el PDF exacto por modelo (lógica que ya existe en `_shared/datasheets.ts`), y el reporte de Cobertura de fichas te mostrará al instante cuáles modelos quedaron sin PDF.

4. **Limpieza**
   - Botón para eliminar documentos seleccionados en lote (borra archivo, chunks y registro), para liberar espacio.

## Detalle técnico

- Migración: subir `file_size_limit` del bucket `bot-documents` no es necesario (100 MB por archivo se mantiene); se agrega columna `max_storage_bytes` (default 1073741824) en `workshops` o una tabla de settings, y un índice sobre `bot_documents(workshop_id)` para sumar `file_size` rápido.
- `DocumentUploader.tsx`: reemplazar la validación por `documentCount` con validación por bytes usados (suma de `file_size` de los docs no eliminados) + cola de subida con concurrencia 3 y estado por archivo. `maxFiles` de dropzone pasa a ilimitado.
- `BotSettingsPage.tsx`: cambia `maxDocuments={50}` por la cuota de bytes y muestra el medidor de uso.
- `DocumentList.tsx`: selección múltiple + borrado en lote (storage + `bot_knowledge` + `bot_documents`).
- No se toca `process-rag-document`, `build-ai-reply` ni el webhook de WhatsApp.

## Nota de costo

1 GB de almacenamiento es barato; lo que crece es el procesamiento RAG (una vez por documento) y el tamaño de la tabla de chunks. Con fichas PDF de 1-5 MB, 1 GB ≈ 300-800 fichas, perfectamente manejable.
