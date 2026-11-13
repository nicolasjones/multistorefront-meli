# Tasks: Tiendas online · Tienda compra y cuentas (MSF-176)

**Input**: `specs/20270306-100000-tienda-compra-y-cuentas/` (spec.md, plan.md, contracts/tienda-compra-y-cuentas.md)

**Formato**: `- [ ] T### [P] [Historia] descripción — evidencia esperada`. **[P]** = paralelizable (archivos distintos, sin dependencia). Se implementa **historia por historia** (fase por fase) con `/clear` entre una y otra y los **Checkpoints** de cada fase.

**Estado**: spec lista, **sin código ni migraciones**. Las tareas están en `[ ]` porque todavía no se implementaron; la **regla absoluta** de CLAUDE.md rige al cierre: ninguna queda `[ ]` (toda tarea se hace con evidencia o se cierra con `[x]` + `Desvío:` + seguimiento trazado). T090 verifica que no quede ninguna abierta.

**Delivery scope**: `refine`, `supabase`

**Historias**: US-A = Historia 1 (F-CLI-20, «Mi cuenta»), US-B1 = Historia 2 (lista de pedido), US-B2 = Historia 3 (presupuesto desde la tienda).

## Trazabilidad requisito → tarea dueña

| Requisito | Tarea | | Requisito | Tarea |
|---|---|---|---|---|
| FR-001, FR-002 | T014, T016 | | FR-050 | T044, T045 |
| FR-003, FR-004 | T010, T015 | | FR-051, FR-052 | T040, T041 |
| FR-005, FR-006 | T010, T015 | | FR-053 | T041, T042 |
| FR-007, FR-009, FR-010 | T008, T009, T017 | | FR-054, FR-055, FR-056 | T040, T041, T042 |
| FR-008 | T009, T017 | | FR-057, FR-058 | T041, T042 |
| FR-011 | T014, T018 | | FR-059 | T041 |
| FR-012 | T018 | | FR-060 | T041, T043 |
| FR-013 | T018, T019 | | FR-061 | T046 |
| FR-020 a FR-022 | T031, T032 | | FR-062 | T045 |
| FR-023, FR-024 | T026, T033 | | FR-063 | T049 |
| FR-025, FR-026 | T028, T033 | | FR-064 | T047 |
| FR-027, FR-028, FR-029, FR-030 | T027, T028 | | SC-001 | T019 |
| FR-031 | T029, T030 | | SC-002 | T036 |
| FR-032, FR-033 | T033, T034 | | SC-003 | T042 |
| Bandera (D-19) | T001 | | SC-004, SC-005 | T042, T043, T004, T091 |
| Modelo de amenazas 1.x | T027, T028, T035, T037 | | SC-006 | T019, T034, T047 |
| Modelo de amenazas 2.x | T041, T042, T048 | | Modelo de amenazas 3.x | T010, T012 |

---

## Fase 0 — Cimientos (transversal)

- [ ] T001 [US-A] Migración `supabase/migrations/20270308100000_tienda_capacidad.sql`: bandera de plataforma `tienda_pedidos` **apagada por defecto** en la tabla de banderas (`20270228300000_banderas_plataforma.sql`), leída con `private.bandera_activa`. Sin función nueva. Documentar cómo se enciende por SQL en `docs/deployment.md`. **D-19**. — evidencia: pgTAP «bandera existe y está apagada»; con ella apagada las RPC de escritura responden el `error` genérico.
- [ ] T002 [US-A] Migración `…20270308100100_cuenta_de_tienda.sql`: `private.cuenta_de_tienda(host)` (`security definer`, `search_path = ''`) con la regla de `acceso_cliente_por_dominio` (cuenta `activa`, cliente habilitado en `clientes_empresas`, no archivado, no consumidor final, empresa activa del host). Sin `execute` para API. + pgTAP `supabase/tests/database/tienda_cuenta_de_tienda.test.sql` (**dos organizaciones, dos tiendas, tres clientes**): suspendida, no habilitada, otra tienda, usuario de panel sin cuenta, anónimo, cliente archivado, host desconocido y empresa desactivada → vacío. Cierra amenazas 2.1–2.3 y 3.1. — evidencia: pgTAP verde.
- [ ] T003 [US-A] **Verificación previa** (no código): (a) inventariar columnas que completa la última versión de `guardar_lineas_comprobante` (`20270201200129` y las que suman costo y cotización a la línea, `20270202201005`/`20270216400000`) y de `private.precio_para`/`escala_para_linea`, y dejarlo en `docs/tienda-compra-y-cuentas.md#lineas-del-presupuesto`; (b) confirmar si `private.precio_linea_venta` de MSF-816 ya está en `dokploy` (D-17); (c) confirmar que `private.insertar_actividad` acepta actor nulo y cómo lo rotula Actividad; (d) medir en dev/producción cuántas cuentas web activas hay y cuántas consultas por semana tiene cada tienda (`dominio.consultas`, `dominio.cuentas_cliente`) y anotar el resultado en el PR. — evidencia: nota en `docs/tienda-compra-y-cuentas.md` y en el PR; si (c) falla, tarea de ajuste en T043.
- [ ] T004 [P] [US-A] Actualizar los tests de superficie de `anon`: lista cerrada de funciones `publico.*` ejecutables por `anon` (solo las existentes más `lista_pedido_por_dominio` y `enviar_lista_pedido`, que se suman en T026/T027). `rls_en_toda_tabla` sigue verde con las tablas nuevas. — evidencia: pgTAP verde en cada historia.

**Checkpoint 0**: la identidad rechaza a todos los que no son una cuenta activa y habilitada de esa tienda; la bandera está apagada; el spike (T003) está documentado. Sin tablas nuevas todavía.

---

## Fase 1 — US-A · «Mi cuenta»: historial, presupuestos y favoritos (F-CLI-20 · MSF-452)

- [ ] T005 [US-A] Migración `…20270308100200_favoritos_cliente.sql`: `dominio.favoritos_cliente` (esquema **`dominio`**, justificado en la spec y re-verificado) con FK compuestas con `organizacion_id`, `on delete cascade` desde la cuenta, única `(cuenta_cliente_id, producto_id)`, índices, RLS «cuenta propia», `revoke all` a `anon`, `public` y `authenticated` (sin privilegios de API). Comentario de reversión. — evidencia: pgTAP `has_table_privilege` falso para `anon` y `authenticated`; `rls_en_toda_tabla`.
- [ ] T006 [P] [US-A] Migración `…20270308100300_tienda_favoritos_rpc.sql`: `publico.cambiar_favorito_por_dominio`, `mis_favoritos_por_dominio` y `favoritos_entre_por_dominio` con las reglas del contrato (producto visible, idempotencia, tope 200 con lock, límite 1–50, `revoke … from public, anon` y `grant … to authenticated`). **FR-007 a FR-010**.
- [ ] T007 [P] [US-A] Migración `…20270308100400_tienda_historial_rpc.sql`: `publico.mis_compras_por_dominio` y `mi_compra_por_dominio` con **lista blanca**, `estado_publico` derivado, vencido por `private.hoy_argentina()`, cursor `(fecha, id)` e índice de apoyo `(cliente_id, empresa_id, fecha desc, id desc)` (aditivo, `if not exists`). **FR-003 a FR-006**.
- [ ] T008 [US-A] pgTAP `supabase/tests/database/tienda_favoritos.test.sql`: alternar idempotente, tope 200 (el 201 se rechaza), producto oculto/ajeno = `no_encontrado`, producto que deja de ser visible no se lista y vuelve al publicarse, sin acceso (suspendida, otra tienda, panel de otra organización), aislamiento entre cuentas y entre tiendas del mismo cliente, `anon` sin `execute`, **claves exactas** de la respuesta. — evidencia: pgTAP verde. Escenarios A-8, A-9, A-10.
- [ ] T009 [US-A] pgTAP `supabase/tests/database/tienda_historial.test.sql`: solo comprobantes del cliente y de la tienda, cualquier canal, sin borradores, notas de crédito con signo, estado público (factura `deuda`/`cobrado` → «confirmada»; presupuesto vencido), **IDOR** (id de otro cliente = `no_encontrada` igual que inexistente), **lista blanca por claves** (ni costo, margen, descuento, operador ni depósito), cursor y límite acotado, suspensión inmediata. — evidencia: pgTAP verde. Escenarios A-1 a A-5, A-7.
- [ ] T010 [US-A] Revisión de que ninguna RPC de A recibe `cliente_id`, `cuenta_id`, `empresa_id` ni `organizacion_id` (lectura del contrato y del SQL). **Amenazas 3.1–3.6**. — evidencia: nota en el PR.
- [ ] T011 [P] [US-A] `apps/web/src/lib/tiendaCuentaDatos.ts` (+ test): llamadas a las cinco RPC con tipos estrictos, mapeo de `sin_acceso` a un error propio que la UI trata como «cuenta no activa». **FR-011**.
- [ ] T012 [P] [US-A] Hook `apps/web/src/hooks/useFavoritosEntre.ts` y botón `pages/tienda-publica/cuenta/BotonFavorito.tsx` (+ test con axe) en la ficha (`ficha/DatosProducto.tsx`): alternar, estado desde una sola llamada por pantalla, sin sesión lleva a «Ingresar», tope con aviso. **FR-007, FR-009**.
- [ ] T013 [P] [US-A] `pages/tienda-publica/cuenta/FavoritosCliente.tsx` (+ test): lista con carga infinita (`CargaInfinita`, `useListadoAcumulado`), miniatura con `MiniaturaProducto`, «Quitar», vacío, error con reintento, fin de lista. **FR-008, FR-013**.
- [ ] T014 [US-A] Ruta `pages/tienda-publica/rutas/mi-cuenta.tsx` con pestañas («Compras y presupuestos», «Favoritos»; `?seccion=`), redirección a `/ingresar` con vuelta (sin revelar el motivo) y «Mi cuenta» en `layout/AccesoCliente.tsx` solo con sesión activa; mensaje «Tu cuenta no está activa en esta tienda» ante el primer `sin_acceso`. **FR-001, FR-002, FR-011**. Sin pantalla dibujada: componentes del template, diferencias en el PR.
- [ ] T015 [P] [US-A] `pages/tienda-publica/cuenta/ComprasCliente.tsx` y `DetalleCompra.tsx` (+ tests): tabla/tarjetas con carga infinita, contador total, estado público con `Chip`, total con IVA, detalle con líneas. **FR-003 a FR-006**.
- [ ] T016 [P] [US-A] Test de integración del flujo de acceso (sin sesión → ingresar → volver a «Mi cuenta»; cuenta suspendida a mitad de sesión). Escenarios A-6, A-7.
- [ ] T017 [US-A] Test Vitest de que **las dos tiendas** del mismo cliente muestran solo lo suyo (favoritos e historial por tienda). **FR-010**.
- [ ] T018 [US-A] Vitest + axe a 320/768/1440 de todas las pantallas de A (carga, vacío, error con reintento, fin de lista, teclado, «Cargar más»). **FR-012, FR-013**.
- [ ] T019 [US-A] E2E `apps/web/e2e/tienda-cuenta.e2e.ts` (dos tiendas del seed, sin escritura directa): ingresar → ver historial → guardar y quitar favorito → suspender desde el panel → la tienda muestra «cuenta no activa». Prueba de rendimiento con 200 comprobantes. **SC-001, SC-006**.
- [ ] T020 [US-A] Docs: `docs/tienda-compra-y-cuentas.md` (sección A: modelo, contratos, estados públicos, permisos, decisiones D-2/D-10/D-11), `docs/clientes.md` (la cuenta web ahora tiene «Mi cuenta»), `docs/cuentas-y-compras-a-proveedores.md` (F-CLI-20 pasa de Backlog a entregada; F-TDA-27 y F-CON-07 absorbidas) y `docs/tiendas-online.md`. `pnpm docs:check`.
- [ ] T021 [US-A] Guards: `pnpm lint`, `pnpm build`, `pnpm estilos:check`, `pnpm ui:empresas:check`, `pnpm matriz:check`, `pnpm prototipo:check`, `node scripts/verificar-migraciones.mjs`, commitlint.
- [ ] T022 [US-A] Revisiones independientes **QA** y **Código + Seguridad** de A (skill `authz-security`) con hallazgos corregidos antes del merge a `dokploy`.

**Checkpoint A**: un cliente con cuenta activa ve su historial y sus favoritos por tienda; ninguno ve lo de otro; quien no tiene cuenta activa va a «Ingresar»; B1 y B2 todavía no existen.

---

## Fase 2 — US-B1 · Lista de pedido sin cobro

- [ ] T023 [US-B1] Migración `…20270308110000_consulta_items.sql`: `dominio.consulta_items` (esquema **`dominio`**; RLS por organización + empresa accesible + `consultas` ≥ lectura; `select` a `authenticated`; `anon` nada); `dominio.consultas`: `check` de `origen` suma `pedido`, columna `cliente_id` nullable con FK a `public.clientes (id, organizacion_id)`, `consultas_mensaje_requerido` exime a `pedido`; `dominio.tienda_envios`: `check` de `origen` suma `pedido` y `presupuesto`; vista `public.consulta_items_bandeja` (`security_invoker`); `public.consultas_bandeja` suma `cliente_id`. DDL idempotente (`drop constraint if exists`). Comentario de reversión. — evidencia: pgTAP de RLS y privilegios.
- [ ] T024 [P] [US-B1] Migración `…20270308110100_validar_items_pedido.sql`: `private.validar_items_pedido(p_items)` (forma, tope 50, 8000 caracteres, uuid por regex, cantidad 1–9999, repetidos sumados, claves ajenas ignoradas, sin cast que falle). Sin `execute` de API. **Amenaza 1.3**.
- [ ] T025 [US-B1] pgTAP de la batería de entradas hostiles de `validar_items_pedido`: no-array, 10.000 elementos, anidados, tipos raros, cantidad negativa/decimal/texto/`1e9`, uuid mal formado, claves `precio`/`cliente_id`: todas dan `invalido` y **ninguna** error de Postgres.
- [ ] T026 [US-B1] Migración `…20270308110200_lista_pedido_rpc.sql`: `publico.lista_pedido_por_dominio` (`anon` + `authenticated`; precio de referencia con la misma función que la ficha, escala por cantidad con cuenta activa; `no_disponibles` indistinguibles; sin escritura). Verificar y, si corresponde, aplicar el limitador de pedidos públicos de la búsqueda y dejar un `statement_timeout` documentado. **FR-023, FR-024; amenazas 1.4, 1.9**.
- [ ] T027 [US-B1] Migración `…20270308110300_enviar_lista_pedido.sql`: `private.crear_consulta_pedido` (insertor interno, sin `execute` de API) y `publico.enviar_lista_pedido` (`anon` + `authenticated`; sub-transacción con un manejador, `registrar_envio_tienda(empresa,'pedido',clave)`, con cuenta activa usa nombre y correo de la ficha y `cliente_id`, rechazo total ante productos no visibles, respuestas cerradas, `raise warning` solo con `sqlstate`). **FR-025 a FR-030; amenazas 1.1, 1.2, 1.5 a 1.8, 1.10**.
- [ ] T028 [US-B1] pgTAP `supabase/tests/database/tienda_lista_pedido.test.sql`: ítems y consulta en una transacción, `precio_referencia` del servidor (la clave `precio` enviada no cambia nada), sexto envío = `limite`, clave repetida = una consulta, host desconocido = empresa desactivada = pausada, producto de otra org/oculto/inactivo/inexistente indistinguibles, 51 líneas y cantidad 10.000 = `invalido`, caracteres de control rechazados, nota con `<script>` guardada literal, con cuenta no se piden datos y la consulta lleva `cliente_id`, `anon` sin `execute` sobre `crear_consulta_publica`, `crear_consulta_pedido` ni a las tablas, ningún camino de error devuelve texto de Postgres, falla de entrega no gasta cupo, aislamiento entre dos organizaciones. — evidencia: pgTAP verde. Escenarios B1-1 a B1-9.
- [ ] T029 [P] [US-B1] Panel: `pages/consultas/` muestra el origen «Pedido» en la bandeja y los ítems (producto, SKU, cantidad, «precio de referencia», total de referencia) en el detalle, **como texto**; texto inicial de «Responder» con los ítems (`lib/textoInicialConsulta.ts`); Vitest con axe y test de render literal de `<script>`. **FR-031**.
- [ ] T030 [P] [US-B1] Aviso por correo de Consultas: confirmar que la plantilla de texto plano maneja `origen = 'pedido'` y agrega el resumen de ítems (máx. N líneas) sin datos del visitante en el asunto; ajustar `consultas_aviso` y su pgTAP si hace falta. **FR-030**.
- [ ] T031 [P] [US-B1] `apps/web/src/lib/listaPedido.ts` (+ test): almacenamiento local por host con `try/catch` y respaldo en memoria, solo `producto_id` y `cantidad` (test: **nunca** guarda precios), tope 50 y 9.999, suma de repetidos. **FR-020, FR-022**.
- [ ] T032 [P] [US-B1] `hooks/useListaPedido.ts` y `BotonAgregarALista.tsx` en la ficha, `IndicadorLista.tsx` en `layout/BarraSuperior.tsx` (+ tests con axe). **FR-020, FR-021**.
- [ ] T033 [US-B1] Ruta `pages/tienda-publica/rutas/lista.tsx` + `lista/PantallaLista.tsx` y `FormularioPedido.tsx`: revalidación con `lista_pedido_por_dominio`, avisos de «No disponible» y «Sin stock hoy», precio de referencia con la leyenda, cantidad editable y «Quitar», formulario (nombre, contacto, nota, aviso de uso de datos con el enlace legal), `clave_envio` al abrir el envío, una sola petición en vuelo, estados de carga, vacío, error y `limite`. **FR-021 a FR-029, FR-033**.
- [ ] T034 [US-B1] `lista/ConfirmacionPedido.tsx` («Recibimos tu pedido… No se cobró nada») y vaciado de la lista; con error o límite conserva la lista. Vitest + axe 320/768/1440 de todas las pantallas de B1. **FR-032, FR-033**.
- [ ] T035 [US-B1] Test de XSS e inyección de extremo a extremo: nombre, contacto y nota con `<script>`, HTML, fórmula de CSV y saltos de línea se ven literales en el panel, en el texto inicial de «Responder», en el correo de aviso y en una exportación a CSV (fórmulas neutralizadas). **Amenaza 1.5**.
- [ ] T036 [US-B1] E2E `apps/web/e2e/tienda-lista-pedido.e2e.ts`: visitante agrega 3 productos → abre la lista → envía → el operador ve la consulta «Pedido» con los 3 ítems; sexto envío = aviso de límite. **SC-002**.
- [ ] T037 [US-B1] Revisión de seguridad enfocada en B1 (spam, evasión del límite, enumeración, datos personales, errores) con el modelo de amenazas 1.x; **retención de datos personales** trazada como seguimiento si sigue sin decidirse (D-7). — evidencia: nota en `docs/seguridad-tienda-compra-y-cuentas.md`.
- [ ] T038 [US-B1] Docs: sección B1 de `docs/tienda-compra-y-cuentas.md` (contratos, límites, bandera, qué ve el operador) y `docs/consultas.md` (origen `pedido`, ítems, `cliente_id`), `docs/tiendas-online.md`; `pnpm docs:check`. Guards (T021) y revisiones QA y Código + Seguridad de B1 antes del merge.

**Checkpoint B1**: un visitante envía una lista y el operador la ve con los ítems; el sexto envío de la hora se rechaza; la lista no guarda precios; ningún dato de otra tienda.

---

## Fase 3 — US-B2 · Presupuesto desde la tienda

- [ ] T039 [US-B2] Migración `…20270308120000_presupuestos_tienda.sql`: `dominio.presupuestos_tienda` (esquema **`dominio`**; RLS por organización + empresa accesible + `ventas` ≥ lectura; `select` a `authenticated`; `anon` nada; únicas `(cuenta_cliente_id, clave_envio)` y `(comprobante_id)`; FK compuestas) y `private.siguiente_numero_comprobante_org(p_org, p_empresa, p_tipo)` con el mismo `insert … on conflict do update` atómico que la de panel. Sin tocar la existente. — evidencia: pgTAP de RLS, privilegios y concurrencia de numeración.
- [ ] T040 [US-B2] Migración `…20270308120100_motor_presupuesto_tienda.sql`: `private.motor_presupuesto_tienda(cuenta, items)` con el mismo pipeline que el panel (producto activo y visible, `escala_para_linea`, descuento de la ficha sobre el neto, IVA por alícuota, redondeo, depósito por defecto activo que vende la tienda, `sin_precio` si falta precio o es ≤ 0) completando **todas** las columnas inventariadas en T003; si existe `private.precio_linea_venta` (MSF-816) la usa (D-17). **FR-051 a FR-056**.
- [ ] T041 [US-B2] Migración `…20270308120200_presupuesto_tienda_rpc.sql`: `publico.cotizar_presupuesto_tienda` y `publico.crear_presupuesto_tienda` (solo `authenticated`; orden de verificaciones del contrato; lock por cuenta; idempotencia; cupo de la tienda con origen `presupuesto`; topes 5/día y 10 abiertos con `private.hoy_argentina()`; alta atómica de comprobante, líneas, vínculo y actividad; sin llamar a stock, reservas ni cobros; `security definer`, `search_path = ''`, sin SQL dinámico). **FR-051 a FR-060; amenazas 2.1 a 2.12**.
- [ ] T042 [US-B2] pgTAP `supabase/tests/database/tienda_presupuesto_cliente.test.sql` (adversarial, con dos organizaciones, dos tiendas y tres clientes): (a) **IDOR**: cliente A no crea ni lee para B, aun mandando `cliente_id` en el `jsonb`; (b) `sin_acceso` para anónimo, usuario de panel, cuenta suspendida (al instante), no habilitada, cuenta de otra tienda con el host de esta; (c) **claves ajenas ignoradas**: `precio`, `escala`, `descuento`, `deposito_id`, `estado`, `canal` no cambian el resultado; (d) **paridad** con el panel (mismas líneas armadas con `guardar_lineas_comprobante` = mismos importes, todas las columnas; mayorista con escala x10 y descuento); (e) `sin_precio` no consume número ni crea nada; (f) **cero efectos**: mismas filas antes y después en `movimientos_stock`, reservas y cobros y el estado queda `pendiente`; (g) topes (sexto del día, 11 abiertos, 51 líneas, cantidad 10.000, jsonb hostil) y **concurrencia** con el lock (dos llamadas con 4 creados: se crea una); (h) idempotencia (misma clave = mismo número); (i) error provocado a mitad = contador de numeración sin cambio; (j) `anon` sin `execute`; (k) `anon` y `authenticated` sin escritura sobre las tablas; (l) ninguna respuesta con texto de Postgres. **SC-003 a SC-005**.
- [ ] T043 [US-B2] Evento de actividad `presupuesto.creado_desde_tienda` (actor nulo, rotulado «Tienda online» en Actividad; detalle con número y cliente Nº y nombre, **sin correo**) + pgTAP y ajuste del rótulo en la pantalla de Actividad si T003(c) lo requirió. **FR-060; amenaza 2.9**.
- [ ] T044 [P] [US-B2] `lib/tiendaPedido.ts` (+ test): `cotizar` y `crear` con `clave_envio` por intento, una sola petición en vuelo, manejo de cada `estado`. **FR-050**.
- [ ] T045 [US-B2] `lista/PantallaLista.tsx`: «Pedir presupuesto» solo con sesión activa, cotización del servidor antes de enviar («lo que ves es lo que se crea»), manejo de `sin_precio`, `no_disponible`, `limite` y `limite_cuenta`; confirmación con número y enlace a «Mi cuenta › Compras y presupuestos» (si A está construida); vaciado de la lista. Vitest + axe 320/768/1440. **FR-050, FR-062, FR-064**.
- [ ] T046 [US-B2] Ventas: rótulo «Creado desde la tienda por el cliente» y canal «Tienda online» en Presupuestos y en el comprobante cuando `canal = 'tienda_online'` y no hay operador (solo front; sin tocar `obtener_comprobante`); Vitest. **FR-061**.
- [ ] T047 [US-B2] E2E `apps/web/e2e/tienda-presupuesto.e2e.ts`: cliente mayorista ingresa → arma lista → cotiza → pide presupuesto → el operador lo ve `pendiente`, canal «Tienda online», lo acepta con el flujo actual y no hay movimiento de stock; sexto presupuesto del día = aviso. Axe en la confirmación. **SC-006**.
- [ ] T048 [US-B2] **Revisión de seguridad independiente de B2** (skill `authz-security`, contra el modelo de amenazas 2.x) **antes del merge a `dokploy`**; hallazgos corregidos y registrados en `docs/seguridad-tienda-compra-y-cuentas.md`. — evidencia: informe y commits de corrección.
- [ ] T049 [US-B2] Seguimiento trazado (Tarea `seguimiento` en el tracker) de: aviso al equipo por presupuesto nuevo desde la tienda (D-12), «Crear presupuesto desde la consulta» en el panel (D-14), validez por defecto (D-13) y unificación del cálculo con `private.precio_linea_venta` (D-17). **FR-063**.
- [ ] T050 [US-B2] Docs: sección B2 de `docs/tienda-compra-y-cuentas.md` (contrato, topes, auditoría, qué ve el operador, cómo apagar con la bandera), `docs/ventas-comprobantes.md` (comprobantes creados desde la tienda, canal `tienda_online`, `operador_id` nulo) y `docs/tiendas-online.md`; `pnpm docs:check`. Guards (T021) y revisiones QA y Código + Seguridad antes del merge.

**Checkpoint B2**: el presupuesto de la tienda coincide en importes con el del panel, no mueve stock ni cobros, respeta los topes y la idempotencia, y el operador lo acepta con el flujo actual.

---

## Fase 4 — Cierre (tarea de cierre, label `cierre`)

- [ ] T060 [US-A] Medir demanda y cuentas (T003d) antes de **encender** `tienda_pedidos` en cada entorno; encenderla por SQL solo con la revisión de seguridad integral aprobada y dejar el procedimiento en `docs/deployment.md`. Si Nicolás no confirma demanda, la bandera queda apagada y se traza.
- [ ] T061 [US-A] Revisión de seguridad **integral** → `docs/seguridad-tienda-compra-y-cuentas.md`: recorre las tablas 1, 2 y 3 del modelo de amenazas contra el código final (RLS, grants, `search_path`, SQL dinámico, claves ajenas, topes, auditoría, errores, XSS, datos personales), con hallazgos H-n y seguimientos; skills `authz-security` y `repo-security-posture`.
- [ ] T062 [US-A] Fila del roadmap en `docs/roadmap-template.md` (Tiendas online: tienda compra y cuentas, MSF-176; estado, links a spec, guía y seguridad) e índice en `docs/README.md`; actualizar la fila de MSF-450 (F-CLI-20 entregada) y registrar F-TDA-26 completa como **fuera** (D-1).
- [ ] T063 [US-A] Decisiones **D-1 a D-19** confirmadas por Nicolás (o ajustadas) reflejadas en la spec; las no confirmadas quedan marcadas «supuesto vigente».
- [ ] T064 [US-A] Manual de usuario de la tienda y de Consultas: viven en `main`; si no se pueden tocar desde esta rama, **seguimiento trazado** (Tarea `seguimiento`) con su clave.
- [ ] T065 [US-A] Verificación en dev (después del merge): bundle de dev con las rutas `mi-cuenta` y `lista`, migraciones aplicadas por el cron, `anon` sin `execute` donde no corresponde, `search_path` vacío, 0 tablas sin RLS, y la prueba con una cuenta de prueba (historial, favorito, lista, presupuesto) **sin escribir datos reales**. Función Edge nueva: ninguna (no aplica el problema de registro).
- [ ] T090 [US-A] Verificar que **ninguna tarea de este archivo queda `[ ]`**: cada una hecha con evidencia, o `[x]` + `Desvío:` + seguimiento trazado. Sin esto la épica no se libera.
- [ ] T091 [US-A] Guards finales y CI verde del PR: `pnpm lint`, `pnpm build`, `pnpm test` (con `pnpm dev:supabase`), `pnpm matriz:check`, `pnpm prototipo:check`, `pnpm docs:check`, `pnpm estilos:check`, `pnpm ui:empresas:check`, `pnpm e2e:escritura:check`, `pnpm e2e:omitidos:check`, `node scripts/verificar-migraciones.mjs` y commitlint; merge a `dokploy` con merge commit (`--no-ff`).

> Notas de desvío que se agreguen acá van cortas, con `ver commit <hash>` (CLAUDE.md).
