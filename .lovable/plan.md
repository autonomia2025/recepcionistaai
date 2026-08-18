# Envío de fichas técnicas en PDF por WhatsApp (solo SOC Ingeniería)

Cuando el bot detecte un código de producto (ej. SOC250) y ese dato provenga de un PDF de la base de conocimiento, además del resumen de texto enviará el PDF original como documento adjunto de WhatsApp.

## Cómo funcionará

1. El cliente escribe "necesito una SOC250".
2. El bot responde el resumen de la ficha como hoy.
3. En paralelo, identifica de qué documento salió el fragmento y, si es un PDF, lo envía como adjunto para que el cliente lo abra dentro de WhatsApp.
4. Se envía una sola vez por conversación y por producto, para no repetir el mismo archivo si el cliente vuelve a preguntar.
5. Si el documento no es PDF (Excel, Word, texto o web), solo se envía el resumen de texto, sin adjunto.

Todo esto queda limitado al negocio SOC Ingeniería mediante una bandera de configuración; ningún otro bot cambia su comportamiento.

## Detalles técnicos

- **Enlace del archivo**: `bot_documents` ya guarda `storage_path` en el bucket privado `bot-documents`. Se generará una URL firmada temporal (24 h) para el envío, sin exponer el bucket públicamente.
- **Envío del adjunto**: `send-whatsapp` gana soporte para mensajes tipo `document` (`type: "document"`, `link`, `filename`, `caption`). Los proveedores Meta y Kapso comparten el mismo formato de Graph API; Twilio usaría `MediaUrl0`. Se respeta la ventana de 24 h vigente.
- **Detección**: en `build-ai-reply`, cuando el match directo de código dispara `buildDocumentedProductReply`, se devuelve también el `document_id` del chunk. Requiere resolver el documento fuente del fragmento de `bot_knowledge` y verificar `file_type = pdf`.
- **Disparo del envío**: el webhook de WhatsApp (`whatsapp-webhook`), tras enviar las respuestas de texto, invoca el envío del documento si `build-ai-reply` lo indicó.
- **Bandera por negocio**: nueva columna booleana en `bot_settings` (por ejemplo `send_pdf_datasheets`), activada solo para SOC Ingeniería, con toggle visible en la página del Bot.
- **Anti-duplicados**: se registra en los metadatos del mensaje saliente el documento enviado y no se reenvía el mismo PDF en la misma conversación dentro de 24 h.

## Consideraciones

- WhatsApp limita los documentos a 100 MB; catálogos muy grandes se envían igual, pero conviene revisar el peso de los PDF cargados.
- Si un PDF es un catálogo completo en vez de una ficha por producto, el cliente recibirá el catálogo entero. Si prefieren fichas individuales, el siguiente paso sería subir un PDF por producto.
