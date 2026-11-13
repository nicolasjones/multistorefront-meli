# Ventas · Avisos de faltantes (F-VTA-26 y F-VTA-27)

Épica MSF-161 (spec `specs/20261110-100000-ventas-avisos-de-faltantes/`). Se avisa a los clientes con un faltante de despacho cuando vuelve a haber mercadería, a mano (F-VTA-26) o con ayuda del sistema que marca «Para avisar» (F-VTA-27). Pantalla: `/ventas/faltantes` (la de F-VTA-18, `docs/ventas-faltantes.md`).

## Relación con F-STK-17 y F-VTA-18

- Hay dos conceptos de «faltante»: el de **Stock** (F-STK-17: líneas «A pedido» con reserva activa, `docs/stock-faltantes.md`, pantalla `/stock/faltantes`) y el de **despacho** (F-VTA-18: `dominio.faltantes_venta`, una fila por línea de factura). F-VTA-26/27 van sobre el de despacho.
- Un faltante de despacho coincide uno a uno con una línea de factura (`comprobante_id` + `linea_orden`), así que el aviso **reutiliza** la cola `dominio.faltantes_avisos`, la Edge Function `enviar-aviso-faltante` y el flow Kestra `avisos-faltantes` de F-STK-17: no hay tabla, función ni flow nuevos. Una línea que sea faltante en ambas pantallas comparte una sola fila de cola, por lo que no se avisa dos veces.

## Avisar a clientes (F-VTA-26)

- **Quién**: `ventas` en `edicion` en la tienda del faltante. El rol Consulta es rechazado por el servidor (`42501`).
- **Cómo**: se eligen faltantes abiertos y «Avisar a los seleccionados» abre el diálogo con el texto editable (tope 1.000 caracteres; vacío o igual al texto por defecto = texto por defecto). Sale **un correo por cliente** con todos sus productos.
- **Estados del aviso** (no son un valor de `faltantes_venta.estado`, que sigue siendo `abierto | resuelto`): se derivan de la cola. `En cola` = aviso `pendiente` (el correo todavía no salió; fecha = `created_at`); `Avisado` = `enviado` (fecha = `enviado_en`). Antes se mostraba «Avisado» apenas se encolaba: el aviso emergente dice ahora «Avisos en cola».
- **Aviso fallido** (revisión M-1): un aviso `agotado` no cambia la fila (sigue «Para avisar» si llegó mercadería, si no «Sin avisar»; decisión QA M1: coherente con mercadería llegada y aviso fallido) y `listar_faltantes` devuelve `aviso_error` con un **código genérico**. La pantalla muestra el chip «Aviso fallido» con el motivo y «Reintentar» (elige ese faltante y abre el diálogo).
- **Códigos de error** (`ultimo_error`, revisión m-4b): `smtp_auth`, `smtp_conexion`, `smtp_timeout`, `destinatario_invalido`, `sin_correo`, `faltante_cerrado`, `intentos_agotados`, `otro`. El detalle técnico (host, usuario, respuesta del servidor) queda solo en el log de la función; lo no reconocido se guarda como `otro` y un check lo exige.
- **No se avisa dos veces** sin confirmación (RF-VTA-26-2): el servidor omite los ya avisados salvo `p_reavisar = true`, que la pantalla pide con una casilla en el diálogo. Con un envío en curso nunca se reenvía.
- **Topes** (revisión M-3, sin override): un faltante `enviado` no se vuelve a avisar antes de **24 horas** (`omitidos_reaviso_reciente`) y una organización no encola más de **1.000 líneas por día móvil** (`omitidos_tope_diario`); la pantalla lo dice en el aviso emergente. Las dos RPC de encolado (`avisar_faltantes_venta` y la de Stock `avisar_faltantes`) comparten la regla en `private.encolar_aviso_faltante` (revisión m-6).
- **Tope diario sin carrera** (revisión del PR #915): `private.encolar_aviso_faltante` toma un `pg_advisory_xact_lock` por organización antes de leer y contar (las sesiones de una organización se serializan; las de otra no se bloquean) y cuenta con el índice `(organizacion_id, created_at)`. Cuenta líneas con aviso encolado en 24 h: reencolar un `agotado` de la misma ventana no suma cupo porque ya estaba contado y su correo no salió; reencolar un `enviado` sí suma. Las dos RPC recorren las líneas en el mismo orden (por línea): no hay deadlock entre ellas.
- **Texto saneado también en la base** (m-5): `private.sanear_mensaje_aviso` (espejo de `sanearMensaje`) lo limpia en la RPC y un check de `faltantes_avisos.mensaje` lo exige. En el correo, ninguna línea empieza con «.» (neutraliza el dot-stuffing de SMTP).
- **Sin correo**: el cliente sin correo no se marca y se informa «El cliente no tiene correo.».
- **RPC** (`public`, `security definer`, `search_path = ''`, `anon` sin ejecución): `avisar_faltantes_venta(p_ids, p_mensaje, p_reavisar)` y `listar_faltantes(p_empresa_id, p_pagina, p_tamano, p_aviso)` (devuelve `aviso` = `sin_avisar | para_avisar | en_cola | avisado`, `aviso_en` y `aviso_error`; `p_aviso` acepta también `en_cola`).
- **Eventos**: `ventas.faltantes_avisados` en la actividad (sin correos de clientes).
- **Reversión**: migraciones `20270226100100`, `100200` y `100300`, y `20270306110000` de la revisión (cada una documenta su reversión en el encabezado).

## Para avisar (F-VTA-27)

- **Ingreso confirmado**: no existe un paso de confirmación; `registrar_ingreso_mercaderia` crea el ingreso ya `registrado` y mueve el stock en la misma transacción. Un disparador `AFTER INSERT` sobre `dominio.ingresos_mercaderia_lineas` (`ingresos_mercaderia_lineas_marcar_faltantes`) marca los faltantes abiertos del producto. Otras entradas de stock (lote, toma, traslados, RMA) no marcan.
- **Cobertura**: se recorre del faltante más antiguo con saldo igual a la cantidad ingresada; se marca cada faltante completo y el que no entra en el saldo se salta. Ejemplos: ingreso de 10 y faltantes 4 + 4 + 4 marcan los dos primeros; faltantes 9 + 2 + 1 marcan el de 9 y el de 1.
- **Qué no hace**: no envía nada (el envío es del operador con F-VTA-26), no cierra faltantes y anular el ingreso no desmarca (decisión 6 de la spec).
- **Marcados y saldo** (decisión 5): los faltantes ya marcados no consumen saldo de un ingreso posterior; «Para avisar» es una sugerencia y el «Stock hoy» real se ve al lado.
- **`para_avisar_en` no se limpia** al quedar el aviso `agotado` (revisión m-1, decisión): llegó mercadería y el aviso falló, así que el faltante sigue pendiente de avisar; la fila vuelve a «Para avisar» y trae además «Aviso fallido».
- **Robustez**: el disparador atrapa sus errores para no romper el ingreso; un fallo queda como WARNING en el log del servidor. Ante `deadlock_detected` o `lock_not_available` reintenta hasta 3 veces y, si no puede, deja la actividad `ventas.faltantes_para_avisar_demorado` (los faltantes se marcan con el próximo ingreso del producto).
- **Pantalla**: chip «Para avisar» en la columna Aviso y filtro «Todos» / «Para avisar» (del más antiguo al más nuevo).
- **Reversión**: migraciones `20270226110100`, `110200` y `110300`.

## Envío (Edge Function)

- **Timeout** (M-2): el SMTP tiene tope de 30 s (`_shared/timeout.ts`), menor que la reserva de 2 minutos de la cola. Un `smtp_timeout` es un **intento incierto** (el correo pudo salir tras el corte): `cerrar_aviso_faltante` deja el aviso `agotado` en el acto, no se reenvía solo y la persona decide con «Reintentar» (el motivo avisa que el correo pudo haber salido). El barrido corta por reloj a los 90 s y devuelve `pendientes`; Kestra lo repite cada minuto; **token de tanda**: `tomar_aviso_faltante` devuelve `tanda` y `cerrar_aviso_faltante(…, p_tanda)` cierra solo las líneas de esa tanda, así un cierre tardío no pisa una tanda nueva. La garantía sigue siendo «al menos una vez».
- **Destinatario** (m-3): una sola dirección (`^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$`); `lineaSegura` quita además U+2028/2029, controles e invisibles (m-4).

## Pruebas

pgTAP `faltantes_avisos_venta.test.sql`, `faltantes_para_avisar.test.sql` y `faltantes.test.sql`; Vitest `faltantes.test.tsx`, `faltantes.empresa.test.tsx`, `ventasFaltantes.test.ts`, `useListarFaltantes.test.tsx`; tests de la Edge Function (`handler.test.ts`: tanda, códigos de error, timeout, destinatario, dot-stuffing); E2E `ventas-faltantes-avisos.e2e.ts` y `ventas-faltantes-para-avisar.e2e.ts` (necesitan Supabase local).

## Revisión de seguridad integral

Sin tablas nuevas; columnas nuevas en `faltantes_avisos` y `faltantes_venta` bajo la RLS vigente. RPC y disparador `security definer` con `search_path` vacío, organización y actor de la sesión, permiso por tienda del faltante, respuesta uniforme `no_abierto` para lo ajeno, `anon` sin privilegios, mensaje saneado y texto plano. Ver también la revisión técnica + seguridad del PR.
