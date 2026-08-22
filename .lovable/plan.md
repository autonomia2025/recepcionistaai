# Corregir las invenciones del bot (SOC Ingeniería)

Tres frentes, en orden de impacto: activar búsqueda semántica real, afinar el ranking y corregir el prompt.

## 1. Embeddings y búsqueda semántica

Hoy los 257 fragmentos de SOC están sin embedding, porque la función `generate-embedding` es un stub que devuelve `null` (se escribió cuando la pasarela de IA no ofrecía embeddings; hoy sí los ofrece). Resultado: la búsqueda es solo literal.

- Reescribir `generate-embedding` para llamar al endpoint de embeddings de Lovable AI con `google/gemini-embedding-2`, manejando 429/402/403 según corresponde.
- Migración: la columna `bot_knowledge.embedding` es `vector(768)` y está 100% vacía, así que se redimensiona a `vector(3072)` y se crea el índice HNSW sobre `embedding::halfvec(3072)`. Se actualiza `match_bot_knowledge` a la nueva dimensión (manteniendo su control de acceso y `search_path`).
- Ejecutar `backfill-embeddings` por lotes hasta cubrir los 257 fragmentos actuales (y los de Ecosan y AulaCDP).
- `process-rag-document` ya llama a `generate-embedding` al indexar, así que los documentos nuevos quedan cubiertos automáticamente sin tocar esa función.

## 2. Búsqueda híbrida y ranking

En `build-ai-reply`, la búsqueda pasa a combinar dos señales en vez de una:

- Semántica: `match_bot_knowledge` con el embedding de la consulta (resuelve el caso "máquina para lavar a presión" contra un documento que dice "hidrolavadora").
- Literal: la búsqueda por palabras actual, que sigue siendo la mejor para códigos exactos tipo SOC250/15ACD.

Se fusionan resultados sin duplicados, los códigos exactos mantienen su prioridad y se conserva el tope de 6 fragmentos. Además:

- Se baja el umbral actual de "mínimo 2 coincidencias de palabras" cuando la consulta tiene una sola palabra útil, que hoy puede devolver cero resultados aunque el dato exista.
- Se penalizan los fragmentos del Excel guía (`Col2 / Col3 / Col26…`) frente a las fichas PDF cuando ambos empatan, para que gane la ficha del producto.

No se cambia el comportamiento de derivación ni la lógica de adjuntar PDF.

## 3. Prompt de SOC Ingeniería

El prompt personalizado (28.087 caracteres) abre definiendo al bot como "un vendedor técnico senior que se sabe los productos de memoria", y su menú de apertura ofrece 12 líneas de producto de las cuales solo hidrolavadoras está documentada (0 fragmentos de abrillantadoras, por ejemplo). Esa combinación es la invitación directa a improvisar.

- Quitar la frase de "se sabe los productos de memoria" y reemplazarla por una definición equivalente que ancle las respuestas a la documentación.
- Poner la regla anti-invención al inicio del prompt, no enterrada después de miles de líneas de instrucciones de venta.
- Ajustar el menú de apertura: hidrolavadoras como línea asesorable en línea y el resto marcadas explícitamente como "te derivo con un especialista", para que el bot no se sienta obligado a responder por líneas sin respaldo.

Los cambios de prompt se aplican sobre el registro de configuración del bot de SOC Ingeniería, no en el código.

## Verificación

- Confirmar que los 257 fragmentos quedan con embedding.
- Probar consultas reales contra la búsqueda: un código exacto (`SOC250/15ACD`), un sinónimo ("máquina para lavar a presión") y una línea no documentada ("abrillantadoras"), verificando que las dos primeras devuelvan fragmentos correctos y la tercera derive a un ejecutivo sin inventar.
- Revisar los logs de `build-ai-reply` para ver cuántos fragmentos entrega cada consulta.

## Detalles técnicos

- Archivos: `supabase/functions/generate-embedding/index.ts` (reescritura), `supabase/functions/build-ai-reply/index.ts` (búsqueda híbrida y ranking), migración SQL para la columna, el índice y `match_bot_knowledge`.
- `process-rag-document` queda intacto.
- Modelo de embeddings: `google/gemini-embedding-2` (3072 dims), llamado solo desde el backend con `LOVABLE_API_KEY`.
- El backfill corre en lotes para respetar el límite de 100 entradas por solicitud del proveedor.
