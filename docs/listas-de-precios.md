---
owner: tecnico
sources:
  - specs/20270327-100000-listas-de-precios-por-cliente
  - supabase/migrations/20270340000000_listas_precios.sql
  - supabase/migrations/20270340000100_exportacion_total_listas_precios.sql
  - supabase/migrations/20270340000200_clientes_lista_precio.sql
  - supabase/migrations/20270340000210_fusion_clientes_lista_precio.sql
  - supabase/migrations/20270346000000_archivar_lista_precios_mensaje_plural.sql
  - supabase/migrations/20270348000000_lineas_snapshot_lista_precios.sql
  - supabase/migrations/20270348000100_motor_precio_lista_cliente.sql
  - supabase/migrations/20270348000200_ventas_usan_lista_precios.sql
  - supabase/migrations/20270348000300_tienda_precios_lista_cliente.sql
  - supabase/migrations/20270507110000_lista_pedido_precio_de_la_lista_del_cliente.sql
  - supabase/migrations/20270509000200_listas_precios_asignacion_masiva.sql
  - supabase/migrations/20270509000300_listas_precios_por_tipo_cliente.sql
  - supabase/migrations/20270509000400_listas_de_clientes_para_exportar.sql
  - supabase/migrations/20270509000500_ventas_por_lista_precios.sql
  - apps/web/src/components/clientes/DialogoAsignarListaMasiva.tsx
  - apps/web/src/components/listasPrecios/ListasPorTipoCliente.tsx
  - apps/web/src/pages/ventas-reportes/VentasPorLista.tsx
  - apps/web/src/lib/ventasPorLista.ts
  - apps/web/src/lib/listasPrecios.ts
  - apps/web/src/pages/productos/listas-de-precios.tsx
  - apps/web/e2e/listas-de-precios-recorrido.e2e.ts
---

# Listas de precios por cliente (F-PRE-14 y F-CLI-21)

Guía de referencia de ingeniería del cierre de la spec `specs/20270327-100000-listas-de-precios-por-cliente/`. Una **lista de precios** es un porcentaje de ajuste (de -90 % a +100 %) sobre el precio central, definido por un administrador y asignado a un cliente. La explicación para quien usa el panel está en [Listas de precios (guía de uso)](producto/listas-de-precios.md); la precedencia completa del precio, en [Precios](precios.md#listas-de-precios-f-pre-14-y-f-cli-21); la revisión de seguridad, en [Revisión de seguridad de las listas de precios](revision-seguridad-listas-de-precios.md).

## Qué se entregó, por fase

| Fase | Entrega | Migraciones | Efecto en el precio |
|---|---|---|---|
| 1 · Listas | Tabla `dominio.listas_precios`, RPC de alta, edición, archivo y restauración, pantalla Productos → Listas de precios | `20270340000000`, `20270340000100` (exportación total), `20270346000000` | Ninguno |
| 2 · Asignación | Columna `dominio.clientes.lista_precio_id`, RPC `asignar_lista_precios_cliente`, campo en la ficha, fusión de clientes | `20270340000200`, `20270340000210` | Ninguno |
| 3 · Motor y ventas | Precedencia en `precio_para_calculo` y `precio_linea_venta(_calculo)`, snapshot por línea, marca «Lista:», nota de crédito heredando | `20270348000000` a `20270348000200` | Sí, detrás de la bandera |
| 4 · Tienda | «Tu precio», favoritos y presupuesto de la tienda con la lista de la cuenta web | `20270348000300` | Sí, detrás de la bandera |
| 5 · Cierre | Documentación, revisión de seguridad, recorrido E2E, seguimientos y guards | ninguna | Ninguno |

La Fase 5 **no agrega migraciones ni cambia el motor de precios**. Los seguimientos posteriores (Fase 6, lote 93) están en su propia sección.

## Bandera `listas_precios` y cómo se enciende

La bandera vive en `public.banderas_plataforma` y **nace apagada en todo entorno**. **Encenderla es una decisión de Nicolás**: este cierre no la enciende en ningún entorno (tampoco en dev) y no hay script que la encienda.

- **Apagada**: «Guardar lista» y «Asignar» responden `55000`; archivar, restaurar y quitar la lista siguen permitidos; el motor ignora las listas y el precio es idéntico, bit a bit, al de antes (pgTAP de paridad `precio_lista_cliente.test.sql`).
- **Procedimiento de encendido**, por entorno y en el orden dev → stg → prd, cada uno verificado antes del siguiente:
  1. Comprobar que las migraciones `20270348000100` (motor de la bandera) y `20270348000300` (tienda) y el bundle del panel y de la tienda están desplegados en ese entorno (no alcanza con que el merge esté en `dokploy`).
  2. **Chequeo previo y entorno**: confirmar a qué entorno se está conectado y el estado actual con `select clave, activa from public.banderas_plataforma where clave = 'listas_precios';`. La bandera es **GLOBAL**: al encenderla rige para **todas** las organizaciones del entorno, no solo una.
  3. Avisar al equipo de ventas o encender fuera del horario de mostrador.
  4. `update public.banderas_plataforma set activa = true where clave = 'listas_precios';` (por SQL, el equipo técnico; rige al instante, sin redesplegar).
  5. Verificar el recorrido: crear una lista, asignarla a un cliente, venderle en el mostrador (la línea sale al precio de la lista y muestra «Lista: …»), confirmar, emitir una nota de crédito (devuelve al precio cobrado) y presupuestar desde la tienda con la cuenta web de ese cliente.
- **Nota de activación**: los borradores guardados antes de encender reciben un `40001` (hint `precios_cambiaron`, `detail = 'lista_precios'`) en su primera confirmación **solo si el cliente tiene una lista asignada**; volver a guardar las líneas lo resuelve. Lo mismo al apagarla con borradores que ya tenían lista.
- **Reversión inmediata, sin migrar**: la misma sentencia con `activa = false`. Lo ya vendido conserva su snapshot.
- **Ojo con el E2E**: el recorrido `listas-de-precios-recorrido.e2e.ts` cambia la bandera global del stack efímero y la restaura al final (si la restauración falla avisa por consola); no correrlo en paralelo con otro E2E que lea `listas_precios` ni contra un entorno compartido.
- La lista de pedido de la tienda («Enviar consulta») ya usa la lista del cliente con sesión (MSF-969, migración `20270507110000`): muestra y guarda el mismo precio que «Tu precio». Sin lista, sin sesión o con la bandera apagada no cambia.

## Contratos que quedaron

- Campo de ajuste de la pantalla (`parsearAjuste`, `apps/web/src/lib/listasPrecios.ts`): acepta coma o punto, hasta 2 decimales y de -90 a +100; se recortan los espacios de los extremos y se admite uno antes del «%»; un espacio dentro del número («1 0», «- 20») no es válido.

- RPC (`security definer`, `search_path` vacío, `grant execute … to authenticated`, `revoke … from public, anon`): `guardar_lista_precios`, `archivar_lista_precios`, `restaurar_lista_precios`, `asignar_lista_precios_cliente`; vista `public.listas_precios_resumen` (`security_invoker`).
- Motor: `private.lista_precios_cliente(cliente, organización)` (sin acceso de API) decide si rige una lista; la usan `precio_para_calculo`, `precio_linea_venta(_calculo)`, `precio_final_publico_escala` y `motor_presupuesto_tienda`.
- Snapshot: `lista_precio_id` y `lista_ajuste_pct` en `dominio.comprobantes_venta_lineas`; el panel las lee por `obtener_comprobante` (`lista_ajuste_pct` y `lista_nombre`), no por `select` directo.
- Actividad: `lista_precios.creada|editada|archivada|restaurada` y `cliente.lista_precio_asignada` (ver [Actividad](actividad.md)).
- Exportación total: la tabla `dominio.listas_precios` entra a `private.conjuntos_exportacion_total()` desde `20270340000100`; la columna del cliente viaja con la tabla `clientes`.

## Pruebas y evidencia

- pgTAP (dentro de `begin … rollback` en dev): `listas_precios` 78, `clientes_lista_precios` 60, `precio_lista_cliente` 97, `ventas_lista_precios` 65, `precio_lista_tienda_paridad` 35, `exportacion_total` 48.
- Vitest: pantalla de listas, ficha del cliente, marca «Lista:» en el mostrador y el comprobante, diálogos del `40001`, «Tu precio» y tarjetas del catálogo.
- **E2E del recorrido** (`apps/web/e2e/listas-de-precios-recorrido.e2e.ts`, job `e2e-visible-sesion` del CI): asignar la lista, vender en el mostrador al precio de la lista (con la marca «Lista:» en el comprobante), nota de crédito heredando el snapshot aunque la lista cambie después, presupuesto de la tienda con la cuenta web (cliente con lista contra cliente sin lista) y bandera apagada con el precio de siempre. Todo entra por RPC con la sesión de la persona; la service-role solo siembra organización, tienda, productos, stock y usuarios, y fija las banderas **del stack efímero del CI**. Se corre a mano con `gh workflow run validate.yml --ref <rama> -f e2e_sesion=true -f e2e_archivos=listas-de-precios-recorrido.e2e.ts` (el stack se comparte: no lanzar dos corridas a la vez).

## Fase 6: seguimientos entregados (lote 93)

Cuatro de los seguimientos de la Fase 5 se entregaron sin tocar la precedencia de las escalas (D5 y D8). **Todo sigue detrás de la bandera
`listas_precios`**: apagada, asignar (en masa o por tipo) responde `55000` y el motor ignora las listas; quitar sigue permitido.

- **Asignación masiva (MSF-973)** · `20270509000200_listas_precios_asignacion_masiva.sql`. RPC `asignar_lista_precios_masiva`: por
  **selección** (los marcados del listado de Clientes) o por **filtro** (texto, tipo, tienda y cuenta web: los mismos criterios del listado
  y del correo masivo, solo activos). Solo Administrador. Tope de 5000 clientes por llamada. Devuelve asignados, sin cambios y omitidos
  (archivados, Consumidor final o inexistentes: no abortan el lote). Un solo evento de Actividad por llamada
  (`cliente.lista_precio_asignada_masiva`). En la pantalla: botón «Asignar lista de precios» del listado de Clientes (solo Administrador).
- **Lista por tipo de cliente (MSF-976)** · `20270509000300_listas_precios_por_tipo_cliente.sql`. Tabla
  `dominio.listas_precios_tipo_cliente` (una lista por tipo, minorista o mayorista, y organización) y RPC
  `asignar_lista_precios_tipo_cliente`. **Precedencia: la lista propia del cliente gana; si no tiene, rige la de su tipo.** Es el mismo
  punto único del motor (`private.lista_precios_cliente`), así que precios, ventas, tienda y el snapshot por línea siguen igual. El
  Consumidor final nunca tiene lista. «No se archiva una lista con clientes» cuenta también a los que la heredan por su tipo
  (`private.cantidad_clientes_lista`). Pantalla: sección «Lista por tipo de cliente» en Productos → Listas de precios.
  **Por tienda queda fuera**: la lista es de toda la organización y el precio ya se ajusta por tienda con las escalas y el ajuste de la
  empresa; sumar listas por tienda necesita una spec que defina cómo convive con ese ajuste.
- **Lista del cliente en la planilla (MSF-974)** · `20270509000400_listas_de_clientes_para_exportar.sql`. La **exportación** de clientes suma
  la columna «Lista de precios» (la propia o, con la marca «por tipo de cliente», la heredada). La función `listas_de_clientes_para_exportar`
  se llama por cada tanda de la exportación y exige la misma acción `exportar` de Clientes; `exportar_clientes` (topes y auditoría) no se
  toca. La **importación no lee la columna**: asignar una lista es de Administrador y se hace desde la ficha, en masa o por tipo.
- **Analítica de ventas por lista (MSF-975)** · `20270509000500_ventas_por_lista_precios.sql`. RPC `ventas_por_lista_precios(desde, hasta,
  empresa)`: por lista, comprobantes, unidades, ventas netas sin IVA y ajuste otorgado estimado (facturas suman, notas de crédito restan;
  una fila «Sin lista» para comparar). Pantalla: pestaña «Ventas por lista de precios» de Reportes de ventas, sin tablero de Superset.
  **El margen por lista queda fuera**: la línea no guarda el costo ni la cotización de cuando se vendió.
- **Exportación total**: la tabla nueva entra a `private.conjuntos_exportacion_total()` (`20270509000600_exportacion_total_lote93.sql`).
- **Encendido de la bandera (MSF-977)**: es decisión de Nicolás y no se tocó. El procedimiento completo (orden dev, stg, prd, chequeo
  previo, aviso al equipo de ventas y verificación del recorrido) es el de la sección «Bandera `listas_precios` y cómo se enciende» de esta
  guía y de `docs/deployment.md`; con estas funciones, el recorrido a verificar en dev suma: asignar una lista a un tipo de cliente,
  asignarla en masa y ver la pestaña de ventas por lista. Antes de prd falta decidir MSF-969.

## Seguimientos trazados

| Ticket | Qué queda |
|---|---|
| MSF-969 | **Resuelto** (migración `20270507110000_lista_pedido_precio_de_la_lista_del_cliente.sql`): la lista de pedido de la tienda («Enviar consulta») y el `precio_referencia` que guarda cada consulta usan la lista del cliente con sesión, igual que «Tu precio» (gana el más bajo contra la promoción; sin el descuento de la ficha). Las consultas ya enviadas no se recalculan. |
| MSF-973 | **Resuelto** (Fase 6, `20270509000200`): asignación masiva por selección o filtro. |
| MSF-974 | **Resuelto en la exportación** (Fase 6, `20270509000400`); la importación no lee la columna a propósito. |
| MSF-975 | **Resuelto sin margen** (Fase 6, `20270509000500`): ventas y ajuste por lista; el margen exige un snapshot de costo en la línea. |
| MSF-976 | **Resuelto por tipo de cliente** (Fase 6, `20270509000300`); por tienda queda fuera (ver arriba). |
| MSF-977 | Encendido de la bandera en dev y verificación del recorrido (decisión de Nicolás): procedimiento documentado, **sin encender**. |
