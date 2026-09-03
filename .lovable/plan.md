# Diagnóstico: fichas PDF y respuestas que ignoran el prompt (SOC Ingeniería)

No se aplicó ningún cambio. Esto es lo que muestra la evidencia, de más grave a menos grave.

## Hallazgo 1 (grave, activo hoy) — Una respuesta determinística está pisando al modelo

En la conversación real del 3-sep 20:26–20:30 el bot envió **el mismo bloque de menú (A–F) cinco veces seguidas**, sin importar lo que escribió el cliente:

```text
20:26:33  cliente: "barro y grasa, enchufe monofásico 220V"  → menú A–F
20:27:50  cliente: "a"                                        → mismo menú A–F
20:28:17  cliente: "A"                                        → mismo menú A–F
20:28:47  cliente: "cuales son los valores"                   → mismo menú A–F
20:29:48  cliente: "*MH130-10M-I*"                            → mismo menú A–F
```

La pregunta de precios nunca se respondió. Esto **no** es el modelo ignorando el prompt: es la rama determinística de catálogo (`catalogDrivenReply` en `build-ai-reply/index.ts`, bloque ~1259–1290, con el pie fijo "Responde con la letra y te envío su ficha técnica 📄") que se vuelve a disparar en cada turno porque el estado acumulado sigue cumpliendo la condición y no registra que ese bloque ya se envió ni que el cliente ya eligió opción.

Efecto secundario: mientras esa rama está activa, se desactivan el pipeline de fichas y los guardrails (`!catalogDrivenReply`), así que en esos turnos **no puede llegar ningún PDF**.

## Hallazgo 2 (grave) — El texto "no la tengo disponible… te derivo" NO está en el código

Búsqueda en todo el repositorio: la frase reportada no existe como string fijo en `build-ai-reply` ni en ninguna función. Tampoco aparece en la tabla de mensajes. Es **texto generado por el modelo**, inducido por dos reglas del propio system prompt:

- línea 952: instrucción de responder "No tengo esa información…" y marcar `should_handoff=true`
- línea 987: "si el modelo NO aparece en la documentación… deriva con un especialista"

Cuando el bloque de catálogo/precios no entra completo al contexto, el modelo aplica esas reglas y produce la frase, con la redacción casi idéntica en cada caso. Los guardrails posteriores ya no borran la promesa (eso se arregló), pero tampoco corrigen una negación falsa.

Los strings fijos que sí existen y pueden sustituir texto son solo dos:
- `index.ts:1641` "Prefiero no darte un código que no tenga confirmado en catálogo… te derivo" → se dispara si sobreviven códigos que no están en `product_catalog` y no hay adjunto ni código verificado.
- `index.ts:1544–1546` "Te adjunto además la ficha técnica …" → añadido cuando sí hay adjunto.

## Hallazgo 3 — Los PDFs de PWPC120/11M y NEWEN130/10EF-IN sí resuelven

Consulta directa a la base:

| SKU | datasheet_file | documento en storage |
|---|---|---|
| PWPC120/11M | 156_PWPC120-11M.pdf | 1 (OK) |
| NEWEN130/10EF-IN | 101_NEWEN130-10EF-IN.pdf | 1 (OK) |

El mapeo catálogo → documento → URL firmada está sano. Los envíos reales de hoy lo confirman: `041_MH130-10M-I.pdf`, `103_NEWEN170-13EF-AR.pdf`, `160_PWPC200-14T.pdf`, `142_SOC200-30EF.pdf` salieron sin problema. La falla del cliente no está en la resolución del archivo, sino en los turnos donde el pipeline de adjuntos ni siquiera corre (Hallazgo 1) o donde el modelo niega antes de que corra.

## Hallazgo 4 — La opción C sí muestra las dos familias

En la conversación de hoy el bloque llega con **Agua caliente A–C** y **Agua fría D–F** en el mismo mensaje. Ese bug ya no se reproduce con el código en producción.

## Hallazgo 5 — Versión desplegada: no verificable con certeza

`build-ai-reply` no tiene logs recuperables en la ventana disponible, así que no se puede certificar el hash desplegado. Lo que sí demuestra el comportamiento observado hoy (dos listas correctas, PDFs saliendo, sin promesas falsas) es que los arreglos previos **están activos**. Para eliminar la duda hay que hacer un despliegue explícito y dejar registro con timestamp.

## Post-procesamiento actual, en orden

1. Rama determinística de catálogo → puede **reemplazar por completo** la respuesta del modelo (Hallazgo 1).
2. Resolución de fichas → decide adjuntos; no toca texto.
3. Adjunto presente → borra frases contradictorias y recorta a 2 mensajes + línea de entrega.
4. `pdfRequested` sin adjunto → quita la promesa de envío, conserva lo útil, no deriva.
5. `claimsFileDelivery` → quita la promesa, conserva lo útil, no deriva.
6. Validación de códigos contra `product_catalog` → borra la frase con el código inventado; si no queda nada verificable, sustituye por el texto fijo y deriva.

## Qué propongo hacer (pendiente de tu aprobación)

1. Dar estado a la rama determinística: enviar el bloque A–F **una sola vez**; si el cliente ya lo recibió, los turnos siguientes (letra, código, pregunta de precio) pasan al flujo normal con el bloque de precios inyectado.
2. Reactivar el pipeline de fichas y los guardrails en los turnos posteriores al menú, hoy bloqueados por `!catalogDrivenReply`.
3. Suavizar las reglas 952/987 del prompt: solo negar y derivar si el código realmente no está en el catálogo determinístico; si está, responder con sus datos y adjuntar.
4. Añadir un log por turno con: respuesta original de la IA, respuesta final enviada y qué capa la modificó, para tener trazabilidad real de aquí en adelante.
5. Desplegar explícito y registrar timestamp.
