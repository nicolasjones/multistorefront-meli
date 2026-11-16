# Plan de implementación: Tiendas online · Tienda compra y cuentas (MSF-176)

**Spec**: `spec.md` · **Contratos**: `contracts/tienda-compra-y-cuentas.md` · **Rama**: `epic/MSF-176-tienda-compra-y-cuentas` (PR a `dokploy`)
**Alcance de entrega**: `refine` (`apps/web`: tienda pública y detalle de Consultas / rótulos en Ventas y Actividad) y `supabase` (migraciones, funciones `publico.*`, pgTAP). Sin `kestra`, `superset` ni `workers`.
**Estado (2026-11-14)**: spec cerrada. Nicolás delegó todas las decisiones (D-1 a D-19 confirmadas, D-20 a D-28 resueltas); pantallas definidas en la spec; código verificado contra `origin/dokploy` con MSF-816 ya entregada. Solo dev: ningún paso de este plan toca staging ni producción.

## Resumen técnico

Todo es **aditivo** sobre lo que ya existe: la cuenta web (`public.cuentas_cliente`, `publico.acceso_cliente_por_dominio`), la superficie pública por `Host`, el límite por visitante (`private.registrar_envio_tienda`), la bandeja de Consultas, los comprobantes, el precio único de línea de MSF-816 y la auditoría. La pieza nueva con riesgo es una función pública que crea un **comprobante sin sesión de panel** (B2); se construye sobre **un solo punto de identidad** (`private.cuenta_de_tienda`) y **un solo cálculo de precio** (el de MSF-816, extraído sin sesión) que usan tanto la cotización como la creación.

Decisiones de diseño:

1. **Identidad única.** Toda RPC de cuenta (`mis_*`, `cambiar_favorito`, `cotizar_*`, `crear_*`) llama primero a `private.cuenta_de_tienda(host)`. Ninguna recibe `cliente_id`, `cuenta_id`, `empresa_id` ni `organizacion_id`.
2. **Precio: reuso de MSF-816, no motor propio (D-17).** `private.precio_linea_venta` (ya en `dokploy`, `20270310100100`) es `security invoker` y delega en `private.precio_para`, que devuelve vacío sin sesión de panel y, peor, depende de `private.organizacion_id()` en `alicuota_producto` (IVA 0) y `precio_propio_empresa` (precio propio ignorado) **sin dar error**. Por eso la primera tarea de B2 (T050) **extrae** `private.precio_para_calculo` y `private.precio_linea_venta_calculo` (`security definer`, sin compuerta de sesión, acotados por la organización **de la empresa**) y deja `precio_para` y `precio_linea_venta` como envoltorios con la compuerta y el aislamiento por organización de la sesión (hoy lo da la RLS del `security invoker`). Mismo resultado de hoy, comprobado por el pgTAP vigente de precios y comprobantes (que **no se modifica**) más una paridad nueva; revisión independiente del refactor antes de seguir (T052). No se redefinen `crear_comprobante`, `guardar_lineas_comprobante`, `siguiente_numero_comprobante` ni `crear_consulta_publica`; la numeración con organización explícita sí es una función nueva.
3. **Lista en el navegador, servidor como autoridad.** La lista solo guarda `producto_id` y `cantidad`; el servidor revalida y calcula todo cada vez.
4. **Bandera de plataforma** `tienda_pedidos` (nombre fijado), fila nueva en `public.banderas_plataforma` (`private.bandera_activa`, patrón `promociones_precio`), **apagada por defecto**, global (no por tienda; para limitar a una tienda se usa la pantalla de publicación existente) y encendida **solo en dev** por `scripts/tienda-pedidos-dev.mjs` (D-24). El front la conoce por `publico.capacidades_tienda_por_dominio` (D-27), porque `anon` no puede leer la tabla.
5. **Carga infinita** en «Mi cuenta» (cursor por `(fecha, id)` / `(creado_en, id)`), sin `TablePagination`.
6. **Pantallas definidas en la spec** (D-26): `spec.md › Pantallas y textos` es la fuente de verdad visual; las diferencias que aparezcan al implementar se anotan en el PR.

## Esquemas y reversión (aditivo)

Versiones **provisionales** a partir de `20270320100000` (las de B1 se renumeraron al implementar a `20270321100000…20270321100500`, por encima del máximo de `origin/dokploy` `20270320100500`) (el 2026-11-14 el máximo de `origin/dokploy` es `20270310100300` y otras ramas reservan `20270310100400` y `20270311100000`; se dejó margen). **Se ajustan al implementar**: antes de cada historia se integra `origin/dokploy` por merge, se lee el máximo del momento, se renumera con margen y se corre `node scripts/verificar-migraciones.mjs` (T003). Ninguna reversión se ejecuta en el mismo PR.

| Migración | Historia | Objetos (esquema) | Reversión (migración posterior) |
|---|---|---|---|
| `20270320100000_tienda_capacidad.sql` | transversal | fila `tienda_pedidos` (apagada) en `public.banderas_plataforma`; `publico.capacidades_tienda_por_dominio(host)` (`publico`, `anon`+`authenticated`) | borrar la fila; `drop function` |
| `20270320100100_cuenta_de_tienda.sql` | A, B1, B2 | `private.cuenta_de_tienda(host)` (`private`) | `drop function private.cuenta_de_tienda(text)` |
| `20270320100200_favoritos_cliente.sql` | A | `dominio.favoritos_cliente` (**tabla**, `dominio`) con RLS «cuenta propia» y sin privilegios de API | `drop table dominio.favoritos_cliente` (exportar antes) |
| `20270320100300_tienda_favoritos_rpc.sql` | A | `publico.cambiar_favorito_por_dominio`, `mis_favoritos_por_dominio`, `favoritos_entre_por_dominio` (`publico`) | `drop function` de cada una |
| `20270320100400_tienda_historial_rpc.sql` | A | `publico.mis_compras_por_dominio`, `mi_compra_por_dominio` (`publico`) e índice de apoyo `(cliente_id, empresa_id, fecha desc, id desc)` en `dominio.comprobantes_venta` (aditivo, `if not exists`) | `drop function` de cada una; `drop index` |
| `20270321100000_consulta_items.sql` | B1 | `dominio.consulta_items` (**tabla**, `dominio`); `dominio.consultas`: `check` de `origen` suma `pedido` (buscar el nombre real de la restricción), columna `cliente_id` nullable, `consultas_mensaje_requerido` exime a `pedido`; `dominio.tienda_envios`: `check` de `origen` suma `pedido` y `presupuesto`; vista `public.consulta_items_bandeja` (`security_invoker`); `public.consultas_bandeja` suma `cliente_id` e `items_cantidad` | `drop view`; `drop table dominio.consulta_items`; `alter table … drop column cliente_id`; restaurar los `check` **solo si no hay filas** `pedido`/`presupuesto` |
| `20270321100100_validar_items_pedido.sql` | B1, B2 | `private.validar_items_pedido(p_items)` (`private`): normaliza y valida la lista | `drop function` |
| `20270321100200_lista_pedido_rpc.sql` | B1 | `publico.lista_pedido_por_dominio` (`publico`, `anon`+`authenticated`) | `drop function` |
| `20270321100300_consultas_aviso_pedido.sql` | B1 | `private.emitir_aviso_consulta(consulta)` (`private`) y el disparador `encolar_aviso_consulta`: el aviso de un pedido lo emite `crear_consulta_pedido` con el resumen de ítems | volver al cuerpo de `20261210130300` y `drop function` |
| `20270321100400_enviar_lista_pedido.sql` | B1 | `private.crear_consulta_pedido(...)` (`private`, insertor interno) y `publico.enviar_lista_pedido` (`publico`, `anon`+`authenticated`) | `drop function` de ambas |
| `20270321100500_exportacion_total_consulta_items.sql` | B1 | `private.conjuntos_exportacion_total()`: `dominio.consulta_items` se exporta (pgTAP de completitud de la exportación total) | volver a la definición de `20270222300200` |
| `20270320120000_precio_sin_sesion.sql` | B2 | `private.precio_para_calculo` y `private.precio_linea_venta_calculo` (`private`, sin `execute` de API); `private.precio_para` y `private.precio_linea_venta` pasan a envoltorios (misma firma, mismos grants, mismo resultado) | restaurar `private.precio_para` de `20270213200002` y `private.precio_linea_venta` de `20270310100100`; `drop function` de las dos nuevas |
| `20270320120100_presupuestos_tienda.sql` | B2 | `dominio.presupuestos_tienda` (**tabla**, `dominio`) con RLS por organización/empresa/`ventas`; `private.siguiente_numero_comprobante_org(org, empresa, tipo)` (`private`) | `drop table`; `drop function` |
| `20270320120200_motor_presupuesto_tienda.sql` | B2 | `private.motor_presupuesto_tienda(cuenta, items)` (`private`): arma las líneas **llamando** a `precio_linea_venta_calculo`, depósito por defecto, totales | `drop function` |
| `20270320120300_presupuesto_tienda_rpc.sql` | B2 | `publico.cotizar_presupuesto_tienda`, `publico.crear_presupuesto_tienda` (`publico`, solo `authenticated`); fila `presupuesto.creado_desde_tienda` en `public.tipos_evento_actividad` | `drop function` de cada una; los presupuestos creados se **anulan** por el flujo normal (no se borran) |
| `20270320120400_listar_presupuestos_origen_tienda.sql` | B2 | `public.listar_presupuestos` (misma firma): operador «Tienda online (cliente)» si no hay operador y el canal es `tienda_online` | restaurar la versión de `20261204150200` |

**Re-verificación del Principio VII, tabla por tabla** (se repite en tareas, implementación y revisión del PR):

| Tabla | Esquema declarado | Por qué no `public` | RLS | Privilegios |
|---|---|---|---|---|
| `dominio.favoritos_cliente` | `dominio` | Datos del negocio sobre productos del catálogo; referencia a la cuenta (que sí es `public` por ser identidad de plataforma) | Habilitada; política solo cuenta propia | `anon`, `public`, `authenticated`: ninguno |
| `dominio.consulta_items` | `dominio` | Líneas de una consulta (`dominio.consultas`) | Habilitada; org + empresa accesible + `consultas` ≥ lectura | `select` a `authenticated`; nada a `anon` |
| `dominio.presupuestos_tienda` | `dominio` | Registro del negocio atado a un comprobante de `dominio` | Habilitada; org + empresa accesible + `ventas` ≥ lectura | `select` a `authenticated`; nada a `anon` |

`rls_en_toda_tabla` (recorre `public` + `dominio`) debe pasar; `has_table_privilege` de `anon` en las tres = falso; `has_function_privilege('anon', …)` = verdadero **solo** para `capacidades_tienda_por_dominio`, `lista_pedido_por_dominio` y `enviar_lista_pedido` (y las ya existentes). Cada historia actualiza los tests de superficie con la lista cerrada que le corresponde (los de `acceso_cliente_por_dominio` y `consultas.test.sql` quedan como están, salvo el origen `pedido`).

## Orden de implementación (por historia, con checkpoints)

Se implementa **historia por historia** (CLAUDE.md), con `/clear` entre una y otra. Cada historia **integra antes `origin/dokploy` por merge** (nunca rebase ni force-push), renumera sus migraciones por encima del máximo del momento y termina con: pgTAP, Vitest con axe (320/768/1440), guards locales, las **revisiones independientes** (QA y Código + Seguridad, marcadas `[REV]` en `tasks.md`) y su merge a `dokploy` **antes** de empezar la siguiente. Orden fijo: **A → B1 → B2**; ninguna historia exige que la siguiente exista.

### Fase 0 · Cimientos (transversal)

1. Bandera `tienda_pedidos` y `publico.capacidades_tienda_por_dominio` (T001). Apagada por defecto en todos los entornos.
2. `private.cuenta_de_tienda(host)` con su pgTAP de aislamiento (T002): es la pieza de la que cuelgan las tres historias.
3. Recontrol del código al empezar (T003): MSF-816 y su fase F-3 (`confirmar_comprobante`), el máximo real de migraciones y la renumeración. El inventario de columnas de línea, la existencia de `precio_linea_venta` y el comportamiento de `insertar_actividad` con actor nulo **ya están verificados** y escritos en la spec y en los contratos.
4. Script de encendido solo para dev (T004).

**Checkpoint 0**: la función de identidad rechaza a todos los que no son una cuenta activa y habilitada de esa tienda (pgTAP verde); la bandera está apagada y el script la enciende solo en dev; las tres tablas siguen sin crearse.

### Fase 1 · A — «Mi cuenta» (F-CLI-20)

1. `dominio.favoritos_cliente` + RPC de favoritos con tope y lock.
2. RPC de historial (`mis_compras`, `mi_compra`) con lista blanca y estado público.
3. Front: ruta `mi-cuenta` (pestañas, `CargaInfinita`, detalle), botón de favoritos en la ficha, «Mi cuenta» en `AccesoCliente` y en el menú móvil, `?volver=` en `ingresar`.
4. Docs, Vitest, E2E (dos tiendas del seed).

**Checkpoint A**: un cliente con cuenta activa ve su historial y sus favoritos por tienda, un cliente no ve nada de otro y quien no tiene cuenta activa va a «Ingresar»; sin B1 ni B2 construidas.

### Fase 2 · B1 — Lista de pedido sin cobro

1. Migración de `consulta_items` y ampliación de `origen` (aditiva).
2. `private.validar_items_pedido` + `lista_pedido_por_dominio` (lectura) + `enviar_lista_pedido` (escritura, con límite e idempotencia).
3. Panel: «Origen = Pedido» y detalle con ítems (vista `consulta_items_bandeja`); texto inicial de «Responder» con los ítems; aviso por correo con el resumen.
4. Front: almacenamiento local de la lista, botón en la ficha, indicador en el encabezado, ruta `lista`, confirmación.
5. Docs (incluida la retención sin purga, D-20), Vitest, E2E (visitante → bandeja).

**Checkpoint B1**: un visitante envía una lista y el operador la ve con los ítems; seis envíos en una hora → el sexto `limite`; la lista no guarda precios; ningún dato de otra tienda.

### Fase 3 · B2 — Presupuesto desde la tienda

1. **Refactor del cálculo de precio sin sesión** (T050 a T052), con revisión independiente: es código compartido por el panel y por la tienda; no sigue nada hasta que esté verde y revisado.
2. `dominio.presupuestos_tienda`, numeración con organización explícita, motor de armado de líneas.
3. `cotizar_presupuesto_tienda` (solo lectura) y `crear_presupuesto_tienda` (atómica, con topes, idempotencia, auditoría).
4. Front: «Pedir presupuesto» en la lista (solo con sesión activa), diálogo de cotización, confirmación; operador «Tienda online (cliente)» y rótulo en Ventas; rótulo «Tienda online» en Actividad.
5. pgTAP de seguridad extenso (IDOR, aislamiento, paridad de todas las columnas, cero efectos de stock/cobro, concurrencia).
6. Docs, Vitest, E2E (cliente → presupuesto `pendiente` en Ventas).

**Checkpoint B2**: el presupuesto creado coincide en importes y columnas con el del panel (con y sin promoción, con precio propio), no mueve stock ni cobros y respeta los topes; el operador lo acepta con el flujo actual.

### Fase 4 · Cierre

Guía `docs/tienda-compra-y-cuentas.md`, revisión de seguridad integral (`docs/seguridad-tienda-compra-y-cuentas.md`, que recorre las tablas 1, 2 y 3 del modelo de amenazas contra el código final), fila del roadmap, índice de docs, seguimientos trazados (retención, aviso al equipo, filtro por canal, «Crear presupuesto desde la consulta», manual de usuario) y verificación en **dev** (bundle y RPC con una cuenta de prueba, como en el tablero; la bandera queda encendida en dev). Ninguna tarea queda `[ ]`.

## Front (`apps/web`)

- Tienda pública: `pages/tienda-publica/rutas/mi-cuenta.tsx` y `lista.tsx` (el nombre de archivo define la ruta; `EnrutadorTienda` las carga con `lazy`); componentes en `pages/tienda-publica/cuenta/` (`HistorialMiCuenta`, `DetalleCompra`, `FavoritosMiCuenta`, `BotonFavorito`) y `pages/tienda-publica/lista/` (`BotonAgregarALista`, `IndicadorLista`, `PantallaLista`, `LineaLista`, `FormularioPedido`, `DialogoPresupuesto`, `ConfirmacionPedido`). El historial **no** se llama `ComprasCliente` para no chocar con `components/clientes/ComprasCliente` del panel.
- Encabezado: `layout/AccesoCliente.tsx` suma «Mi cuenta»; `layout/LayoutTienda.tsx` monta `IndicadorLista`; `layout/MenuMovil.tsx` suma «Mi cuenta», «Mi lista» y «Salir» (P-1). `rutas/ingresar.tsx` acepta `?volver=` solo con rutas internas.
- Estado de la lista: `apps/web/src/lib/listaPedido.ts` (almacenamiento local por host con `try/catch`, solo `producto_id` y `cantidad`, tope de 50 líneas y 9.999 unidades) y `hooks/useListaPedido.ts`.
- Capacidades: `lib/tiendaCapacidades.ts` + `hooks/useCapacidadesTienda.ts` (llama a `capacidades_tienda_por_dominio` una vez por host; mientras no responde no se dibuja nada de la épica).
- Llamadas: `lib/tiendaCuentaDatos.ts` (historial y favoritos), `lib/tiendaPedido.ts` (lista, envío, cotización, creación), con `clave_envio` generada al abrir el envío y una sola petición en vuelo.
- Listados con `CargaInfinita` y `useListadoAcumulado`; miniaturas con `MiniaturaProducto` (zoom); sin colores ni dimensiones literales (`pnpm estilos:check`); sin `FiltroEmpresa` (una sola tienda por dominio).
- Panel: `lib/consultas.ts` (origen `pedido`), `pages/consultas/list.tsx` («Pedido de n productos») y `components/consultas/DetalleConsulta.tsx` (ítems en texto plano, sin HTML), `lib/textoInicialConsulta.ts`; `pages/ventas/presupuestos.tsx` y `comprobante.tsx` (operador «Tienda online (cliente)» y rótulo «Creado desde la tienda por el cliente»); `pages/actividad/list.tsx`, `components/actividad/DetalleActividadDialog.tsx` y `lib/exportarActividad.ts` («Tienda online» para el evento de la tienda).
- Bandera: con `tienda_pedidos` apagada la tienda no muestra lista ni «Mi cuenta» y las funciones responden `error`/`sin_acceso` genérico (el servidor lo impone; la lectura de historial/favoritos y la cotización también). Las funciones de cuenta ya existentes no cambian.

## Pruebas

- **pgTAP** (`supabase/tests/database/`): `tienda_capacidades.test.sql`, `tienda_cuenta_de_tienda.test.sql`, `tienda_favoritos.test.sql`, `tienda_historial.test.sql`, `tienda_lista_pedido.test.sql`, `precio_sin_sesion.test.sql` (paridad del cálculo con el panel, con cliente web), `tienda_presupuesto_cliente.test.sql` (dos organizaciones, dos tiendas, tres clientes; paridad de todas las columnas; cero efectos de stock/cobro; concurrencia con lock; superficie `anon`). Más la actualización de `consultas.test.sql` (origen `pedido`) y de los tests de superficie de `publico`. Los pgTAP existentes de precios y comprobantes **no se modifican** y deben seguir verdes.
- **Vitest + axe** a 320/768/1440 para cada pantalla y hook; test de que el almacenamiento local no guarda precios; test de render literal de `<script>` en el detalle de Consultas; test que cambia de empresa activa con un pedido abierto.
- **E2E** (Playwright, sin escritura directa: `pnpm e2e:escritura:check`): `tienda-cuenta.e2e.ts`, `tienda-lista-pedido.e2e.ts`, `tienda-presupuesto.e2e.ts`; corren con la bandera encendida por el script de dev.
- **Guards**: `pnpm matriz:check`, `pnpm der:check`, `pnpm prototipo:check`, `pnpm docs:check`, `pnpm estilos:check`, `pnpm ui:empresas:check`, `pnpm lint`, `pnpm build`, commitlint.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| **B2 abre una vía de escritura de comprobantes para un rol que no es del panel** (el mayor riesgo del producto en esta épica) | Identidad única, precio único, lista blanca de entradas, topes y lock, sin efectos de stock/cobro, pruebas adversarias, bandera global apagada, revisión de seguridad independiente antes del merge de B2 (T062) |
| **El refactor de `precio_para` / `precio_linea_venta` rompe el precio del panel** (funciones compartidas, recién entregadas por MSF-816) | Envoltorios con el mismo resultado; los pgTAP vigentes de precios y comprobantes no se tocan y deben seguir verdes; paridad nueva; revisión independiente del refactor (T052) antes de construir B2 encima; coordinar con la rama `feat/precio-promocional-f3` (`confirmar_comprobante`), que usa las mismas funciones |
| Llamar `precio_linea_venta` tal cual desde la tienda: IVA 0 y precio propio ignorado **sin error** | No se llama: se usa el cálculo sin sesión (D-17); la paridad nueva lo prueba con un cliente web, con IVA 21 %, exento y con precio propio |
| `guardar_lineas_comprobante` suma columnas a futuro (hoy: `precio_referencia`, `promocion_id`, `descuento_pct`, `sin_stock`) que B2 debe completar igual | Inventario en `contracts/…#líneas-del-presupuesto`; la prueba de paridad compara **todas** las columnas de la línea y falla si aparece una columna nueva sin cubrir |
| Spam y aviso masivo al equipo | Cupo existente por visitante, topes por cuenta, bandera; aviso ya agrupado y con reintentos |
| Datos personales sin plazo de retención | Mínimo de campos, sin IP, RLS por sección; **sin purga automática en esta épica** (D-20), documentado y con seguimiento trazado |
| La demanda no está confirmada y no es medible en dev | Bandera apagada por defecto, encendida solo en dev por script (D-24); ningún otro entorno |
| Cuenta web con pocas cuentas activas (valor de A) | A es la historia de menor costo; se verifica con cuentas de prueba en dev |
| Producto sin precio en pesos (falta dólar) o con precio ≤ 0 | Se rechaza la línea (`sin_precio`); nunca se crea en cero |
| Pantallas sin dibujo | Definidas en la spec (D-26) con wireframe, textos y estados; diferencias anotadas en el PR |
| Enumeración y cruce de tenants | Host como única fuente de la empresa; visibilidad efectiva; respuestas indistinguibles; pgTAP con dos organizaciones |
| Renumeración de migraciones al integrar (otras sesiones agregan versiones) | Versiones provisionales con margen; `node scripts/verificar-migraciones.mjs` antes de cada historia; integrar `dokploy` por merge |
| Hora «hoy» (UTC vs ART) en el tope diario y el «Vencido» | `private.hoy_argentina()` en las funciones; prueba cerca de medianoche |
| «Usuario sin nombre» como operador de los presupuestos de la tienda (hoy `listar_presupuestos` y `obtener_comprobante` lo muestran con operador nulo) | T058: columna Operador «Tienda online (cliente)» (SQL en la lista, front en la ficha) y rótulo |
| Actor nulo rotulado «Sistema» en Actividad | T057: «Tienda online» solo para el evento de la tienda |
| Documentación atrasada | Cada historia deja su sección en `docs/tienda-compra-y-cuentas.md`; el cierre suma seguridad, roadmap e índice; `docs/ventas-comprobantes.md` y `docs/precios.md` documentan el refactor del precio |
