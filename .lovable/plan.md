# Traza real de la conversación con José Luis (3-sep, 17:36–17:38 hora Chile)

## Turno por turno (health_logs, categoría `bot`, conversación `c1d1e84f…`)

| Hora UTC | Entrante | IA original | Enviado | Reescritura | should_handoff |
|---|---|---|---|---|---|
| 21:36:11 | "necesito una hidrolavadora monofasica" | Saludo + preguntas de diagnóstico | idéntico | no | false |
| 21:37:17 | "en lugares distintos" | Carro de transporte + pregunta grasa/barro | idéntico | no | false |
| 21:37:53 | "agua fria" | **"Gracias por tu mensaje. Un asesor te contactará pronto."** | idéntico | no | **true** |

Respuestas a tus tres preguntas del último turno:

1. **No hubo reemplazo por post-procesamiento.** `rewritten: false`, `catalog_driven: false`, `attachments: []`. La traza registra ese texto ya como `ai_original`, porque la traza se toma después del parseo.
2. **La IA no marcó handoff.** El modelo sí generó la recomendación correcta (SOC200/15AFBC y SOC250/15AFBA, `should_handoff: false`, confidence 0.98). Se perdió al parsear.
3. **No le llegó el bloque de catálogo.** Log de la función: `Catalog layer: { skus: 162, priceRows: [], block: null, blockRows: 0 }`. El bloque AGUA FRÍA + ELÉCTRICA 220V con sus 10 equipos **no** se construyó; el modelo respondió solo con RAG (4 fragmentos semánticos + 6 keyword).

## Dónde está el string

`supabase/functions/build-ai-reply/index.ts:1225`, dentro del `catch (parseError)` del bloque 1198–1231. Condición exacta que lo dispara: `JSON.parse` del contenido de la IA falla (o falta `replies`) **y** el texto crudo empieza con `{`, por lo que `usableProse` queda nulo y se usa el genérico con `should_handoff: true`.

Por qué falló el parseo esta vez: la IA devolvió un JSON válido **con una llave `}` de más al final**. El extractor actual solo recorta prosa cuando el texto **no** empieza con `{`; aquí empezaba con `{`, así que pasó tal cual a `JSON.parse` y reventó.

## Plan de arreglo (2 fallas independientes)

### Falla A — parseo frágil (causa directa del mensaje genérico)
En `build-ai-reply/index.ts`, reemplazar el parseo por un extractor robusto:
- Recortar siempre desde el primer `{` hasta la **última llave que balancea** el objeto (escaneo de llaves respetando strings y escapes), en lugar de asumir que empieza bien formado.
- Reintento: si el primer intento falla, probar recortes progresivos y, como último recurso, extraer `replies` por regex.
- Solo si todo falla, usar el fallback — y en ese caso registrarlo en `health_logs` con `layer: 'parse_fallback'` y el crudo, para que sea visible en la traza (hoy aparece como si fuera la respuesta de la IA).
- Registrar en la traza el `ai_raw` cuando hubo fallback, para no confundir de nuevo el origen.

### Falla B — el bloque de catálogo no se construyó
El estado acumulado detectó `agua: "agua fría"`, pero `motor` quedó `null` pese a que el cliente dijo "monofásica" en el primer mensaje y "lugares distintos" en el tercero. Sin motorización no se resuelve el bloque (`block: null`), así que el modelo no recibió los 10 equipos.
- Ampliar la extracción de motorización en `buildConversationState` para reconocer monofásica/220V/trifásica/380V/bencina/diésel a lo largo de **todo** el historial, no solo del mensaje actual.
- Cuando agua + motor estén definidos, resolver el bloque del catálogo determinístico e inyectarlo en el contexto con todos sus equipos (la recomendación inicial sigue limitada a 2–3 en el prompt).
- Log explícito del bloque resuelto y su conteo, para verificación.

## Validación antes de cerrar
1. Replay del flujo de José Luis: monofásica → lugares distintos → agua fría debe entregar equipos del bloque agua fría + 220V, con `block` no nulo y `blockRows = 10` en logs.
2. Test de parseo con JSON con llave extra, con fences y con prosa envolvente: los tres deben producir la respuesta real de la IA, nunca el genérico.
3. Confirmar timestamp de despliegue.
