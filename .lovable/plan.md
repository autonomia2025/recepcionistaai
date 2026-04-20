

## Aclaración importante

La info que te pasaron está **equivocada en parte**: en el **Lovable AI Gateway**, `openai/gpt-5-mini` **sí es un modelo válido y funcional** (no es lo mismo que la API directa de OpenAI). Los logs lo confirman: `build-ai-reply` está respondiendo con status 200 y resultados correctos usando ese modelo.

`gpt-4o-mini` **NO existe** en Lovable AI Gateway — los modelos disponibles son `openai/gpt-5`, `openai/gpt-5-mini`, `openai/gpt-5-nano`, `openai/gpt-5.2`, y la familia `google/gemini-*`. Cambiar a `gpt-4o-mini` rompería las funciones.

## Lo que sí conviene arreglar

Hay un modelo realmente obsoleto: `process-rag-document/index.ts` usa `google/gemini-1.5-flash` que **ya no está soportado**.

## Plan

**`supabase/functions/process-rag-document/index.ts`**
- Cambiar `google/gemini-1.5-flash` → `google/gemini-2.5-flash` (modelo balanceado vigente, equivalente directo)

**No tocaré:**
- `build-ai-reply` (gpt-5-mini funciona perfecto, logs confirman status 200 con respuestas formateadas correctas)
- `analyze-conversation` (gpt-5-mini funciona, logs muestran extracción correcta de `quotation_items`, `intent`, `lead_score`)
- `generate-manual-quote` (gpt-5-mini válido)
- `gemini-2.5-flash-lite` en el RAG search de build-ai-reply (modelo vigente y barato)

## Archivos a modificar

| Archivo | Cambio |
|---|---|
| `supabase/functions/process-rag-document/index.ts` | `gemini-1.5-flash` → `gemini-2.5-flash` |

Si después de leer esto quieres igual cambiar `gpt-5-mini` a otra cosa (por ejemplo `google/gemini-2.5-flash` que es su equivalente y suele ser más barato), dímelo y lo incluyo. Pero **no a `gpt-4o-mini`** porque ese no existe en el gateway y romperíamos las funciones.

