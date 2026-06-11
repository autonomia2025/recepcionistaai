## Estado

✅ **Migración ya aplicada**: el índice único de `message_batches` ahora es parcial (solo lotes activos) y se eliminaron los lotes zombies. Esto **soluciona el bug principal**: el bot ya no se quedará bloqueado en mensajes posteriores.

## Cambio pendiente (requiere modo build)

Endurecer `supabase/functions/whatsapp-webhook/index.ts` para evitar futuras regresiones:

- En el bloque `finally` del procesamiento del batch: en vez de `UPDATE is_completed = true`, hacer `DELETE` del batch.
- Loggear el error si la operación falla (antes era silencioso, lo que ocultó este mismo bug).
- Fallback: si el DELETE falla, intentar el UPDATE como respaldo.

Razón: el batch es solo coordinación efímera de 8s. Borrarlo al terminar simplifica la lógica y elimina cualquier riesgo de violación de unicidad en el futuro.

Cambia a modo build y aplico esta única edición (no consume créditos extra significativos — es un solo archivo, pocas líneas).