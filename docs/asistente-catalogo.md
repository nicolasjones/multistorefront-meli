# Asistente con IA sobre el catálogo (F-IA-01)

Qué es: el chat flotante del panel y el servidor MCP del template pueden responder preguntas sobre **catálogo, stock, precios y ventas** de la organización. Es **solo lectura**: el asistente no escribe ni ejecuta acciones. Épica MSF-233, historia MSF-411. Especificación: [`specs/20270203-100000-api-e-asistente-con-ia/spec.md`](../specs/20270203-100000-api-e-asistente-con-ia/spec.md) (FR-020…FR-025, decisiones D-7 y D-8) y contrato [`contracts/ia-consulta.md`](../specs/20270203-100000-api-e-asistente-con-ia/contracts/ia-consulta.md).

No agrega pantalla: usa el chat flotante existente y las pantallas de plataforma «Capacidades del Chat IA» y «Capacidades de MCP» (`/ia/capacidades-chat`, `/ia/capacidades-mcp`), donde las cuatro funcionalidades aparecen con **Lectura** activa y **Ejecución** apagada.

## Qué se expone

Cuatro vistas de solo lectura en `public`, con `organizacion_id` y `security_invoker = true` (migración `20270223110000_ia_consulta_vistas.sql`):

| Funcionalidad | Vista | Columnas |
|---|---|---|
| `catalogo` | `ia_consulta_catalogo` | producto, nombre, SKU, categoría (ruta «Padre > Hija», resuelta con `private.ia_categoria_ruta` para no depender de la sección Categorías), activo, actualizado |
| `stock` | `ia_consulta_stock` | producto, depósito, cantidad, reservado, disponible (cantidad − reservado) |
| `precios` | `ia_consulta_precios` | moneda, precio de lista y escalas x5/x10/x50 (null = escala sin precio) |
| `ventas` | `ia_consulta_ventas` | número, fecha, empresa, totales y estado; **solo facturas confirmadas** |

**No se expone** (D-7): costos, márgenes, datos de contacto de clientes ni el precio final por empresa o IVA.

## Permisos

- La funcionalidad tiene que estar **activa** en la organización: un superadmin la habilita por organización desde Funcionalidades (registrar no habilita).
- **Chat**: lee con la sesión del usuario, así que rige la RLS de las tablas base: Catálogo y Precios piden la sección `productos`, Stock pide `stock` y Ventas pide `ventas`, al menos en lectura. Sin la sección no se devuelven filas.
- **MCP**: el servidor lee con credencial de la organización (no hay usuario final) y `private.mcp_leer_fila` arma `where organizacion_id = …` dentro del SQL; las secciones por rol aplican solo al chat.
- Nunca se cruzan datos entre organizaciones.

## Límites

- **Máximo 50 filas por consulta.** En el chat, la lectura pide una fila de más: si hay más de 50, el asistente recibe las primeras 50 y un aviso para que pida al usuario afinar la búsqueda (`supabase/functions/chat-ia-responder/limites.ts`). En MCP, `private.mcp_leer_fila` limita a 50 las vistas `ia_consulta_*`, las más recientes primero (migración `20270223110200_ia_consulta_tope_mcp.sql`).
- Rigen los límites de intentos y tiempo de la política IA aprobada (`ia_politicas`). Si falta el presupuesto del Gateway IA, no se enciende el asistente para esa organización (D-8).

## Registro y auditoría

- `private.registrar_fuentes_ia_consulta()` (migración `20270223110100_ia_consulta_registro.sql`) registra de forma idempotente las cuatro funcionalidades, **una vista por funcionalidad** en `fuentes_chat_ia` y `fuentes_mcp`, y las capacidades con `lectura = true` y `ejecucion = false`. Una segunda corrida no duplica nada.
- Cada pregunta y respuesta queda en las interacciones de IA del template (`ia_interacciones`) y en la ejecución MCP existente; las vistas no tienen costos ni contactos, así que el detalle no los puede guardar.

## Pruebas

pgTAP `ia_consulta_vistas.test.sql` (columnas exactas, `security_invoker`, dos organizaciones, rol sin sección, `anon`) e `ia_consulta_registro.test.sql` (registro completo e idempotente, tope de 50 en MCP, sin datos sensibles); Vitest `capacidades-ia.test.tsx` (las cuatro fuentes en ambas pantallas, sin ruta nueva); `limites.test.ts` del chat (`pnpm test:edge:chat-ia-limites`).

## Reversión

Migraciones aditivas. En una migración posterior: `delete from public.features where id in ('catalogo', 'stock', 'precios', 'ventas')` (borra en cascada fuentes, capacidades y habilitaciones), `drop function private.registrar_fuentes_ia_consulta()`, volver `private.mcp_leer_fila` a la definición de `20261003233000_mcp_lectura_centralizada.sql` y `drop view` de las cuatro vistas.
