# Verificación final del bot de SOC Ingeniería

## Estado actual (verificado en la base de datos)

- 166 documentos cargados, todos con archivo en storage (164 son PDF).
- 257 fragmentos de conocimiento, **0 sin embedding** (búsqueda híbrida activa al 100%).
- Cada ficha aporta ~1.600 caracteres de texto real, así que la IA sí puede leer el contenido.
- `send_pdf_datasheets` está en **true**.

Es decir: la base técnica está lista. Lo que todavía no está comprobado con evidencia es el comportamiento end-to-end: que responda bien y adjunte la ficha correcta en todos los casos típicos, no solo en los que ya probamos.

Respuesta honesta a "¿responderá todo bien siempre?": para productos **con ficha cargada**, sí debería. Para productos que no están entre esos 166 documentos, el bot no inventará (regla N°1 del prompt) pero tampoco podrá responder: derivará a un especialista. Eso es esperado, no un error.

## Qué propongo hacer antes de darlo por listo

### 1. Ronda de pruebas automatizada (sin tocar código)
Ejecutar contra la lógica real del bot un set de ~12 consultas representativas:

- Código exacto de producto (ej. `SOC170-13EF`) → debe responder con datos de la ficha y adjuntar el PDF.
- Código con formato distinto (minúsculas, con guion/espacio) → mismo resultado.
- Pedido en lenguaje natural ("hidrolavadora de 200 bar") → debe encontrar candidatos vía búsqueda semántica.
- Seguimiento ("sí", "mándame la ficha") tras ofrecer un producto → debe recuperar el SKU del contexto y adjuntar.
- Producto inexistente → NO debe inventar; debe derivar.
- Consulta de precio/stock no documentada → debe derivar sin inventar.

Se registra cada caso: respuesta, si adjuntó PDF, si el PDF corresponde al SKU pedido.

### 2. Informe de resultados
Una tabla con los casos que pasan y los que fallan, con la causa concreta de cada fallo.

### 3. Correcciones dirigidas
Solo si aparecen fallos, y sobre la causa exacta detectada (resolución de SKU, umbral semántico, adjunto o prompt). Sin refactors amplios.

## Detalles técnicos

- Las pruebas se ejecutan invocando la edge function `build-ai-reply` con conversaciones simuladas del workshop SOC Ingeniería, revisando el campo de adjunto (`storage_path` / URL firmada) además del texto.
- No se crean tablas ni se modifica el prompt salvo que una prueba lo justifique.
- Los mensajes de prueba se limpian al terminar para no contaminar el contexto de conversaciones reales.
