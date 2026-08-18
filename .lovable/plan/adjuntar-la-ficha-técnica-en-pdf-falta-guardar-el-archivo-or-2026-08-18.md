# Adjuntar la ficha técnica en PDF: falta guardar el archivo original

## Estado actual (verificado)

El PDF `004_SOC250-30ACB-C2_V2.pdf` se volvió a subir hoy 18:41 y quedó `status: ready`, pero su `storage_path` sigue vacío en la base de datos. Ninguno de los 3 documentos cargados tiene archivo guardado.

Causa: el subidor solo guarda el archivo en el almacenamiento cuando supera un umbral de tamaño. Los archivos pequeños (como esta ficha) se envían directo a procesar en base64 y nunca se archivan, así que después no hay nada que adjuntar por WhatsApp.

Entonces: **no, todavía no funciona el envío del PDF** — no por la lógica del bot, sino porque el archivo original no se está conservando.

## Qué se va a hacer

1. Guardar SIEMPRE el archivo original en el almacenamiento privado al subirlo, sin importar el tamaño, y registrar su ruta en el documento.
2. Mantener el procesamiento actual tal cual (base64 para archivos chicos, descarga desde almacenamiento para los grandes) — no se toca la calidad del RAG ni el flujo de chunks.
3. Volver a subir la ficha de SOC250 desde la página del Bot para que quede archivada, y verificar que el enlace firmado se genere bien.
4. Prueba end-to-end: escribir "necesito una SOC250" por WhatsApp y confirmar que llega el PDF adjunto con el caption de ficha técnica.

## Detalle técnico

- `src/components/bot/DocumentUploader.tsx`: eliminar la bifurcación por `SMALL_FILE_THRESHOLD` para la subida al bucket `bot-documents`. La subida al storage pasa a ser incondicional; el `storage_path` se guarda siempre en `bot_documents`. Para archivos chicos se sigue enviando también `file_content` en base64 a `process-rag-document` para no cambiar la ruta de procesamiento probada.
- Si la subida al storage falla en un archivo chico, no se aborta el proceso: se registra la advertencia y se continúa con el procesamiento RAG (el PDF simplemente no quedará adjuntable).
- No se modifican `process-rag-document`, `build-ai-reply` ni `whatsapp-webhook`; esa lógica ya está desplegada y correcta.
