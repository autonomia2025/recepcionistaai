# Arreglar el envío del PDF de ficha técnica por WhatsApp

## Qué pasó (verificado en datos y logs)

Se comparó las dos conversaciones de SOC Ingeniería de hoy:

- Número 56938959429: escribió *"necesito una SOC250"* → el PDF se envió correctamente (mensaje `📄 Ficha técnica enviada: 004_SOC250-30ACB-C2_V2.pdf` con adjunto registrado).
- Número 56962284484 (Erwin): escribió *"ok me puedes enviar la ficha tecnica"*, *"la tienes en pdf"*, *"si pdf por whatsapp"*, *"si"* → nunca envió el código del producto en el mensaje, y no se registró ningún adjunto. Peor aún, el bot respondió *"Te envío ahora por este WhatsApp el PDF..."* sin haberlo enviado.

Causa: el adjunto solo se genera cuando el mensaje **actual** contiene un código de producto exacto (SOC250) que coincide con un fragmento del PDF. Si el cliente pide el PDF con frases genéricas o respondiendo "sí", no hay código en ese mensaje, el adjunto queda nulo y no se envía nada.

## Cómo se arregla

1. **Memoria del producto en la conversación**: al detectar un código de producto, se guarda cuál documento se está hablando. Si en los siguientes mensajes el cliente pide el PDF ("mándamelo", "sí", "la tienes en pdf"), se usa ese documento aunque el mensaje no repita el código.
2. **Intención de "quiero el PDF"**: se detecta la petición explícita de archivo/ficha/catálogo y se dispara el adjunto con el documento en contexto.
3. **Sin promesas falsas**: si no hay adjunto disponible, el bot no dirá "te envío el PDF"; ofrecerá el resumen técnico o derivar a un vendedor.
4. Se mantiene la regla de no reenviar el mismo PDF dos veces en 24 h dentro de la misma conversación.

## Detalles técnicos

- `build-ai-reply`: además del `directCodeMatch` del mensaje actual, buscar el último código de producto mencionado en los últimos N mensajes de la conversación (histórico ya cargado) y resolver su `document_id` desde `bot_knowledge`. Nuevo `pdfRequestRe` (pdf, ficha, archivo, adjunto, documento, catálogo, "envíamelo") + confirmaciones cortas ("si", "dale", "ok") cuando el turno previo del bot ofreció el PDF.
- Guardar el documento en contexto en `conversations.metadata` (o campo equivalente ya existente) para que sobreviva entre invocaciones.
- Ajuste de prompt: instrucción explícita de no afirmar el envío de archivos; el envío lo confirma el sistema con el mensaje del adjunto.
- `whatsapp-webhook`: sin cambios estructurales; ya envía `type: document` y registra `attachment_document_id`.
- Redeploy de `build-ai-reply`.
