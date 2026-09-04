# Corregir la conversación de JT y recuperar el formato ordenado

## Diagnóstico confirmado

En la conversación real de JT (13:36–13:37):

- La IA generó correctamente tres opciones reales, cada una en su propia línea: A, B y C.
- No hubo error de la IA ni derivación: `should_handoff` quedó en `false`.
- Una capa posterior eliminó la pregunta “¿Te mando la ficha de alguna...?” porque la confundió con una promesa de envío.
- Al hacer esa limpieza, `stripDeliveryClaims` usó una compactación que reemplazó todos los saltos de línea por espacios. Por eso WhatsApp recibió A/B/C pegadas dentro de un párrafo, aunque la respuesta original estaba ordenada.
- El estado persistido también quedó contaminado: interpretó “tenemos 120 vacas” como los códigos `tenemos120` y `120vacas`; además no guardó el uso “sala de ordeña” ni la inferencia de agua caliente. Por eso `catalog_block_rows` fue 0, aunque la IA alcanzó a recomendar modelos reales.

## Cambios

1. **Conservar el formato al limpiar una frase**
   - Quitar únicamente la frase que promete un adjunto inexistente.
   - Mantener exactamente los saltos de línea, letras, negritas y separación entre introducción, lista A/B/C y cierre.
   - No volver a pasar la respuesta completa por una compactación que aplaste el formato.

2. **Distinguir una pregunta de una entrega real**
   - Tratar “¿Te mando la ficha de alguna?”, “¿Quieres que te envíe...?” y equivalentes como invitaciones, no como afirmaciones de que el archivo ya fue enviado.
   - Mantener la regla central: ningún PDF sale hasta que el cliente elija o lo pida.

3. **Evitar códigos falsos en frases normales**
   - Impedir que cantidades seguidas de palabras comunes —por ejemplo “120 vacas”— entren al estado como modelos.
   - Conservar la detección de códigos reales del catálogo y de códigos con barras o guiones.

4. **Persistir correctamente el caso de uso**
   - Reconocer “sala de ordeña”, “ordeña” y contexto lechero como uso.
   - Inferir agua caliente cuando el uso implica grasa/proteína/residuos orgánicos, manteniendo 220V monofásica.
   - Así el bloque determinístico debe contener los 7 equipos reales de agua caliente + 220V, en vez de depender de que la IA los encuentre por casualidad.

## Validación

1. Repetir la conversación de JT turno por turno con historial real.
2. Confirmar estado: uso de sala de ordeña, agua caliente y 220V monofásica; sin `tenemos120` ni `120vacas` como códigos.
3. Confirmar `catalog_block_rows: 7` al llegar al turno de las 120 vacas.
4. Confirmar que WhatsApp recibe una lista visualmente ordenada:

```text
A) MODELO...
B) MODELO...
C) MODELO...
```

5. Confirmar que en ese turno salen 0 PDFs y que al responder con una letra sale únicamente la ficha correspondiente.
6. Desplegar la función y reportar el timestamp UTC.
