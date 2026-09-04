# Por qué se mandaron 3 fichas en un turno de diagnóstico (hoy 13:21–13:22)

## Traza turno por turno (health_logs)

| Entrante | Capa | Adjuntos | Qué pasó |
|---|---|---|---|
| "necesito una hidrolavadora monofasica" | none | 0 | Pregunta de diagnóstico, correcto |
| "para lavar la sala de ordeña, tenemos 120 vacas" | **post_processing** | **3 PDFs** | La IA sí generó la lista A/B/C con equipos reales y cerró con *"¿Te parece si te dejo la ficha de alguna para que veas el consumo de agua?"*. Una capa posterior resolvió 3 fichas, **borró la lista A/B/C** y la reemplazó por la frase con los nombres de archivo |
| "queda con olor..." | none | 0 | Dio precios de esos 3 equipos |

## Respuestas a tus tres preguntas

1. **La frase "Te adjunto además 3 fichas técnicas en PDF: …" no la generó la IA.** Está construida por código (`build-ai-reply`, línea 1667), con los nombres de archivo interpolados. Por eso narra `167_PWSB120-11MBPVAPOR` etc.: el prompt v12 nunca la ve.
2. **Lo que disparó `resolvePdfDatasheets` fue la propia respuesta del bot, no el cliente.** El código considera "el bot prometió una ficha" cuando el texto contiene *"te dejo"* / *"te adjunto"* / *"te envío"*. La frase de invitación *"¿Te parece si te dejo la ficha de alguna?"* cae en ese patrón, y la lista de excepciones de invitaciones no la cubre. Al marcarse como promesa, se extraen los códigos **de la respuesta del bot** y se resuelven sus PDFs.
3. **Por qué 3 de golpe:** al ser la respuesta la fuente de códigos, entraron los tres de la lista A/B/C y el presupuesto de adjuntos es de 3. Además, tras adjuntar, el bloque se queda solo con los 2 primeros trozos de texto y agrega la línea de entrega — por eso desapareció la lista con letras y el cliente nunca pudo elegir.

Tu sospecha del bloque de catálogo no fue la causa: en ese turno `catalog_block_rows` era 0. Los códigos salieron del texto que la IA acababa de escribir.

## Arreglo propuesto

1. **Regla dura: la ficha solo se adjunta si el cliente la pide.** Eliminar la respuesta del bot como fuente de códigos para adjuntos (`replyClaimsDelivery` deja de disparar `resolvePdfDatasheets`). Los disparadores válidos quedan: código escrito por el cliente, selección de una opción del menú, o pedido explícito de ficha/PDF.
2. **Nunca varias fichas sin pedirlas.** Presupuesto de 1 ficha por defecto; solo se permiten varias cuando el cliente nombra varios modelos en su mensaje.
3. **No narrar nombres de archivo.** La línea de entrega pasa a nombrar el modelo comercial (por ejemplo *MH130-10M-I*), no el archivo `041_MH130-10M-I.pdf`; si son varias, "Te adjunto las fichas de X y Z".
4. **No borrar la lista de opciones.** Cuando hay adjunto, la línea de entrega se agrega como mensaje extra sin recortar la recomendación con letras.
5. La promesa incumplida se sigue limpiando: si el bot dice que envía una ficha y no hay adjunto, se quita esa frase (comportamiento actual, se conserva).

## Validación antes de cerrar

1. Replay del caso de la sala de ordeña: en el turno de diagnóstico debe salir la lista A/B/C **sin ningún PDF**.
2. Al responder "la B", debe llegar **una sola** ficha, la de ese equipo, con el nombre del modelo y sin nombre de archivo.
3. "mándame las fichas de la A y la C" → dos fichas.
4. Un turno donde el bot ofrece la ficha sin que el cliente responda: cero adjuntos.
5. Confirmar timestamp de despliegue.
