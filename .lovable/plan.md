# Corregir de raíz el envío de fichas PDF de SOC Ingeniería

## Diagnóstico confirmado

- Las nuevas fichas de SOC Ingeniería están procesadas, tienen contenido indexado y conservan su archivo PDF original.
- Un mismo SKU aparece tanto en su ficha PDF como en dos copias de la guía Excel de hidrolavadoras.
- La resolución actual usa la primera coincidencia de conocimiento sin priorizar el tipo de archivo. En las pruebas con `SOC250/15AFBA` y `SOC250/30ACB-C2` eligió primero una guía Excel; después la validación rechazó ese documento por no ser PDF y devolvió `attachment: null`.
- El webhook de WhatsApp funciona correctamente cuando recibe un adjunto válido; el fallo ocurre antes, al decidir qué documento adjuntar.

## Implementación

1. **Separar búsqueda informativa y selección del adjunto**
   - Mantener el RAG para construir la respuesta técnica.
   - Crear un resolvedor específico de fichas que busque todas las coincidencias del SKU dentro del negocio y elija únicamente documentos PDF con `storage_path` disponible.
   - Priorizar coincidencia exacta/canónica del SKU en contenido y nombre de archivo, evitando depender del orden arbitrario de los resultados.

2. **Resolver también correctamente desde el historial**
   - Aplicar el mismo resolvedor cuando el cliente diga “envíame el PDF”, “la ficha” o confirme con “sí”.
   - Recuperar el último SKU relevante y seleccionar su PDF exacto, aunque también exista en Excel, catálogos u otros documentos.
   - Evitar que palabras o códigos secundarios del historial desplacen al producto más reciente.

3. **Evitar promesas falsas**
   - Solo permitir que la respuesta confirme el envío cuando el adjunto haya sido preparado.
   - Si existe información técnica pero no hay PDF utilizable, responder de forma honesta sin decir que se adjuntó o se reenviará.

4. **Observabilidad y validación**
   - Registrar el SKU solicitado, candidatos encontrados, PDF seleccionado y motivo cuando no pueda adjuntarse.
   - Probar casos directos y contextuales con varios modelos SOC/MH/PWGB, incluyendo SKUs con `/` y `-`.
   - Verificar en los logs que `build-ai-reply` devuelve el PDF correcto y que `whatsapp-webhook` registra el envío del documento.

## Alcance técnico

- Cambios en `build-ai-reply` y pruebas focalizadas del flujo de adjuntos.
- El envío actual de Kapso/WhatsApp y la deduplicación de 24 horas se conservan.
- No requiere volver a subir las fichas ni cambiar la base de datos.