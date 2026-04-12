
## Qué está pasando
Sí, se puede hacer que responda exhaustivamente sobre productos, descripciones y características, pero ahora mismo el problema principal no es solo el scraping: la parte que busca esa información para responder está fallando.

Con lo que revisé en el código y los logs, hay 3 fallas claras:

1. **La búsqueda de conocimiento está rota en consultas con varias palabras**
   - En `build-ai-reply`, la búsqueda arma un filtro `or(...)` con términos como `"máquina abrillantadora"` o `"pulidora de suelos"`.
   - Eso está generando errores de parseo en la consulta (`PGRST100`) y hace que no encuentre chunks.
   - Resultado: el bot responde “sin conocimiento” aunque el documento sí exista.

2. **La expansión de palabras clave con IA es frágil**
   - Los logs muestran `Query expansion error: SyntaxError...`.
   - Eso significa que a veces la IA no devuelve JSON limpio, el parseo falla y se pierde una parte importante de la búsqueda.

3. **El sistema muchas veces responde sin RAG activo**
   - En logs aparece `hasRAG: false` y `AI-enhanced search returned 0 matches`.
   - O sea: el contenido web puede haberse importado, pero al momento de contestar no se está recuperando correctamente.

Además hay un problema secundario:
4. **La generación de embeddings está fallando**
   - `generate-embedding` usa un modelo no soportado (`text-embedding-004`).
   - Hoy no es la causa principal del fallo, porque la búsqueda actual es por texto, no por embeddings.
   - Pero igual conviene corregirlo o desactivarlo bien para no meter errores innecesarios.

## Plan de solución
### 1. Arreglar la recuperación de conocimiento en `build-ai-reply`
- Reemplazar la búsqueda `.or(...)` actual por una estrategia segura:
  - sanitizar términos,
  - separar términos multi-palabra de forma controlada,
  - evitar filtros que rompan el parser,
  - combinar búsqueda por frase + palabras clave simples.
- Subir la cantidad de resultados recuperados para que el contexto sea más completo.
- Priorizar matches por relevancia y evitar devolver solo 5 fragmentos si el sitio es grande.

### 2. Hacer robusta la expansión de consulta con IA
- Cambiar el parseo para tolerar respuestas imperfectas de la IA.
- Si no devuelve JSON válido:
  - fallback a extracción local de keywords,
  - normalización de acentos,
  - singular/plural básico,
  - limpieza de palabras basura.
- Así nunca se cae toda la recuperación por un parseo fallido.

### 3. Mejorar el contenido que genera `scrape-website`
- Mantener el crawl, pero cambiar la salida final para que quede más útil para RAG:
  - una sección por producto,
  - nombre del producto,
  - descripción,
  - características técnicas,
  - precio/cotización,
  - categoría,
  - URL de origen.
- Incluir más estructura por página para que luego las búsquedas por nombre/modelo funcionen mejor.
- Registrar mejor cuántos productos/categorías se extrajeron y si hubo truncamiento del modelo.

### 4. Corregir o neutralizar el flujo de embeddings
- Arreglar `generate-embedding` para no usar un modelo inválido, o dejar explícitamente desactivado si no se usará.
- Evitar que el pipeline registre errores ruidosos mientras procesa documentos web.

### 5. Mejorar la visibilidad para diagnosticar calidad
- En el preview del documento, mostrar mejor el contenido importado desde web para revisar si realmente están quedando productos y fichas.
- Agregar más logs útiles:
  - keywords finales usadas,
  - cantidad de matches,
  - nombres de documentos consultados,
  - si la respuesta salió con o sin contexto RAG.

### 6. Reprocesamiento de documentos web ya cargados
- Como el contenido viejo puede haber quedado mal indexado o mal resumido, voy a dejar el flujo listo para:
  - borrar documento web viejo,
  - reimportar la web,
  - volver a probar en el simulador.
- Si hace falta, también dejaré una opción de “reimportar sitio” más clara.

## Resultado esperado
Después de estos cambios, cuando preguntes por productos como “abrillantadoras”, “hidrolavadoras”, “extractores”, modelos o características:
- el bot sí debería encontrar el contenido del sitio,
- responder con descripciones reales del catálogo,
- mencionar características técnicas y contexto comercial,
- y dejar de caer en respuestas genéricas de derivación cuando sí hay información cargada.

## Detalle técnico
- Archivos principales a revisar/modificar:
  - `supabase/functions/build-ai-reply/index.ts`
  - `supabase/functions/scrape-website/index.ts`
  - `supabase/functions/generate-embedding/index.ts`
  - posiblemente `supabase/functions/process-rag-document/index.ts`
  - opcionalmente `src/components/bot/DocumentList.tsx`

- Hallazgos exactos detectados:
  - `build-ai-reply/index.ts`: el `.or(allKeywords.map(...).join(','))` está provocando errores con términos complejos.
  - logs:
    - `Knowledge search error: PGRST100`
    - `Query expansion error: SyntaxError`
    - `Using system prompt ... hasRAG: false`
    - `AI-enhanced search returned 0 matches`
  - `generate-embedding/index.ts`: usa `text-embedding-004`, que no está permitido por el gateway actual.

## Qué haré al implementar
1. Reescribir la búsqueda de RAG para que sea estable.
2. Reforzar el fallback de keywords.
3. Mejorar la extracción estructurada del scraping.
4. Corregir el error de embeddings.
5. Validar que el simulador realmente reciba contexto RAG.
6. Reimportar la web y probar preguntas reales de productos end-to-end.
