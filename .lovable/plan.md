# Corregir definitivamente el envío de fichas de José Luis

## Diagnóstico confirmado

En la conversación real de José Luis del **7-sep-2026, 14:50–14:59 UTC** ocurrió esto:

- El bot ofreció tres equipos reales: `PWP100/7M`, `NEWEN100/12EF-AR` y `PWPC130/10M`.
- José Luis respondió **“los precios y fichas”**, una solicitud explícita de las tres fichas.
- El sistema detectó la intención de pedir fichas, pero terminó con `attachments: []` y registró: **“No se pudo preparar el adjunto”**.
- Los tres PDF sí existen, están procesados y tienen archivo disponible. La configuración de envío de fichas también está activa.
- Por lo tanto, el problema no está en los archivos ni en Kapso: se corta **antes del envío**, al intentar recuperar los modelos desde el mensaje anterior.

### Causa exacta

La recuperación revisa el mensaje anterior con un extractor demasiado amplio. Además de los tres códigos, interpreta medidas del texto como posibles códigos —por ejemplo `100 bar` o `7 L/min`—. Como obtiene más de tres candidatos, descarta **todo el mensaje** por considerarlo ambiguo. Así pierde justamente `PWP100/7M`, `NEWEN100/12EF-AR` y `PWPC130/10M`, aunque estaban claramente presentados como opciones.

Además, la regla actual limita a una sola ficha cuando el cliente no vuelve a escribir cada código. Esto no representa correctamente una petición plural como **“los precios y fichas”** referida a las tres opciones recién mostradas.

## Corrección

1. **Recuperar únicamente códigos SOC válidos del historial**
   - Usar el extractor estricto que exige el formato real de producto con letras, números y `/` o `-`.
   - No considerar presión, caudal, voltaje ni cantidades como códigos.

2. **Vincular la petición con la lista mostrada**
   - Cuando el cliente diga “las fichas”, “fichas de esas”, “envíamelas” o equivalente plural, tomar los códigos de la última lista de opciones enviada por el bot.
   - Mantener el orden A/B/C de esa lista.

3. **Aplicar correctamente singular y plural**
   - “La ficha”, una selección como “la B” o un código concreto: enviar solo ese PDF.
   - “Las fichas” después de una lista: enviar los PDF de las opciones mostradas, con el límite de seguridad existente de tres archivos.
   - Una petición ambigua sin lista ni código: no adivinar modelos.

4. **Trazabilidad del resultado**
   - Registrar códigos recuperados, archivos resueltos y, si alguno falla, la razón concreta por cada código.
   - Mantener intacta la respuesta útil y añadir la confirmación de entrega en un mensaje separado.

## Validación y despliegue

1. Reproducir el flujo exacto de José Luis: agua fría + 220V → lista A/B/C → “los precios y fichas”.
2. Confirmar que se preparan exactamente los tres PDF existentes:
   - `PWP100/7M`
   - `NEWEN100/12EF-AR`
   - `PWPC130/10M`
3. Validar “la B” → solo `NEWEN100/12EF-AR`.
4. Validar “la ficha” sin selección clara → no enviar un archivo arbitrario.
5. Confirmar que la lista y los precios conservan sus saltos de línea y que los adjuntos son mensajes separados.
6. Desplegar `build-ai-reply`, ejecutar las pruebas sobre la versión desplegada y reportar resultados con timestamp UTC.
