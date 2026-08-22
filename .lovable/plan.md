# Pruebas reales del bot de SOC Ingeniería

## Estado verificado ahora mismo

- Envío de fichas PDF: activado
- Fragmentos de conocimiento: 305, todos vectorizados (0 sin embedding)
- Documentos PDF disponibles en storage: 164
- Última ronda automatizada: 16/16 casos correctos (precios reales, PDF como complemento, sin invención)

El sistema está listo para pruebas reales tal como está. No hace falta ningún cambio previo.

## Qué haré durante tus pruebas

1. Tú escribes por WhatsApp al número de SOC como si fueras cliente (consulta de producto, pedir ficha, preguntar precio, mensaje ambiguo).
2. Me avisas y reviso en el momento: logs de `build-ai-reply`, SKU detectado, fragmentos recuperados, PDF resuelto y enviado.
3. Si algo falla, te digo la causa exacta (no adivinada) y propongo el arreglo puntual antes de tocar nada.

## Qué reportar si algo sale mal

- El mensaje exacto que enviaste
- La hora aproximada
- Qué esperabas (ficha, precio, derivación a humano)

Con eso rastreo la conversación específica en la base y en los logs.

## Nota técnica

No se modifica código en esta etapa. Solo observación y diagnóstico sobre `build-ai-reply`, `_shared/datasheets.ts` y `whatsapp-webhook`. Cualquier corrección se plantea como cambio aparte y acotado.
