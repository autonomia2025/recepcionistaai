# Corregir selección de menú interceptada por el guardrail PDF

## Diagnóstico confirmado

En la conversación real de **JT** (`39403937-d8ec-4b56-8864-669254fbd891`) ocurrió este flujo:

- `H` → abrió el diagnóstico de hidrolavadoras.
- `E` → seleccionó piso industrial.
- primera `C` → seleccionó grasa y barro y avanzó a energía.
- segunda `C` → la IA sí fue llamada, pero su respuesta fue reemplazada por el guardrail PDF.

El texto exacto está hardcodeado en `supabase/functions/build-ai-reply/index.ts`, dentro del bloque final de control de adjuntos, actualmente en las líneas **1288–1297**. Se dispara cuando:

```text
attachments.length === 0 && claimsFileDelivery === true
```

`claimsFileDelivery` considera que la respuesta generada por la IA promete una ficha si coincide con expresiones como “adjunto”, “envío” o “ficha técnica”. Entonces sustituye toda la respuesta por el mensaje fijo de la línea 1293.

La evidencia del caso JT muestra que para el mensaje `C`:

- no hay código de producto (`currentCodes` queda vacío);
- `pdfRequested` no se activa por la letra;
- no se intenta resolver un SKU desde el historial;
- pero la respuesta posterior de la IA coincide con `claimsFileDelivery` y el guardrail la reemplaza.

Por tanto, la causa confirmada está en el postprocesamiento de adjuntos; no en el prompt ni directamente en `resolvePdfDatasheets`.

## Implementación

1. Añadir un detector de **selección de menú** antes de toda la lógica PDF:
   - mensaje actual: exactamente una letra `A-Z` o un solo número;
   - último mensaje `outbound`: contiene un menú estructurado con opciones por letra o número;
   - validar además que la opción escrita exista en ese menú, para no excluir mensajes cortos que no sean selecciones válidas.

2. Cuando sea una selección de menú:
   - dejar que la IA interprete la opción usando el historial;
   - omitir extracción de SKU y recuperación de contexto para fichas;
   - omitir resolución de PDF;
   - omitir ambos guardrails finales que reemplazan la respuesta por falta de adjunto;
   - registrar en logs que se detectó una selección de menú para poder auditarla.

3. Mantener intacto el flujo de seguimiento de fichas:
   - `sí, mándame la ficha` no coincide con una selección de un carácter;
   - seguirá activando `pdfRequested`, recuperando el SKU reciente y resolviendo el PDF como en el caso 14.

## Validación

- Reproducir de punta a punta el diagnóstico: `H → E → C → C`.
- Confirmar que la segunda `C` llega a la IA como “Motor a bencina” y avanza hasta una recomendación documentada de equipos, sin disparar el mensaje fijo.
- Repetir el caso 14: consulta por SKU → `sí, mándame la ficha`; confirmar respuesta útil y PDF adjunto.
- Añadir controles de regresión para:
  - selección por letra repetida en menús consecutivos;
  - selección por número en menú numerado;
  - un carácter que no aparece entre las opciones, que no debe clasificarse como selección válida.
- Revisar los logs de la llamada real y confirmar que no haya errores ni derivación falsa por PDF.

## Archivos

- `supabase/functions/build-ai-reply/index.ts`: detección anticipada y exclusión del pipeline PDF para selecciones de menú.
- Prueba de regresión existente del bot, o un test enfocado nuevo si el proyecto no tiene cobertura automatizada para este flujo.
