# Cerrar y validar los 3 bugs de SOC Ingeniería

## Estado confirmado

- **Catálogo agua fría + 220V:** existen **10 equipos** en `product_catalog`.
- **Bloque que recibe el bot:** `fetchCatalogBlock` no tiene límite y entrega los **10 equipos**; el texto de contexto también incluye los 10.
- **Causa del BUG 2:** después de generar la respuesta, `selectRepresentativeRows(..., 3)` reduce la salida visible a solo **3 modelos**. Por eso el catálogo está completo internamente, pero el cliente no ve todas las alternativas.
- **PDFs:** `PWPC120/11M` y `NEWEN130/10EF-IN` tienen un archivo canónico en catálogo y un documento `ready` con ruta de almacenamiento válida.
- **Configuración:** el envío de fichas está activado para SOC Ingeniería.
- **Despliegue anterior:** el código local contiene los arreglos, pero no hay logs recientes de `build-ai-reply` que permitan certificar de forma independiente qué versión está activa. Para eliminar la ambigüedad, se hará un despliegue explícito después del ajuste.

## Implementación

1. **Eliminar el recorte del flujo “más modelos”**
   - Mantener la consulta completa de los 10 equipos.
   - Excluir los códigos ya mostrados en el historial.
   - Entregar todos los modelos restantes del bloque, no una muestra de 3.
   - Si la lista requiere varios mensajes, dividirla sin perder equipos ni derivar a una persona.

2. **Mantener los arreglos de BUG 1 y BUG 3**
   - Resolver cada PDF primero mediante `product_catalog.datasheet_file`.
   - Si un PDF no puede prepararse, conservar la respuesta útil y omitir solo la promesa de adjunto, sin derivación automática.
   - Para opción C, construir dos listas separadas: agua caliente y agua fría.

3. **Desplegar de forma explícita**
   - Desplegar `build-ai-reply` junto con sus módulos compartidos actualizados.
   - Confirmar que la función desplegada responde y registrar la versión/resultado del despliegue.

## Validación con resultados visibles

Ejecutar y mostrar la salida real de estos cuatro flujos:

1. **Agua fría + 220V → “dame más modelos”**
   - Mostrar cantidad del catálogo, cantidad del bloque interno y todos los modelos entregados al cliente.
   - Criterio: 10 en catálogo, 10 en bloque y ninguna alternativa disponible omitida por un límite artificial.

2. **Opción C: grasa y barro**
   - Mostrar la respuesta completa.
   - Criterio: dos listas separadas, una de agua caliente y otra de agua fría, con códigos válidos del catálogo.

3. **Ficha `PWPC120/11M`**
   - Mostrar texto, `attachments[]`, nombre del PDF y estado de handoff.
   - Criterio: adjunta `156_PWPC120-11M.pdf`, conserva la respuesta útil y no deriva.

4. **Ficha `NEWEN130/10EF-IN`**
   - Mostrar texto, `attachments[]`, nombre del PDF y estado de handoff.
   - Criterio: adjunta `101_NEWEN130-10EF-IN.pdf`, conserva la respuesta útil y no deriva.

## Entrega

Presentar una tabla con: flujo, entrada, equipos en catálogo, equipos en bloque, respuesta completa, adjuntos, handoff y resultado **OK / Parcial / Falla**. No se dará por cerrado solo con una validación estática.
