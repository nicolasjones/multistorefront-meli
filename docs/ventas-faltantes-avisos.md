# Ventas · Avisos de faltantes (F-VTA-26 y F-VTA-27)

Épica MSF-161 (spec `specs/20261110-100000-ventas-avisos-de-faltantes/`). Se avisa a los clientes con un faltante de despacho cuando vuelve a haber mercadería, a mano (F-VTA-26) o con ayuda del sistema que marca «Para avisar» (F-VTA-27). Pantalla: `/ventas/faltantes` (la de F-VTA-18, `docs/ventas-faltantes.md`).

## Relación con F-STK-17 y F-VTA-18

- Hay dos conceptos de «faltante»: el de **Stock** (F-STK-17: líneas «A pedido» con reserva activa, `docs/stock-faltantes.md`, pantalla `/stock/faltantes`) y el de **despacho** (F-VTA-18: `dominio.faltantes_venta`, una fila por línea de factura). F-VTA-26/27 van sobre el de despacho.
- Un faltante de despacho coincide uno a uno con una línea de factura (`comprobante_id` + `linea_orden`), así que el aviso **reutiliza** la cola `dominio.faltantes_avisos`, la Edge Function `enviar-aviso-faltante` y el flow Kestra `avisos-faltantes` de F-STK-17: no hay tabla, función ni flow nuevos. Una línea que sea faltante en ambas pantallas comparte una sola fila de cola, por lo que no se avisa dos veces.

## Avisar a clientes (F-VTA-26)

- **Quién**: `ventas` en `edicion` en la tienda del faltante. El rol Consulta es rechazado por el servidor (`42501`).
- **Cómo**: se eligen faltantes abiertos y «Avisar a los seleccionados» abre el diálogo con el texto editable (tope 1.000 caracteres; vacío o igual al texto por defecto = texto por defecto). Sale **un correo por cliente** con todos sus productos.
- **«Avisado» con fecha** no es un valor de `estado`: se deriva de la cola (`pendiente` o `enviado`), con la fecha `coalesce(enviado_en, created_at)`. `faltantes_venta.estado` sigue siendo `abierto | resuelto`.
- **No se avisa dos veces** sin confirmación (RF-VTA-26-2): el servidor omite los ya avisados salvo `p_reavisar = true`, que la pantalla pide con una casilla en el diálogo. Con un envío en curso nunca se reenvía.
- **Sin correo**: el cliente sin correo no se marca y se informa «El cliente no tiene correo.».
- **RPC** (`public`, `security definer`, `search_path = ''`, `anon` sin ejecución): `avisar_faltantes_venta(p_ids, p_mensaje, p_reavisar)` y `listar_faltantes(p_empresa_id, p_pagina, p_tamano, p_aviso)` (ahora devuelve `aviso` y `aviso_en`).
- **Eventos**: `ventas.faltantes_avisados` en la actividad (sin correos de clientes).
- **Reversión**: migraciones `20270223100100`, `100200` y `100300` (cada una documenta su reversión en el encabezado).

## Para avisar (F-VTA-27)

- **Ingreso confirmado**: no existe un paso de confirmación; `registrar_ingreso_mercaderia` crea el ingreso ya `registrado` y mueve el stock en la misma transacción. Un disparador `AFTER INSERT` sobre `dominio.ingresos_mercaderia_lineas` (`ingresos_mercaderia_lineas_marcar_faltantes`) marca los faltantes abiertos del producto. Otras entradas de stock (lote, toma, traslados, RMA) no marcan.
- **Cobertura**: se recorre del faltante más antiguo con saldo igual a la cantidad ingresada; se marca cada faltante completo y el que no entra en el saldo se salta. Ejemplos: ingreso de 10 y faltantes 4 + 4 + 4 marcan los dos primeros; faltantes 9 + 2 + 1 marcan el de 9 y el de 1.
- **Qué no hace**: no envía nada (el envío es del operador con F-VTA-26), no cierra faltantes y anular el ingreso no desmarca.
- **Robustez**: el disparador atrapa sus errores para no romper el ingreso; un fallo queda como WARNING en el log del servidor.
- **Pantalla**: chip «Para avisar» en la columna Aviso y filtro «Todos» / «Para avisar» (del más antiguo al más nuevo).
- **Reversión**: migraciones `20270223110100`, `110200` y `110300`.

## Pruebas

pgTAP `faltantes_avisos_venta.test.sql`, `faltantes_para_avisar.test.sql` y `faltantes.test.sql`; Vitest `faltantes.test.tsx`, `faltantes.empresa.test.tsx`, `ventasFaltantes.test.ts`, `useListarFaltantes.test.tsx`; tests de la Edge Function (`handler.test.ts`); E2E `ventas-faltantes-avisos.e2e.ts` y `ventas-faltantes-para-avisar.e2e.ts` (necesitan Supabase local).

## Revisión de seguridad integral

Sin tablas nuevas; columnas nuevas en `faltantes_avisos` y `faltantes_venta` bajo la RLS vigente. RPC y disparador `security definer` con `search_path` vacío, organización y actor de la sesión, permiso por tienda del faltante, respuesta uniforme `no_abierto` para lo ajeno, `anon` sin privilegios, mensaje saneado y texto plano. Ver también la revisión técnica + seguridad del PR.
