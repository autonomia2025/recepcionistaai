# Segunda ronda de pruebas del bot (SOC Ingeniería)

Objetivo: re-ejecutar los 14 casos de la ronda anterior contra el bot ya corregido (5 arreglos aplicados) y entregar la tabla comparativa antes/después.

Esta ronda escribe datos temporales en la base (contacto y conversaciones de prueba) e invoca la función de IA, por eso requiere tu aprobación.

## Qué se ejecuta

1. Crear un contacto temporal `QA Test Bot` y una conversación por caso, en el negocio SOC Ingeniería.
2. Invocar el motor de respuesta (`build-ai-reply`) una vez por caso, capturando: texto de respuesta, adjuntos resueltos, `should_handoff` y latencia.
3. Para el caso de seguimiento ("sí, mándame la ficha"), sembrar historial previo con un SKU mencionado.
4. Borrar todo el contacto, conversaciones y mensajes de prueba al terminar.

## Casos (16)

| # | Caso | Criterio de éxito |
|---|---|---|
| 1 | Saludo genérico "hola" | Muestra menú, sin inventar |
| 2 | Opción de menú "H" | Entra a la línea correcta |
| 3 | SKU exacto `SOC170-13EF` | Responde datos + adjunta PDF, sin pedir el código |
| 4 | SKU con espacios `soc170 13ef` | Igual que #3 |
| 5 | SKU en minúsculas sin guion | Igual que #3 |
| 6 | SKU con `/` en el código | Adjunta el PDF correcto |
| 7 | Dos SKU en un mismo mensaje | Adjunta ambos PDF |
| 8 | Primer mensaje con consulta técnica directa | Responde la consulta, NO muestra menú antes |
| 9 | Lenguaje natural ("hidrolavadora 170 bar") | Encuentra el modelo por búsqueda semántica |
| 10 | SKU inexistente | Dice que no está documentado + handoff, sin inventar |
| 11 | Marca de competencia (Kärcher) | No inventa, ofrece equivalente propio si aplica |
| 12 | Línea sin documentación (abrillantadoras) | Deriva sin inventar modelos |
| 13 | Producto que no comercializan pero existe en el mercado | Ofrece equivalente propio o deriva |
| 14 | Seguimiento "sí, mándame la ficha" | Recupera el SKU del historial y adjunta |
| 15 | Pregunta de precio | Responde según documentación o deriva, sin inventar |
| 16 | Consulta mixta (producto + horario/contacto) | Responde ambas partes |

## Entrega

- Tabla de resultados con estado por caso (OK / Parcial / Falla), qué adjuntó y observación.
- Comparación contra la ronda anterior (qué se arregló, qué sigue fallando).
- Lista de causas raíz de los fallos que queden, **sin aplicar correcciones** hasta que las apruebes.

## Detalles técnicos

- Datos de prueba insertados vía SQL y eliminados al final (contacto, conversaciones, mensajes, batches).
- Invocación directa de la edge function `build-ai-reply` (no pasa por WhatsApp; no se envían mensajes reales a ningún número).
- Se registra el `attachments[]` devuelto para verificar la resolución de PDF sin gastar envíos.
