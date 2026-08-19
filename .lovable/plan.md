# Reporte de cobertura de fichas PDF

## Objetivo
Saber, dentro de la base de conocimiento del bot, qué modelos/SKU mencionados en el catálogo NO tienen una ficha técnica en PDF disponible para adjuntar por WhatsApp.

## Comportamiento del bot
Sin cambios: si un modelo no tiene PDF, el bot sigue respondiendo con los datos en texto y no promete archivo adjunto.

## Qué se construye
Una pestaña nueva "Cobertura de fichas" dentro de la página de configuración del bot (visible sólo cuando el envío de fichas PDF está activado):

- Tarjetas resumen: total de modelos detectados, cuántos tienen PDF adjuntable, cuántos no, y % de cobertura.
- Tabla de modelos sin PDF: código del modelo y en qué documento aparece (por ejemplo, la guía Excel), ordenada alfabéticamente.
- Tabla secundaria (colapsable) de modelos con PDF, para verificar que el archivo correcto está cargado.
- Buscador por código y botón para exportar la lista a CSV.
- Botón "Actualizar" para recalcular tras subir documentos nuevos.

## Cómo se calcula
1. Se recorren los fragmentos de conocimiento del negocio y se extraen los códigos de modelo con la misma regla que ya usa el bot para reconocer SKUs (mínimo 3 caracteres, mezcla de letras y números, admite guiones y barras).
2. Para cada código se busca si existe un documento PDF con archivo en storage cuyo nombre o contenido corresponda a ese modelo, usando exactamente el mismo resolvedor que el bot utiliza al adjuntar.
3. Se marca cada código como "con PDF" o "sin PDF", conservando el documento de origen donde se detectó.

Usar el mismo resolvedor es clave: el reporte refleja lo que el bot realmente puede enviar, no una aproximación.

## Detalles técnicos
- Nueva edge function `datasheet-coverage`: recibe `workshop_id`, lee `bot_knowledge` y `bot_documents`, reutiliza la lógica de extracción de códigos y de resolución de PDF de `build-ai-reply`, y devuelve `{ total, with_pdf, without_pdf, items[] }`.
- Para evitar duplicar código, la extracción de SKU y el resolvedor se mueven a un módulo compartido en `supabase/functions/_shared/` que ambas funciones importan.
- Acceso restringido: el usuario debe pertenecer al negocio consultado, o ser superadmin.
- Frontend: nuevo componente `DatasheetCoverage.tsx` en `src/components/bot/`, montado como pestaña en `BotSettingsPage.tsx`. Exportación CSV en cliente, sin dependencias nuevas.
- Sin migraciones de base de datos ni cambios de esquema.
