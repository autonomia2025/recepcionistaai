

# Web Scraping para Base de Conocimiento del Bot

## Resumen
Agregar la opción de ingresar una URL de sitio web en la configuración del bot. El sistema scrapeará la web, extraerá productos, servicios, descripciones y todo el contenido relevante, y lo almacenará como documento en la base de conocimiento (igual que los documentos subidos manualmente). El bot podrá responder preguntas basándose en esa información.

## Flujo del usuario
1. En la sección "Base de Conocimiento" del bot, aparece un nuevo campo de URL con botón "Importar Web"
2. El usuario pega una URL (ej: `https://mitienda.com`)
3. El sistema scrapea la página, extrae el contenido (productos, precios, descripciones)
4. Se crea un documento en `bot_documents` con el contenido extraído
5. Se procesa igual que cualquier documento: se divide en chunks y se almacena en `bot_knowledge`
6. El bot puede responder preguntas sobre los productos/servicios de esa web

## Detalles Técnicos

### 1. Nueva Edge Function: `scrape-website`
- Recibe `url` y `workshop_id`
- Usa Firecrawl si está disponible como conector, sino usa fetch nativo + Gemini para extraer contenido estructurado
- Flujo: fetch HTML -> enviar a Gemini para extraer productos/servicios/descripciones en formato texto limpio -> crear registro en `bot_documents` -> llamar `process-rag-document` con el texto extraído
- Gemini recibirá el HTML y se le pedirá que extraiga: nombre de productos, precios, descripciones, categorías, información de contacto, horarios, etc.

### 2. Modificar `process-rag-document`
- Agregar soporte para recibir texto plano directamente (además de archivos base64), para que la edge function de scraping pueda enviar el contenido extraído sin necesidad de encodear

### 3. UI en `BotSettingsPage.tsx`
- Agregar un campo de input URL + botón "Importar desde Web" debajo del DocumentUploader
- Mostrar estado de carga mientras scrapea
- El documento aparecerá en la lista de documentos con el nombre del dominio

### 4. Modificar `DocumentUploader.tsx` o crear componente separado `WebImporter.tsx`
- Input de URL con validación
- Botón de importar con estado de loading
- Opción para re-scrapear (actualizar contenido)

### Archivos a crear/modificar
- **Crear**: `supabase/functions/scrape-website/index.ts`
- **Crear**: `src/components/bot/WebImporter.tsx`
- **Modificar**: `src/pages/BotSettingsPage.tsx` (agregar WebImporter)
- **Modificar**: `supabase/functions/process-rag-document/index.ts` (aceptar texto plano)
- **Modificar**: `supabase/config.toml` (agregar config de nueva función)

