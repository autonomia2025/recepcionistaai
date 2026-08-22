# Diagnóstico: el bot inventa códigos al responder selecciones de menú

## 1. ¿Está leyendo el catálogo cuando recomienda? No.

En la conversación real de Marco, el mensaje que disparó la recomendación fue literalmente `D` (opción del menú de energía). El pipeline de recuperación descarta ese mensaje por completo:

- La búsqueda por palabras clave filtra tokens con `length > 2`. Con `D` no queda ninguna palabra, la función devuelve lista vacía sin consultar la base.
- La búsqueda semántica solo corre si el mensaje tiene 4 o más caracteres (`normalized.length < 4` → return). `D` no llega ahí.
- Resultado: `ragContext` vacío. El modelo respondió únicamente con el historial de chat y su conocimiento propio.

Por eso generó `SOC200/15ACD-C1` por analogía con los `-C2` reales. Verificado en la base: `SOC200/15ACD-C1` aparece en 0 fragmentos; `SOC200/15ACDCARRO2` aparece en 7.

El guardrail antialucinación existente (`isProductQuery && ragEmpty` → handoff) tampoco se activa, porque `D` no contiene ninguna palabra de producto/precio.

## 2. ¿El índice de selección por agua + motorización está completo en los fragmentos? No.

`CATALOGO_BOT_SOC_v2.txt` está partido en 54 chunks y el "ÍNDICE 1 — POR AGUA Y MOTORIZACIÓN" quedó cortado a mitad:

- El chunk 0 empieza con el encabezado del índice y la lista de AGUA CALIENTE · BENCINA, y termina en medio de la lista diésel (`...SOC250/30ACD-SK · 250 bar ·` corte).
- El chunk 1 arranca sin encabezado: `neto SOC250/15ACD · 250 bar...`.

Consecuencia: aunque el RAG recuperara el chunk 1, no hay ninguna señal de que esos equipos son diésel; y si recupera el chunk 0, la lista diésel está incompleta. Esto explica que mezclara `SOC250/30ACB-C2` (bencina) en una recomendación de diésel.

## 3. ¿Hay validación de códigos antes de enviar? No existe.

No hay ninguna verificación de que los códigos citados por la IA existan en el catálogo. Los únicos controles actuales son de precios (bloque `PRECIOS OFICIALES`) y de adjuntos PDF, ambos posteriores y ninguno valida el código en sí.

## Propuesta de corrección (tres capas)

### A. Recuperación consciente del menú
Cuando el mensaje sea una selección de menú (ya detectada por `isMenuSelection`), construir la consulta RAG a partir del texto de la opción elegida en el último mensaje del bot (`D` → "Motor diésel (sin electricidad)") más el filtro ya acumulado en la conversación (agua caliente, uso: piso industrial). Con eso el RAG busca contra el índice real en vez de recibir una letra suelta.

### B. Índice de selección no fragmentable
Reindexar `CATALOGO_BOT_SOC_v2.txt` con corte por secciones: cada bloque `AGUA X · MOTORIZACIÓN Y` queda en un chunk propio y completo, con su encabezado repetido al inicio. Alternativa complementaria: inyectar el ÍNDICE 1 completo como bloque fijo en el prompt cuando la conversación esté en el flujo de diagnóstico (agua + motorización), sin depender del RAG.

### C. Validación de códigos antes de enviar
Cargar una vez por request el conjunto de códigos válidos del catálogo del negocio (parseando `Código exacto:` de los fragmentos, cacheado en memoria por workshop). Antes de enviar:

1. Extraer todos los códigos mencionados en la respuesta generada.
2. Cruzarlos contra el conjunto válido con la normalización que ya existe (`normalizeProductCode`).
3. Si alguno no existe: un reintento único de generación con instrucción explícita ("estos códigos no existen: X; usa solo los del listado") y, si vuelve a fallar, eliminar las líneas que citan el código inválido y registrar el evento en logs para auditoría.
4. Registrar siempre en logs: códigos citados, válidos e inválidos.

Adicional: cuando la conversación tenga filtros activos (agua caliente + diésel), validar también que los códigos recomendados pertenezcan a ese grupo del índice, no solo que existan.

## Archivos afectados

- `supabase/functions/build-ai-reply/index.ts`: consulta RAG derivada de la opción de menú, inyección del índice de selección, validación de códigos y reintento.
- Reindexación del documento del catálogo (`process-rag-document`) para cortar por secciones del índice.

## Validación

- Reproducir agua caliente → E → D y confirmar que las 3 recomendaciones salen de los 7 equipos diésel reales.
- Forzar una respuesta con código inexistente y comprobar que el reintento o el filtrado lo elimina.
- Repetir el caso de ficha por SKU para verificar que no hay regresión en adjuntos ni precios.
