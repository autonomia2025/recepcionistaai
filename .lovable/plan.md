# Por qué el bot perdió consistencia con José Luis (3-sep, 22:33–22:41 UTC)

## Lo que muestra la traza, turno por turno

| Entrante | Estado acumulado | Bloque catálogo | Qué pasó |
|---|---|---|---|
| "hidrolavadora monofasica" | motor: 220V | 0 filas | OK, pregunta de diagnóstico |
| "mover" | motor: 220V | 0 filas | Recomienda 3 equipos reales + 3 PDFs |
| "valores" | **motor: null** | 0 filas | Precios OK, pero **re-adjunta las mismas 3 fichas** |
| "debo sacra grasa" | **todo null** | 0 filas | IA inventa PWP100/10AC220 y PWP150/11AC220 → guardrail los borra y **deriva**, dejando "tengo estas opciones que incluyen caldera:" sin ninguna opción |
| "si envia fichas" | **todo null** | 0 filas | IA inventa PW-C23P 1207, Polo Baby 120/10, Polo Compac 150/15 → **el guardrail no los detecta**, se envían al cliente y **no llega ninguna ficha** |

Ninguno de esos tres nombres existe en `product_catalog`. En cambio sí existen 7 equipos reales de AGUA CALIENTE + ELÉCTRICA 220V, que era exactamente la respuesta correcta.

## Las 4 causas

1. **El estado se pierde por la ventana de historial.** `buildConversationState` sí acumula, pero solo recibe los últimos 10 mensajes (`index.ts:787`). Como el bot manda 3-4 mensajes por turno, el primer mensaje del cliente ("monofasica") salió de la ventana al tercer turno y `motor` volvió a `null`.
2. **El tipo de agua nunca se registró.** Solo se leen mensajes `inbound`. El cliente dijo "debo sacar grasa" (que implica agua caliente) y fue el bot quien concluyó agua caliente; el estado no lee las conclusiones del bot ni mapea "grasa" → agua caliente. Sin agua + motor, `catalogBlockRows` quedó en 0 en los 5 turnos: **el modelo nunca vio el catálogo determinístico** y respondió de memoria → inventó.
3. **El validador de códigos no reconoce nombres con espacios.** `findInventedCodes` detecta patrones tipo `PWP100/10AC220`, pero no "Polo Baby 120/10" ni "PW-C23P 1207", así que pasaron sin filtro.
4. **El guardrail deja texto huérfano.** Al borrar la frase con los códigos quedó "Para 220V tengo estas opciones que incluyen caldera:" seguida de la derivación: incoherente. Y en el turno de "valores" se re-adjuntaron fichas ya enviadas.

## Plan de arreglo

### 1. Estado que no se pierde (causa 1)
- Subir la ventana de historial a los últimos 40 mensajes, o mejor: traer los últimos 20 **inbound** más los últimos 10 mensajes en orden, para que el diagnóstico inicial nunca se caiga de la ventana.
- Persistir el estado resuelto en la conversación (columna JSON en `conversations`) y usarlo como base, fusionando lo nuevo de cada turno.

### 2. Inferir agua desde el uso y desde las conclusiones del bot (causa 2)
- Mapear señales de uso a familia de agua: grasa/aceite/motor → agua caliente; barro/polvo/tierra/fachada → agua fría; ambos → ambas familias.
- Leer también los mensajes `outbound` para capturar confirmaciones del propio bot ("necesitas agua caliente"), sin sobrescribir lo que el cliente dijo explícitamente.
- Log explícito del bloque resuelto y su conteo en cada turno.

### 3. Validación de códigos más amplia (causa 3)
- Extender `findInventedCodes` para detectar también nombres de modelo con espacios y guiones (patrón: palabra + número/número) y validarlos contra `product_catalog` por SKU y por nombre normalizado.
- Si el modelo nombra un equipo no verificable, reemplazarlo por equipos reales del bloque en vez de solo borrarlo.

### 4. Respuesta coherente al sanear (causa 4)
- Si al eliminar códigos queda una frase introductoria sin lista ("tengo estas opciones:"), eliminar también esa frase.
- Cuando hay bloque de catálogo disponible, sustituir los códigos inventados por 2-3 equipos reales del bloque en vez de derivar.
- No re-adjuntar fichas ya enviadas en la conversación: llevar registro de PDFs entregados.

## Validación antes de cerrar
1. Replay del flujo de José Luis: al decir "debo sacar grasa" el estado debe quedar agua caliente + 220V, `catalog_block_rows: 7`, y la respuesta debe listar equipos reales.
2. "si envía fichas" debe entregar PDFs reales de esos equipos, sin códigos inventados.
3. Un turno con 15+ mensajes previos debe conservar la motorización del primer mensaje.
4. Verificar que no se repiten adjuntos ya enviados y confirmar timestamp de despliegue.
