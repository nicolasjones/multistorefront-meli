---
owner: tecnico
sources:
  - supabase/migrations
---

# API y RPC

MSF no expone una API REST propia: el panel usa **PostgREST** (tablas/vistas) y **RPC** de Postgres a través de Supabase.

## Contratos

- **Tablas/vistas:** se leen con la sesión del usuario; la **RLS** decide qué filas ve.
- **RPC:** funciones `public.*` con `security invoker` (heredan RLS) o `security definer` justificadas; `revoke` de `public, anon` y `grant execute` a `authenticated`.
- **Errores:** códigos Postgres (`P0001`, `P0002`, `22023`, `23505`, `40001`) que la UI traduce a mensajes.
- **Actividad:** las acciones importantes registran un evento en `registro_actividad` en la misma transacción.

## RPCs principales

| RPC | Para qué |
|---|---|
| `private.nivel_seccion(seccion)` | Nivel del usuario en la sección/empresa activa |
| `public.empresas_para_selector()` | Empresas accesibles, activa y rol por empresa (MSF-121 · F-ROL-06) |
| `public.cambiar_empresa_activa(p_empresa_id)` | Persiste la empresa activa y registra el evento, en una transacción (MSF-121 · F-ROL-06) |
| `public.asignar_empresas_usuario(p_target_user_id, p_asignaciones)` | Reemplazo atómico de empresas y rol por empresa, solo Administrador (MSF-121 · F-ROL-07) |
| `public.listar_empresas_usuarios()` | Empresas y rol por empresa de cada usuario, para la lista de Usuarios (MSF-121 · F-ROL-07) |
| `public.definir_empresas_producto(...)` | Empresas que venden un producto (atómica) |
| `public.ranking_clientes(...)` | Ranking por facturación (solo lectura) |
| `public.ventas_reportes_conteo(desde, hasta, empresa)` | Comprobantes que cuentan como venta en el período (estado vacío de «Reportes de ventas») (MSF-338 · F-VTA-22) |
| `public.leer_ranking_ventas(desde, hasta, incluir_consumidor_final, empresa, pagina, tamano)` | Lectura del ranking de clientes para la exportación a Excel; exige la sección `reportes` (MSF-338 · F-VTA-23) |
| `public.buscar_clientes(texto, tipo, archivados, pagina, tamano)` | Listado de clientes con búsqueda parcial, filtros y paginación en el servidor (MSF-180 · F-CLI-02) |
| `public.exportar_clientes(texto, tipo, archivados, despues_de, limite)` | Exportación de clientes por lotes (keyset); exige la acción `exportar` (MSF-180 · F-CLI-04) |
| `public.escala_de_cliente(cliente_id)` | Escala de precios del cliente según su tipo: `x1` o `por_cantidad` (MSF-180 · F-CLI-03) |
| `public.solicitar_importacion_historial(...)` | Crea la ejecución de importación |
| `public.listar_historial_ventas/cobros/cotizaciones(...)` | Consulta paginada del historial |
| `public.cambiar_estado_reparacion(p_id, p_estado_id)` | Cambia estado (idempotente); un estado que cierra va por la entrega |
| `public.registrar_entrega_reparacion(p_id, p_estado_id, p_entrega_real, p_entregado_por)` | Entrega y cambio a estado que cierra, en una transacción |
| `public.anular_reparacion(p_id, p_motivo)` | Anulación irreversible con motivo |
| `public.historial_reparacion(p_id)` | Historial de la reparación (usuario sin email) |
| `public.crear_reparacion(...)` / `actualizar_reparacion(...)` / `obtener_reparacion(id)` | Alta con número por empresa, edición con bloqueo optimista (`40001`), lectura con costos enmascarados sin `ver_costos` |
| `public.listar_reparaciones(empresa, periodo, serie, tecnico, pagina, tamano)` | Listado paginado con filtros por período (entrega prevista), serie y técnico; sin costos internos (MSF-199) |
| `public.agregar_item_reparacion(...)` / `public.quitar_item_reparacion(item)` | Alta y baja de mano de obra o repuestos con recálculo de totales en la misma transacción (MSF-199) |
| `public.tecnicos_de_service()` | Técnicos elegibles (usuarios con `edicion` en Service técnico) |
| `public.crear_modelo_equipo` / `actualizar_modelo_equipo` / `cambiar_estado_modelo_equipo` | Catálogo de modelos |
| `public.crear_estado_reparacion` / `actualizar_estado_reparacion` / `mover_estado_reparacion` / `cambiar_estado_estado_reparacion` | Catálogo de estados |
| `public.uso_modelo_equipo(id?)` / `uso_estado_reparacion(id?)` | Cantidad de reparaciones que usan cada modelo/estado |
| `public.historial_ultimo_numero(...)` | Último número histórico para la numeración nueva |
| `public.cargar_cotizacion(valor)` / `estado_cotizacion()` / `previsualizar_cotizacion()` / `confirmar_cotizacion()` / `descartar_cotizacion()` | Carga diaria del dólar, vista previa y recálculo atómico (MSF-116) |
| `public.listar_cotizaciones(limite, cursor)` / `cotizacion_del_dia()` | Historial inmutable de cargas y «¿se cargó el dólar hoy?» (MSF-116) |
| `publico.crear_consulta_publica(host, origen, nombre, contacto, mensaje, producto_id)` | Alta pública de una consulta; la empresa sale del dominio de la tienda |
| `public.actualizar_consulta(...)` / `contar_consultas_nuevas(...)` / `responsables_consultas(...)` | Bandeja: edición con bloqueo optimista, contador y responsables |
| `public.guardar_correo_avisos_consultas(empresa_id, correo, updated_at)` | Dirección de avisos de consultas de la empresa |
| `public.leer_umbral_margen_bajo()` | Umbral de margen bajo de la organización (fracción; 0,10 por defecto) |
| `public.guardar_umbral_margen_bajo(p_umbral, p_updated_at)` | Guarda el umbral con bloqueo optimista; solo con edición en `rentabilidad` |
| `public.rentabilidad_conteo_margen()` | Productos con margen bajo, negativo y total con margen para el aviso del resumen |
| `public.iniciar_carga_migracion` / `previsualizar_lote_*` / `aplicar_lote_*` / `cerrar_carga_migracion` / `informe_conciliacion_migracion` | Importación inicial desde el panel anterior (MSF-142) |
| `public.listar_preferencias_aviso()` / `public.guardar_preferencia_aviso(tipo, activo)` | Avisos por correo: tipos visibles con la preferencia del usuario y guardado de la propia (MSF-189) |
| `public.solicitar_acceso(p_seccion)` | Registra el pedido de acceso del día (una fila por persona, sección y día) y devuelve si es nuevo y si el aviso ya salió (MSF-148) |
| `public.crear_estado_consulta(nombre)` / `renombrar_estado_consulta(id, nombre)` / `cambiar_estado_estado_consulta(id, activo)` | Listas configurables: alta, renombre y activar/desactivar estados de consulta (MSF-189) |
| `publico.tienda_por_dominio(host)` | Tienda pública por dominio; cero filas si el dominio no existe o la empresa está inactiva (MSF-147) |
| `publico.identidad_por_dominio(host)` | Identidad visual pública de la tienda (MSF-147) |
| `publico.contenido_por_dominio(host)` | Textos comerciales públicos de la tienda (MSF-147) |
| `publico.catalogo_visible_por_dominio(host)` | Categorías y productos efectivamente visibles (MSF-147) |
| `public.guardar_tienda_identidad(...)` / `public.guardar_tienda_contenido(...)` | Guardado de identidad y textos de la tienda (MSF-147) |
| `public.listar_catalogo_tienda(empresa)` / `public.guardar_catalogo_tienda(empresa, categorias, productos)` | Lectura y guardado de la visibilidad y los destacados (MSF-147) |
| `publico.categorias_por_dominio(host)` | Categorías visibles de la tienda del dominio (menú y pie) |
| `publico.catalogo_pagina_por_dominio(host, categoria, solo_con_stock, precio_max, orden, pagina)` | Página de 24 productos con filtros y orden; lista blanca de campos |
| `publico.producto_por_dominio(host, producto)` | Ficha pública de un producto visible; misma `null` si no existe o no se publica |
| `publico.imagen_publica(ruta)` | Booleano de respaldo de la política de lectura anónima de imágenes |

### Service técnico (MSF-182)

Fuente: `supabase/migrations/20261020*` (rama `epic/MSF-182-…`, aún sin merge a `main`). Las mutaciones de reparaciones son `security definer` con `search_path = ''` (la tabla no admite escritura directa); las de catálogos, `security invoker`. Todas: `revoke … from public, anon` y `grant execute … to authenticated`. Errores: `22023` validación (campo en `hint`), `42501` sin permiso, `40001` conflicto, `55000` anulada/cerrada, `P0002` inexistente.

### Stock único y alertas (MSF-231)

Fuente: `supabase/migrations/2026101818*` y `2026101819*` (rama `epic/MSF-231-…`, integrada al lote de
STG en `112250fd`, pendiente de promoción a `main`). No hay RPC nuevas para el panel: el listado sigue
leyendo `public.stock_estados` (MSF-136). Las funciones de la cola son internas y no las ejecuta la app.

| RPC / función | Para qué |
|---|---|
| `private.emitir_stock_actualizado()` | Disparador `AFTER INSERT` sobre `dominio.movimientos_stock`: encola `stock.actualizado` en `public.cola_eventos`, en la misma transacción e idempotente por movimiento. Sin ejecución para `public`, `anon` ni `authenticated`. |
| `private.reclamar_eventos(p_tipo, p_limite, p_duracion_reclamo_seg, p_max_intentos)` | Reclamo exclusivo con `for update skip locked`, lease de 1–3600 s y tope de intentos 1–20. Solo superusuario o `kestra_orquestacion`. |
| `private.resolver_evento(p_evento_id, p_intento, p_accion, p_motivo_sanitizado, p_demora_seg, p_max_intentos)` | `confirmar`, `liberar` (reintento con espera creciente) o `agotar`; rechaza un intento vencido o reemplazado (`RECLAMO_NO_VIGENTE`). Solo superusuario o `kestra_orquestacion`. |
| `private.reclamar_eventos_interno(…)` / `private.resolver_evento_interno(…)` | Misma lógica sin guarda de rol, para pgTAP. Sin ejecución para `public`, `anon`, `authenticated` ni `service_role`. |

`public.cola_eventos` tiene RLS: solo el Administrador de la organización lee; `authenticated` no tiene
escritura y `anon` no tiene privilegios. El contrato completo, Realtime y la reversión están en
[Stock único y alertas](stock-unico-y-alertas.md).

### Stock · lotes e inventario (MSF-131)

Fuente: `supabase/migrations/2026120210*` y `2026120213*` (rama `epic/MSF-131-…`, aún sin merge a `main`). Las RPC de escritura son `security definer` con `search_path = ''`; las de lectura, `security invoker` (rige la RLS). Todas: `revoke … from public, anon` y `grant execute … to authenticated`. Errores: `22023` validación (línea, contado, fecha, motivo o cursor) y `42501` sin `edicion` en Stock.

| RPC | Para qué |
|---|---|
| `public.registrar_lote_stock(p_lineas, p_motivo, p_proveedor, p_fecha, p_clave)` | Registra un remito completo: un lote y una entrada por línea, todo o nada e idempotente por clave |
| `public.listar_lotes_stock(p_limite, p_cursor)` | Historial de lotes, más reciente primero, keyset por número |
| `public.listar_movimientos_lote(p_lote)` | Movimientos de un lote con producto/SKU y saldo |
| `public.confirmar_toma_inventario(p_items, p_fecha)` | Un ajuste por producto con diferencia contra el stock del depósito por defecto; sin diferencia no hay movimiento |

`public.registrar_movimiento_stock` cambia de **7 a 8 parámetros** al ganar `p_lote uuid default null` al final. La migración `20261202100100` reemplaza la firma anterior para no dejar sobrecargas ambiguas en PostgREST; los llamadores existentes siguen válidos. Contratos completos en [Stock · lotes e inventario](stock-lotes-e-inventario.md).

### Stock · depósitos, traslados y reservas (MSF-292)

Fuente: `supabase/migrations/2026102312*` y `2026102313*` (rama `epic/MSF-292-…`, aún sin merge a `main`). Las RPC de
escritura son `security definer` con `search_path = ''`; las de lectura (vistas) son `security_invoker` y rigen por
RLS. Todas: `revoke … from public, anon` y `grant execute … to authenticated`. Errores: `22023` validación, `42501`
sin permiso, `23514` «No hay stock suficiente», `23505` duplicado.

| RPC / vista | Para qué |
|---|---|
| `public.crear_deposito(p_nombre, p_direccion, p_empresas)` | Crea un depósito (nombre único, dirección opcional, empresas que venden desde acá). Solo Administrador |
| `public.actualizar_deposito(p_deposito, p_nombre, p_direccion, p_empresas)` | Edita un depósito con el mismo formulario |
| `public.definir_deposito_por_defecto(p_deposito)` | Deja exactamente un depósito por defecto en la organización |
| `public.cambiar_activo_deposito(p_deposito, p_activo)` | Activa o desactiva; no se desactiva el por defecto ni uno con unidades |
| `public.registrar_movimiento_stock(p_producto, p_tipo, p_cantidad, p_motivo, p_nota, p_fecha, p_deposito)` | Movimiento sobre un depósito (sin `p_deposito`, usa el por defecto) |
| `public.trasladar_stock(p_producto, p_origen, p_destino, p_cantidad, p_nota, p_fecha)` | Traslada unidades entre dos depósitos: dos movimientos linked por `traslado_id`, el total no cambia |
| `public.reservar_stock(p_producto, p_deposito, p_cantidad, p_referencia)` | Reserva stock de un producto «A pedido»; idempotente por `p_referencia` |
| `public.liberar_reserva(p_reserva)` | Libera una reserva activa: baja el reservado, la cantidad no cambia |
| `public.descontar_reserva(p_reserva)` | Descuenta una reserva activa: baja cantidad y reservado y deja la salida en el libro |
| `public.stock_por_deposito` (vista) | Cantidad, reservado y disponible por producto y depósito |
| `public.depositos_listado` (vista) | Depósitos con «Venden desde acá», productos con stock y unidades |

Cambios de contrato de esta épica (alto riesgo): `registrar_movimiento_stock` pasa de 6 a 7 parámetros,
`listar_movimientos_stock` y `stock_estados` cambian su tipo de retorno, la carga de `stock.actualizado` suma
`deposito_id`, `reservado` y `disponible`, y `tipo_movimiento` admite `reserva` y `liberacion`. Contratos completos en
[Stock · depósitos y reservas](stock-depositos-y-reservas.md).

### Stock · carga inicial, exportación y avisos (MSF-368)

Fuente: `supabase/migrations/2026121214*` y `2026121310*` (rama `epic/MSF-368-…`, aún sin merge a `main`). Las RPC de
escritura para la app son `security definer` con `search_path = ''`; las de las colas de correo son **solo
`service_role`** (`revoke … from public, anon, authenticated`). Errores: `42501` sin permiso, `22023` validación.

| RPC / vista | Devuelve / hace | Seguridad |
|---|---|---|
| `public.validar_carga_stock(p_deposito uuid, p_filas jsonb)` | Vista previa de la carga por planilla (no escribe): `fila, sku, producto, stock_actual, en_planilla, quedara, diferencia, estado, mensaje` | `security definer`, `stable`; exige `edicion` en Stock |
| `public.aplicar_carga_inicial_stock(p_deposito uuid, p_filas jsonb, p_clave uuid default gen_random_uuid())` | Aplica solo las filas válidas: un movimiento `ajuste` por diferencia y una fila en `cargas_iniciales_stock`; devuelve `aplicadas, omitidas, repetido, detalle` | `security definer`; idempotente por `p_clave`; una sola carga inicial por producto |
| `public.faltantes_listado` (vista) | Una fila por línea «A pedido» de factura confirmada con reserva activa, con tienda, cliente, producto, comprobante, estado de stock y si ya se avisó | `security_invoker`; solo tiendas con `ventas` visible |
| `public.avisar_faltantes(p_lineas uuid[])` | Encola el aviso (uno por línea, un correo por cliente); devuelve `encolados, lineas_avisadas, omitidos_ya_avisados, omitidos_sin_stock, omitidos_sin_correo, omitidos_sin_permiso` | `security definer`; exige `stock` en `lectura`/`edicion` y `ventas` en `edicion` en la tienda; 1–200 líneas |
| `public.productos_mas_vendidos(p_desde date, p_hasta date, p_empresa_id uuid, p_pagina int, p_tamano int)` | `{ posicion, producto_id, nombre, sku, unidades, total_filas }`; solo comprobantes que cuentan como facturados, del período y de las tiendas visibles; rango máximo de 5 años | `security definer`; exige `stock` en `lectura`/`edicion` |
| `public.generar_resumen_reposicion(p_organizacion uuid, p_tope int default 5)` | Arma y reserva el resumen de reposición: `resumen_id, sin_stock, stock_bajo, productos, destinatarios` | Solo `service_role` |
| `public.cerrar_resumen_reposicion(p_resumen uuid, p_enviado boolean, p_error text)` | Cierra el resumen y, solo si se entregó, marca los productos como avisados | Solo `service_role` |
| `public.organizaciones_con_resumen_pendiente()` | Organizaciones a procesar en el barrido | Solo `service_role` |
| `public.faltantes_avisos_pendientes(p_tope int, p_limite int)` | Clientes con avisos pendientes | Solo `service_role` |
| `public.tomar_aviso_faltante(p_cliente uuid, p_tope int default 5)` | Toma los avisos de un cliente y los reserva 2 minutos | Solo `service_role` |
| `public.cerrar_aviso_faltante(p_cliente uuid, p_enviado boolean, p_error text, p_tope int)` | Cierra el aviso como `enviado` o lo deja `pendiente`/`agotado` | Solo `service_role` |

La **exportación a CSV** (F-STK-08) **no agrega RPC, tablas ni permisos**: lee `stock_estados` y
`listar_movimientos_stock`, las mismas fuentes y la misma RLS que la pantalla. Contratos completos en
[Stock · carga inicial, exportación y avisos](stock-carga-exportacion-y-avisos.md).

### Service técnico: listado, ítems e impresión (MSF-199)

Fuente: `supabase/migrations/20261022100100`–`20261022110200` (rama `epic/MSF-199-…`, aún sin merge a
`main`). Contrato completo, modelo y límites: [Service técnico: listado, ítems e
impresión](service-listado-items-impresion.md).

| RPC | Devuelve / hace | Seguridad |
|---|---|---|
| `public.listar_reparaciones(p_empresa uuid, p_periodo text, p_serie text, p_tecnico uuid, p_pagina int, p_tamano int)` | `{ total_filas, filas[] }`; período `hoy|semana|mes` sobre la entrega prevista; la serie ignora el período; página 1–200 filas (25 por defecto); sin costos internos | `security definer` (desvío: reaplica a mano organización, `lectura`+ y `empresas_accesibles()`); `42501` sin permiso, `22023` período inválido |
| `public.agregar_item_reparacion(p_reparacion_id, p_tipo, p_descripcion, p_producto_id, p_cantidad, p_precio)` | Inserta un ítem, recalcula totales y devuelve la reparación con `items` | `security definer`; exige `edicion`; `22023` con campo en `hint`, `42501`, `P0002`, `55000` si está entregada/anulada; **no mueve stock** (desde MSF-217 sí lo hace: ver la sección siguiente) |
| `public.quitar_item_reparacion(p_item_id)` | Quita un ítem, recalcula totales y devuelve la reparación | `security definer`; mismas reglas que agregar |
| `public.obtener_reparacion(id)` | Agrega `items`, `total_mano_obra`, `total_repuestos`, `total_cliente` y `ganancia_estimada` (`null` sin `ver_costos`) | Contrato aditivo; las claves anteriores no cambian |

Todas hacen `revoke … from public, anon` y `grant execute … to authenticated`; fijan `search_path = ''`.

### Service técnico: repuestos y stock (MSF-217)

Fuente: `supabase/migrations/20270114100100`–`20270114140200` (rama `epic/MSF-217-…`, aún sin merge a `main`).
Contrato completo, modelo, libro y reversión: [Service técnico: repuestos y
stock](service-repuestos-y-stock.md).

| RPC | Devuelve / hace | Seguridad |
|---|---|---|
| `public.depositos_para_repuesto(p_producto_id uuid)` | `jsonb` con los depósitos **activos** y, por cada uno, `cantidad`, `reservado` y `disponible`; el por defecto primero | `security definer`; exige `service_tecnico` en `lectura`/`edicion` (**no** Stock); `42501` sin permiso, `P0002` producto inexistente o ajeno |
| `public.agregar_item_reparacion(p_reparacion_id, p_tipo, p_descripcion, p_producto_id, p_cantidad, p_precio, p_deposito_id uuid default null, p_dejar_pendiente boolean default false)` | Inserta el ítem, **descuenta del depósito elegido** y recalcula totales **en la misma transacción**; con `p_dejar_pendiente` y sin stock carga el ítem `pendiente` sin movimiento | `security definer`; exige `edicion`; `23514` «No hay stock suficiente» (sin ítem, movimiento ni cambio de totales), `22023` con campo en `hint` (por ejemplo `deposito_id`), `42501`, `P0002`, `55000`; **reemplaza** las firmas de 6 y 7 parámetros |
| `public.quitar_item_reparacion(p_item_id)` | Si el ítem estaba `descontado`, **devuelve** las unidades al depósito original, lo borra y recalcula totales en la misma transacción | `security definer`; mismas reglas que agregar; `P0002` si el ítem ya no existe (idempotencia) |
| `public.anular_reparacion(p_id uuid, p_motivo text, p_consumidos uuid[] default '{}')` | Anula con motivo y **devuelve** al depósito cada repuesto `descontado` no consumido (`devuelto`); los consumidos quedan `consumido` | `security definer`; exige `edicion`; `22023` hint `consumidos` si un id no es un repuesto `descontado` de esa reparación; **reemplaza** la firma de 2 parámetros |
| `public.listar_reparaciones(p_empresa uuid, p_periodo text, p_serie text, p_tecnico uuid, p_pagina int, p_tamano int)` | Igual que MSF-199 y suma `pendientes_stock` por fila (repuestos `pendiente` de reparaciones no anuladas ni entregadas) | `security definer`; firma sin cambios |
| `public.obtener_reparacion(id)` | Suma por ítem `deposito_id`, `deposito_nombre` y `stock_estado` | Contrato aditivo; las claves anteriores no cambian |

Además, **sin `grant` a `authenticated`** (solo las llaman las RPC): `private.mover_stock_reparacion` (salida o
entrada al depósito, con `referencia` única e idempotencia) y `private.devolver_stock_item_reparacion` (devuelve un
ítem `descontado` y lo marca `devuelto`).

### Service técnico: cobro, avisos y ficha del cliente (MSF-232)

Fuente: `supabase/migrations/20270115010000`–`20270115030000` (rama `epic/MSF-232-…`, aún sin merge a `main`).
Contrato completo, modelo, flow de correo y reversión: [Service técnico: cobro, avisos y ficha del cliente
(técnico)](service-cobro-y-avisos.md).

| RPC | Devuelve / hace | Seguridad |
|---|---|---|
| `public.generar_comprobante_reparacion(p_reparacion uuid)` | `{ comprobante_id, creado }`: crea la **factura en `borrador`** de la reparación (tienda y cliente de la reparación, `origen_tipo = 'reparacion'`, una línea por ítem marcada `sin_stock`) o devuelve el comprobante vigente | `security definer`; exige `service_tecnico` en `edicion` **y** `ventas` en `edicion` en la tienda; `42501`, `P0002`, `55000` anulada, `22023` sin ítems / tienda desactivada / cliente archivado |
| `public.comprobante_de_reparacion(p_reparacion uuid)` | `{ id, numero, tipo, estado, total, empresa_id, empresa }` del comprobante vigente o `null` | `security definer`; exige `service_tecnico` en `lectura`/`edicion` y tienda accesible; `42501`, `P0002` |
| `public.avisar_cliente_reparacion(p_reparacion uuid, p_estado_id uuid default null)` | `{ resultado: 'encolado' \| 'sin_correo', aviso_id }`: en una transacción crea el aviso `pendiente` del estado pedido (por defecto el actual) con el correo actual del cliente y deja la orden `enviar-aviso-reparacion-<aviso>` en la outbox | `security definer`; exige `service_tecnico` en `edicion` y tienda accesible; `42501`, `P0002`, `55000` anulada, `22023` estado inexistente, `P0001` (hint `sin_conexion`) |
| `public.avisos_de_reparacion(p_reparacion uuid)` | Historial (más reciente primero): estado avisado, destinatario, resultado, motivo, fechas y **nombre visible** de quien lo pidió (nunca su correo) | `security definer`; exige `service_tecnico` en `lectura`/`edicion` y tienda accesible; `42501`, `P0002` |
| `public.reparaciones_de_cliente(p_cliente uuid, p_empresa uuid default null, p_pagina int default 1, p_tamano int default 25)` | `{ total_filas, filas[] }`: número `R-0238`, tienda, equipo, modelo, estado, ingreso, entrega prevista y total; **sin costos internos** | `security definer`; exige `service_tecnico` en `lectura`/`edicion` y tiendas accesibles; `42501` |

Además, **sin `grant` a `authenticated`** (solo el rol de servicio `kestra_orquestacion`): `private.datos_aviso_reparacion(uuid)`,
`private.cerrar_aviso_reparacion(uuid, text)` y `private.aplicar_cierre_aviso_reparacion(uuid, text)`; y
`private.expirar_avisos_reparacion(uuid)`, que cierra como fallidos los avisos pendientes que ya no pueden completarse.

`public.obtener_comprobante` (Ventas) suma `origen_tipo` y `origen_id` (contrato aditivo) y devuelve `origen_numero`
(«R-000N») solo con `service_tecnico` en lectura o más.

### Ingreso de mercadería por proveedor (MSF-219)

Fuente: `supabase/migrations/20261021180000`–`20261021180300` (rama `epic/MSF-219-…`, aún sin merge a
`main`). Contrato completo, modelo, permisos y reversión: [Ingreso de mercadería](ingreso-de-mercaderia.md).

| RPC | Devuelve / hace | Seguridad |
|---|---|---|
| `public.registrar_ingreso_mercaderia(p_empresa uuid, p_proveedor uuid, p_fecha date, p_comprobante text, p_lineas jsonb, p_actualizar_costo boolean, p_clave_idempotencia uuid)` | Cabecera del ingreso; por cada línea mueve stock con `registrar_movimiento_stock` (`entrada`, motivo «Compra a proveedor»); opcionalmente actualiza `producto_costos`; evento `ingreso.registrado` | `security definer`, `search_path = ''`; exige `stock` en `edicion`; el costo exige `rentabilidad` en `edicion`; idempotencia por organización; `42501`, `22023`, `23505`, `23514` (stock de la RPC de Stock) |
| `public.anular_ingreso_mercaderia(p_ingreso uuid, p_motivo text)` | Marca la cabecera `anulado` y crea una `salida` por línea con el motivo «Anulación de ingreso de mercadería»; evento `ingreso.anulado` | `security definer`, `search_path = ''`; exige `stock` en `edicion`; motivo 3–500; `for update`; todo o nada; `42501`, `22023`, `23514` si falta stock |
| `public.listar_ingresos_mercaderia(p_desde date, p_hasta date, p_proveedor uuid, p_empresa uuid, p_producto uuid, p_operador uuid, p_pagina integer, p_tamano integer)` | Una fila por producto con fecha, producto/SKU, cantidad, costo, destino, empresa, proveedor, operador, estado, motivo de anulación y `total`; orden por `creado_en desc`; 25 por defecto, tope 100 | `security invoker` (RLS de `stock` en `lectura`/`edicion`); `revoke` a `public, anon` |
| `public.detalle_ingreso_mercaderia(p_ingreso uuid)` | `jsonb` con cabecera, líneas y movimientos vinculados, o `null` si no existe o es de otra organización | `security invoker` |
| `public.operadores_ingresos_mercaderia()` | `(actor_id, actor_nombre)` distintos para el filtro Operador | `security invoker` |

### Proveedores (MSF-205)

Fuente: `supabase/migrations/20261018190001`–`20261018190700` (rama `epic/MSF-205-…`, aún sin merge a
`main`). Contrato completo, modelo, CUIT, vista y reversión: [Proveedores](proveedores.md).

| RPC | Devuelve / hace | Seguridad |
|---|---|---|
| `public.crear_proveedor(p_razon_social, p_cuit, p_persona_contacto, p_correo, p_telefono, p_direccion, p_observaciones)` | Alta con CUIT validado; devuelve la fila | `security invoker` (RLS); exige `edicion` en `proveedores`; `23505` CUIT repetido, `22023`/`23514` dato inválido |
| `public.actualizar_proveedor(p_id, p_actualizado_en, …)` | Edición con bloqueo optimista por `updated_at`; devuelve la fila | `security invoker`; `40001` conflicto, `P0002` inexistente/ajeno, `42501` sin permiso |
| `public.cambiar_estado_proveedor(p_id, p_activo)` | Desactiva o reactiva; idempotente | `security invoker`; no existe borrado |
| `public.listar_proveedores(p_busqueda, p_estado, p_pagina, p_tamano)` | Filas con `total_filas`; busca por razón social (sin mayúsculas ni tildes) o CUIT con/sin guiones; 25 por página, tope 200 | `security invoker` (RLS); `22023` estado inválido |
| `public.productos_de_proveedor(p_proveedor_id, p_pagina, p_tamano)` | Productos del proveedor (nombre, código del proveedor, estado) y `total_filas`; 10 por página, tope 100 | `security invoker`; exige `proveedores` y `productos`; `42501` si falta alguno |

Además, `crear_producto` y `actualizar_producto` suman `p_proveedor_id` y `p_codigo_proveedor`
(`actualizar_producto` suma `p_cambiar_proveedor`, default `false`): es un **cambio de contrato** con
reversión documentada, no una sobrecarga. La vista `public.proveedores_basico` (`id`, `razon_social`,
`activo`) es `security_invoker = false` a propósito y filtra por organización y nivel; `anon` no tiene
acceso.

### Catálogo: costo y disponibilidad (MSF-179)

Fuente: `supabase/migrations/20261022120900_catalogo_disponibilidad.sql` y
`20261022121000_catalogo_listado_codigo_barras.sql` (rama `epic/MSF-179-…`, aún sin merge a `main`).
Contrato completo, modelo, derivación y reversión: [Catálogo: costo y disponibilidad](catalogo-costo-y-disponibilidad.md).

| RPC | Devuelve / hace | Seguridad |
|---|---|---|
| `private.disponibilidad_producto(p_producto_id uuid)` | La etiqueta de disponibilidad: `a_pedido` \| `stock_entrante` (elección manual) o `stock` \| `sin_stock` (derivada de `dominio.existencias.cantidad`); `null` si el producto no existe, es de otra organización o no hay lectura en `productos` | `security definer`, `search_path = ''`, `stable`; solo la etiqueta, nunca cantidades; `revoke` a `public, anon`; `grant` a `authenticated` |
| `private.productos_con_stock()` | Ids de los productos de la organización con disponible > 0 (versión por lotes de la anterior, que usa la vista) | `security definer`, `search_path = ''`, `stable`; `revoke` a `public, anon`; `grant` a `authenticated` |

Cambios de contrato en las RPC del producto (alto riesgo; los llamadores anteriores siguen funcionando porque
los parámetros nuevos son opcionales y van al final):

| RPC | Parámetros nuevos | Seguridad |
|---|---|---|
| `public.crear_producto(…, p_codigo_barras text, p_disponibilidad_manual text)` | `p_disponibilidad_manual` (11.º, default `null`): `a_pedido` \| `stock_entrante`; otro valor se rechaza con `22023` | `security invoker` (RLS); exige `edicion` en `productos`; el costo exige `edicion` en `rentabilidad`; `revoke` a `public, anon`; `grant` a `authenticated` |
| `public.actualizar_producto(…, p_codigo_barras text, p_cambiar_codigo_barras boolean, p_disponibilidad_manual text, p_cambiar_disponibilidad boolean)` | `p_disponibilidad_manual` (15.º, default `null`) y `p_cambiar_disponibilidad` (16.º, default `false`): la disponibilidad solo cambia con `p_cambiar_disponibilidad = true`; `null` quita la elección y vuelve a la derivada | `security invoker`; exige `edicion` en `productos`; `40001` conflicto por `updated_at`, `P0002` inexistente/ajeno, `42501` sin permiso |

La vista `public.v_productos_listado` suma `disponibilidad` y `codigo_barras` **al final** de su contrato
(`create or replace`, `security_invoker = true`, sin costo, sin `anon`).

### Clientes (MSF-180)

Fuente: `supabase/migrations/20261016130000`–`20261016160000` (ya integradas en `main`; el «Expreso
preferido» llegó después, en `20261017120001`, fuera de MSF-180). Contrato completo, modelo, RLS y
reversión: [Clientes: modelo, RPC y pantallas](clientes.md).

| RPC | Devuelve / hace | Seguridad |
|---|---|---|
| `public.buscar_clientes(p_texto text, p_tipo text, p_archivados boolean, p_pagina integer, p_tamano integer)` | Listado paginado con total: `id`, `numero`, `nombre`, `documento`, `correo`, `telefono`, `celular`, `localidad`, `expreso_preferido`, `tipo`, `es_consumidor_final`, `archivado_en`, `total`; coincidencia parcial sin distinguir mayúsculas en nombre, documento, correo, teléfono, celular, localidad y número; escapa `\`, `%` y `_`; filtra por tipo y por activos/archivados; ordena por `lower(nombre), id`; 25 por página, tope 100 | `security invoker` (hereda RLS de organización y sección); `search_path = ''`; `revoke` a `public, anon`; `grant` a `authenticated` |
| `public.exportar_clientes(p_texto text, p_tipo text, p_archivados boolean, p_despues_de uuid, p_limite integer)` | Las mismas filas que la búsqueda, en lotes por keyset `(lower(nombre), id)`: `id`, `numero`, `nombre`, `documento`, `tipo`, `correo`, `telefono`, `celular`, `direccion`, `codigo_postal`, `localidad`, `provincia`, `expreso_preferido`, `archivado_en`, `total`; el total se cuenta solo en el primer lote; tope de lote 1000 y tope total 50.000 filas | `security definer`, `search_path = ''`; exige `private.puede_accion('clientes','exportar')`; organización de `private.organizacion_id()`, nunca de un parámetro; `42501` sin permiso, `54000` supera el tope, `40001` el cursor ya no existe |
| `public.escala_de_cliente(p_cliente_id uuid)` | Escala de precios del cliente: `x1` (minorista) o `por_cantidad` (mayorista); `null` si no existe o no es visible | `security invoker` (hereda RLS); `stable`; `revoke` a `public, anon`; `grant` a `authenticated` |

Además:

- **Alta, edición, archivado y restauración** no usan RPC: el panel escribe directo en `public.clientes`
  (PostgREST) y la base aplica `private.nivel_seccion('clientes')`, los grants por columna y los
  disparadores. El **número correlativo** lo asigna `private.asignar_numero_cliente()`; el **DNI/CUIT
  único por organización** lo impone el índice `clientes_org_documento_uq` (`23505`).
- **No hay borrado**: no existe política ni grant `DELETE` para nadie; la baja lógica es `archivado_en`.
- **`anon`** no ejecuta ninguna de las tres RPC ni tiene privilegios sobre la tabla.

### Consultas (MSF-122)

Fuente: `supabase/migrations/20261205100100`–`20261205200200` (rama `epic/MSF-122-…`, aún sin merge a
`main`). La única RPC pública es `publico.crear_consulta_publica(host text, origen text, nombre text,
contacto text, mensaje text default null, producto_id uuid default null) returns uuid`, ejecutable por
`anon` y `authenticated`; resuelve la empresa **solo por el host** y devuelve `P0002` genérico para dominio
desconocido o empresa desactivada (antes de validar datos) y `22023` para datos inválidos. Las RPC del
panel son `security definer` con `search_path = ''`, `revoke … from public, anon` y `grant execute … to
authenticated`: `actualizar_consulta` (bloqueo optimista `40001`, permiso `42501`), `contar_consultas_nuevas`,
`responsables_consultas` y `guardar_correo_avisos_consultas`. La vista `public.consultas_bandeja` es
`security_invoker`. Las RPC del aviso (`avisos_consulta_pendientes`, `tomar_aviso_consulta`,
`cerrar_aviso_consulta`) son solo de `service_role`. Contrato y operación: [Consultas](consultas.md).

### Rentabilidad (MSF-120)

Fuente: `supabase/migrations/20261130100000_rentabilidad_umbral.sql` y
`20261130110100_rentabilidad_conteo_margen.sql` (rama `epic/MSF-120-…`, aún sin merge a `main`).

- `public.leer_umbral_margen_bajo() returns numeric` y
  `public.guardar_umbral_margen_bajo(p_umbral numeric, p_updated_at timestamptz default null) returns timestamptz`
  son `security invoker` con `set search_path = ''`, `revoke … from public, anon` y `grant execute … to
  authenticated`. Exigen `rentabilidad` ≥ lectura (leer) o edición (guardar); errores `42501` (sin permiso),
  `23514` (fuera de rango: 0 < umbral ≤ 1, hasta 2 decimales en %) y `40001` (conflicto de edición). Guardar
  el mismo valor es idempotente y no emite evento.
- `public.rentabilidad_conteo_margen()` es `security definer` (excepción justificada: las vistas de
  `analitica` están cerradas a `authenticated`); valida organización y sección adentro y devuelve
  `con_margen_bajo`, `con_margen_negativo` y `productos_con_margen`.
- `public.resolver_organizacion_reporte(reporte_id)` mantiene la firma de la spec 007 y suma la regla de
  `reportes.seccion`; `emitir-acceso-reporte` responde 403 sin emitir token cuando no hay sección.
- Las vistas del contrato (`analitica.margen_producto_canal`, `rentabilidad_resumen_empresa` y
  `rentabilidad_consolidado`) no son RPC: las consume Superset con el rol `superset_analitica`. Contrato y
  detalle: [Rentabilidad](rentabilidad.md).
### Migración inicial de datos (MSF-142)

Fuente: `supabase/migrations/20261201100000_migracion_cargas.sql`,
`20261201110000_proveedores_id_externo.sql`, `20261201120000_archivo_ingresos_mercaderia.sql` y
`20261201130000_migracion_conciliacion.sql` (rama de la épica, aún sin merge a `main`). Todas son
`security definer`, `set search_path = ''`, toman la organización de `private.organizacion_id()`,
exigen Administrador (`42501`) y llevan `revoke … from public, anon` y `grant execute … to
authenticated`. El lote máximo es de 500 filas (`54000`); una carga ajena o inexistente responde
`P0002` y los datos inválidos `22023`.

- `iniciar_carga_migracion(p_entidad text, p_archivo text, p_filas_total integer) returns uuid`.
- `previsualizar_lote_clientes|proveedores|vinculos_proveedor_producto|archivo_ingresos(p_filas jsonb)
  returns jsonb`: clasifica sin escribir (`nueva` / `actualizada` / `error` + motivo).
- `aplicar_lote_clientes|proveedores|vinculos_proveedor_producto|archivo_ingresos(p_carga uuid,
  p_lote integer, p_filas jsonb) returns jsonb`: upsert atómico por identificador externo;
  devuelve `{ nuevos, actualizados, omitidos, errores }`.
- `cerrar_carga_migracion(p_carga uuid) returns jsonb`: cuenta desde `migracion_filas`, marca
  `aplicada` o `fallida` y devuelve el informe; repetible.
- `informe_conciliacion_migracion(p_carga uuid) returns jsonb` (`stable`): solo lee y devuelve origen,
  cargado, diferencia, verificación del destino, `conciliado` y hasta 200 errores.

Contrato CSV, tablas y operación: [Migración inicial de datos](migracion-inicial-de-datos.md).

### Ventas catálogos de cobro y envío (MSF-139)

Fuente: `supabase/migrations/20261020100000_formas_pago.sql`, `20261022120000_formas_pago_rpc.sql`,
`20261022120100_formas_envio.sql`, `20261022120200_formas_envio_rpc.sql`,
`20261022120300_cuentas_cobro.sql` … `20261022120600_cuentas_cobro_actividad.sql`,
`20261022120700_transportes.sql` y `20261022120800_transportes_rpc.sql` (rama
`epic/MSF-139-…`, aún sin merge a `main`). Las RPC son `security invoker` con `search_path = ''`,
`revoke … from public, anon` y `grant execute … to authenticated`; la organización sale de la sesión y
la escritura exige Administrador en la RLS y en el cuerpo de cada RPC. `private.cbu_valido` y los
disparadores de normalización son `security definer` sin grant. Errores: `42501` permiso · `22023`/
`23514` validación · `P0002` inexistente · `40001` conflicto · `23505` nombre repetido.

| RPC | Contrato |
|---|---|
| `crear_forma_pago(empresa_ids, …)` / `actualizar_forma_pago(id, actualizado_en, …)` / `cambiar_estado_forma_pago(id, activo)` | Alta multiempresa atómica (un ítem por empresa), edición con bloqueo optimista y estado idempotente. Sin DELETE. |
| `crear_forma_envio(empresa_ids, …)` / `actualizar_forma_envio(id, actualizado_en, …)` / `cambiar_estado_forma_envio(id, activo)` | Ídem, con costo por defecto opcional `0 ≤ costo < 10.000.000.000`. |
| `crear_cuenta_cobro(…, empresa_ids)` / `actualizar_cuenta_cobro(id, actualizado_en, …)` / `cambiar_estado_cuenta_cobro(id, activa)` | CBU/CVU (22 dígitos con verificadores) y CUIT validados; «No usar» idempotente; habilitación por empresa en la misma transacción. |
| `listar_cuentas_cobro(empresa, estado, pagina, tamano)` | Listado paginado en servidor (`todas \| activas \| no_usar`) con `empresas` y `total_filas`. |
| `crear_transporte(…, empresa_ids)` / `actualizar_transporte(id, actualizado_en, …)` / `cambiar_estado_transporte(id, activa)` | CUIT opcional validado, comisión 0–100 y plazo 0–3650; edición con bloqueo optimista. |
| `listar_transportes(empresa, pagina, tamano)` | Listado paginado con `empresas`, `total_filas` (N) y `total_organizacion` (M). |

Contrato completo: [Ventas · catálogos de cobro y envío (técnico)](ventas-catalogos.md#rpc). Modelo:
[Datos · Ventas catálogos](datos.md#ventas-catalogos-de-cobro-y-envio-msf-139).

### Ventas comprobantes (MSF-159)

Fuente: `supabase/migrations/20261203100400_comprobantes_rpc.sql`, `20261203200300_lineas_rpc.sql`,
`20261203200400_disponible_para_venta.sql`, `20261204140000_confirmar_comprobante.sql` y
`20261204150000`–`20261204150200` (rama `epic/MSF-159-…`, aún sin merge a `main`). Todas son
`security definer` con `search_path = ''`, `revoke … from public, anon` y `grant execute … to authenticated`;
organización y actor salen de la sesión y el nivel de `ventas` se evalúa en la **empresa del comprobante**.

| RPC | Contrato |
|---|---|
| `crear_comprobante(...)` / `guardar_comprobante(...)` | Alta y edición de cabecera con numeración correlativa y bloqueo optimista (`40001`). |
| `obtener_comprobante(id)` | Cabecera, cliente, operador, líneas con depósito/stock/reservado, totales y `puede_editar_precio`. |
| `guardar_lineas_comprobante(id, lineas, actualizado_en)` | Reemplazo transaccional de líneas; precio y escala con `private.precio_para`; `precio_manual` exige `editar_precio`. |
| `disponible_para_venta(producto, deposito)` | Existencias del depósito − reservado; `null` si producto o depósito no son de la organización. |
| `confirmar_comprobante(id)` | Factura `borrador` → `confirmada`; salida por depósito o reserva «A pedido»; todo o nada e idempotente. |
| `aceptar_presupuesto(id)` / `copiar_presupuesto(id)` | `pendiente` → `aceptado` y copia con número nuevo; no tocan stock. |
| `listar_presupuestos(...)` | Listado paginado con búsqueda, filtros, `vencido` derivado y `puede_editar`. |

Errores: `42501` permiso · `22023` validación (`hint` = campo) · `P0002` inexistente · `55000` documento
cerrado · `40001` conflicto · `P0001` con `hint = 'stock'` por faltante al confirmar. Contrato completo:
[Ventas · comprobantes (técnico)](ventas-comprobantes.md#rpc).
### Ventas listado, estados y anulación (MSF-177)

Fuente: `supabase/migrations/20261212100500`–`20261212120600` (rama `epic/MSF-177-…`, aún sin merge a
`main`). Todas en `public`, con `set search_path = ''`, `revoke execute … from public, anon` y `grant execute
… to authenticated`; organización y actor salen de la sesión y el nivel de `ventas` se evalúa en la **empresa
del comprobante**.

| RPC | Contrato | Seguridad |
|---|---|---|
| `listar_comprobantes(busqueda, estado, pago, envio, operador, empresa, pagina, tamano)` | Página de `factura` y `nota_credito` con `filas` (total del filtro); búsqueda por cliente o número sin tildes ni mayúsculas; total con signo. | `security invoker` |
| `operadores_de_comprobantes(empresa)` | Opciones del filtro Operador. | `security invoker` |
| `exportar_comprobantes(tipo, …)` | Todas las filas del filtro hasta 10.000; `tipo` ∈ `comprobantes` \| `presupuestos`; exige la acción `exportar`. | `security invoker` |
| `solicitar_exportacion_comprobantes(tipo, filtros)` | Registra la exportación diferida (más de 10.000 filas) y devuelve el id de la ejecución; idempotente; una simultánea por usuario falla con `YA_EN_CURSO`. | `security definer` |
| `archivo_exportacion_comprobantes(ejecucion_id)` | `(estado, archivo)`: la ruta del CSV solo si la ejecución terminó `exitosa`; solo el solicitante. | `security definer` |
| `cambiar_estado_comprobante(id, estado, actualizado_en)` | Estado de una factura si la transición existe para el rol del actor en la empresa del comprobante; idempotente; rechaza `borrador`/`anulada`, presupuestos y `cobrado`/`deuda`. | `security definer` |
| `transiciones_permitidas_comprobante(id)` | `text[]` con los estados permitidos al rol de la sesión (informativa). | `security definer` |
| `historial_comprobante(id)` | `(cuando, accion, quien, empresa_id, empresa)` de los eventos del comprobante, más recientes primero. | `security definer` |
| `anular_comprobante(id, motivo, actualizado_en)` | Anula una factura confirmada: `anulada`, `anulado_en/por`, motivo; revierte stock y libera reservas; todo o nada e idempotente; no reutiliza el número. | `security definer`; exige `ventas` en edición y la acción `anular` en la empresa |
| `emitir_nota_credito(factura_id, tipo, lineas, concepto)` | Nota de crédito asociada: `tipo` ∈ `devolucion_productos` \| `devolucion_importe` \| `descuento`; no excede lo acreditable; numeración propia. | `security definer`; exige `ventas` en edición y la acción `emitir_nota_credito` en la empresa |
| `detalle_anulacion_nota_credito(id)` | `jsonb` de lectura: qué puede hacer el rol, la anulación, lo acreditable y las notas asociadas. | `security definer` |

`private.marcar_estado_cobro_comprobante(id, estado)` (Cobrado/Deuda, actor `sistema`) **no** tiene grant a
`authenticated`: es el punto de entrada de MSF-195 (lo dispara `private.registrar_cobro_interno`).
`private.revertir_venta_comprobante`, `private.devolver_stock_nota_credito` y
`private.datos_exportacion_comprobantes` / `private.filas_exportacion_comprobantes` tampoco (las dos
últimas, solo para `workers_orquestacion`).

Errores: `42501` permiso · `22023` dato inválido (`hint` = campo) · `P0002` inexistente o ajeno · `55000`
estado no válido · `40001` conflicto de edición · `P0001` con `hint = 'tope'` (excede lo acreditable) y
`P0001` con `hint = 'stock'`. Contrato completo:
[Ventas · listado, estados y anulación (técnico)](ventas-listado-estados-y-anulacion.md#rpc).

### Ventas cobros y conciliación (MSF-195)

Fuente: `supabase/migrations/20261215100000`–`20261217100200` (rama `epic/MSF-195-…`, aún sin merge a
`main`). Todas en `public`, con `set search_path = ''`, `revoke execute … from public, anon` y `grant execute
… to authenticated`; organización y actor salen de la sesión y el nivel de `ventas` se evalúa en la
**empresa del dato** (comprobante, pago o contrarreembolso), no en la empresa activa.

| RPC | Contrato | Seguridad |
|---|---|---|
| `registrar_cobro(comprobante_id, importe, forma_pago_id, cuenta_cobro_id, actualizado_en)` | Registra un cobro: solo factura confirmada no anulada; importe > 0, dos decimales y ≤ saldo; cuenta exigida por la forma, activa y habilitada en la empresa. Devuelve la fila. | `security definer`; exige `ventas` en edición y la acción `registrar_cobro` |
| `saldo_comprobante(id)` | `(total, cobrado, saldo)` del comprobante. | `security invoker` |
| `cobros_de_comprobante(comprobante_id)` | Los cobros de la factura, con el tipo de la forma de pago y el banco/titular de la cuenta. | `security invoker` |
| `puede_registrar_cobro(empresa_id)` | `boolean`: permiso propio para mostrar el botón. No autoriza. | `security definer` |
| `conciliar_pago(id, actualizado_en)` | Aprueba un pago **con cuenta de cobro**; idempotente, con bloqueo optimista; no toca el estado del comprobante. | `security definer`; exige `ventas` en edición y la acción `conciliar_pago` |
| `revertir_conciliacion_pago(id, actualizado_en)` | Ídem, quita la aprobación. | `security definer`; exige `ventas` en edición y la acción `conciliar_pago` |
| `listar_pagos(empresa_id, cuenta_cobro_id, solo_con_saldo, pagina, tamano)` | Página de cobros con cuenta de cobro con `filas` (total del filtro); tope 200 por página. | `security invoker` |
| `resumen_pagos(empresa_id)` | `(por_conciliar_importe, por_conciliar_cantidad, conciliado_importe, conciliado_cantidad, saldo_pendiente)`. | `security invoker` |
| `cuentas_cobro_mas_usadas(empresa_id, limite)` | `(id, nombre, banco, activa, usos, total_cuentas)` para la tarjeta de cuentas. | `security invoker` |
| `puede_conciliar_pago(empresa_id)` | `boolean`: permiso propio para habilitar el interruptor. No autoriza. | `security definer` |
| `marcar_contrarreembolso_cobrado(id, actualizado_en)` | Pasa el contrarreembolso a `cobrado` y registra el cobro del comprobante con origen `contrarreembolso`; idempotente; rechaza comprobante anulado. Devuelve la **fila de la tabla**. | `security definer`; exige `ventas` en edición y la acción `cobrar_contrarreembolso` |
| `listar_contrarreembolsos(empresa_id, estado, pagina, tamano)` | Página de contrarreembolsos con `filas`; `estado` ∈ (`pendiente`, `cobrado`); `tamano` acotado a 100. | `security invoker` |
| `resumen_contrarreembolsos(empresa_id)` | `(pendiente_importe, pendiente_cantidad, cobrado_mes_importe)`. | `security invoker` |
| `puede_cobrar_contrarreembolso(empresa_id)` | `boolean`: permiso propio para ocultar «Marcar cobrado». No autoriza. | `security definer` |

Sin grant a `authenticated`: `private.registrar_cobro_interno` (único camino al libro de cobros),
`private.saldo_comprobante`, `private.aplicar_conciliacion` (único camino a la aprobación),
`private.validar_cobro_comprobante` (disparador de integridad) y las de permiso por empresa
(`private.puede_registrar_cobro_en_empresa`, `private.puede_conciliar_pago_en_empresa`,
`private.puede_cobrar_contrarreembolso_en_empresa`).

> `private.abrir_contrarreembolso` (MSF-195, `20270114120000_contrarreembolsos.sql`) existe pero **no tiene
> llamador en producción**: abrir el contrarreembolso al entregar era de MSF-135 y quedó **fuera de alcance** de
> esa épica (el aviso de contrarreembolso del prototipo no se implementó). Hoy solo lo invoca el *seed* local.

Errores: `42501` permiso · `22023` dato inválido (`hint` = campo) · `P0002` inexistente o ajeno · `55000`
estado no válido (factura anulada, borrador) · `40001` conflicto de edición · `P0001` tope de importe
(con `hint = 'importe'`). Contrato completo:
[Ventas · cobros y conciliación (técnico)](ventas-cobros-y-conciliacion.md#rpc).

### Ventas despacho y faltantes (MSF-135)

Fuente: `supabase/migrations/20270112100100`–`20270112150000` (rama `epic/MSF-135-…`, aún sin merge a `main`).
Todas las RPC de `public` son `security definer` con `search_path = ''`, `revoke … from public, anon` y `grant
execute … to authenticated`; la organización y el actor salen de la sesión y el permiso se resuelve **en la empresa
del comprobante**, no en la empresa activa.

| RPC | Devuelve / hace | Errores |
|---|---|---|
| `obtener_despacho_comprobante(p_id uuid)` | Estado de despacho, ids y nombres de Armó/Controló/Entregó, `entregado_en`, `updated_at` y `puede_despachar`. | `42501` sin ver Ventas en la tienda · `P0002` inexistente |
| `listar_responsables_despacho(p_empresa_id uuid, p_funcion text)` | Usuarios activos elegibles para `armar`/`controlar`/`entregar` (nombre, rol, `user_id`); `p_funcion` inválida → `22023`. | `42501` sin ver Ventas |
| `cambiar_estado_despacho(p_id uuid, p_estado text, p_responsable_id uuid, p_actualizado_en timestamptz)` | Avanza la máquina del despacho, descuenta las reservas «A pedido» al entregar (todo o nada) y registra la actividad `despacho.estado_cambiado`. Idempotente ante el estado ya alcanzado. | `42501` sin `despachar` o responsable no elegible · `22023` estado o dato inválido · `55000` transición no permitida · `P0002` inexistente · `40001` conflicto |
| `guardar_envio_comprobante(p_id uuid, p_transporte_id uuid, p_guia text, p_fecha_envio date, p_actualizado_en timestamptz)` | Guarda transporte, guía y fecha de envío de una factura confirmada no entregada; el transporte tiene que estar activo y usarse en la empresa del comprobante; registra `despacho.envio_guardado`. | `42501` sin `despachar` ni `ventas` en edición · `22023` transporte no válido o guía de más de 100 caracteres · `55000` no es factura confirmada o ya entregada · `40001` conflicto |
| `obtener_envio_comprobante(p_id uuid)` | Transporte, guía, fecha de envío y `updated_at`. Es la **única** lectura del envío: las tres columnas no tienen privilegio de lectura para `authenticated`. | `42501` sin Ventas en la empresa del comprobante · `P0002` inexistente |
| `registrar_faltantes_despacho(p_id uuid, p_faltantes jsonb, p_actualizado_en timestamptz)` | Registra los faltantes de una factura en `armando` o `incompleto` (cantidad entre 1 y lo pedido por línea, un faltante abierto por línea) y la deja en `incompleto`, todo o nada; registra `despacho.faltante_registrado`. | `42501` sin `despachar` · `22023` cantidad o línea inválida · `55000` la factura no está en Armando ni en Incompleto · `P0002` inexistente · `40001` conflicto |
| `listar_faltantes(p_empresa_id uuid default null, p_pagina integer default 1, p_tamano integer default 10)` | Faltantes **abiertos** de las empresas accesibles, con cliente, producto, SKU, cantidad, comprobante, fecha del pedido, «desde» y el stock de hoy; `filas` con el total del filtro. | `42501` sin sesión con organización |
| `listar_despacho(p_busqueda text default null, p_estado text default null, p_empresa_id uuid default null, p_pagina integer default 1, p_tamano integer default 10)` | Tablero: facturas confirmadas no anuladas con estado, responsables, transporte y guía; `conteos` por estado (sin el filtro de estado) y `filas` con el total. | `42501` sin sesión con organización · `22023` estado desconocido |

Sin grant a `authenticated`: `private.descontar_reservas_entrega`, `private.etiqueta_estado_despacho`,
`private.asignar_estado_despacho_inicial`, `private.exigir_envio_al_entregar`,
`private.resolver_faltantes_al_reanudar`, `private.responsable_despacho_habilitado`,
`private.rol_usuario_en_empresa`, `private.puede_despachar_en_empresa` y
`private.puede_leer_faltantes_empresa`.

Errores: `42501` sin sesión u organización, sin `despachar` o responsable no elegible · `22023` estado o dato
inválido · `55000` transición no permitida o factura sin estado de despacho · `P0002` comprobante inexistente ·
`40001` conflicto de edición. Contrato completo:
[Ventas · despacho y faltantes (técnico)](ventas-despacho-y-faltantes.md#rpc).

### Ventas RMA y devoluciones (MSF-178)

Fuente: `supabase/migrations/20270113100000`–`20270113120300` (rama `epic/MSF-178-…`, aún sin merge a
`main`). Las lecturas son `security invoker` (con el puente `private.listar_rma_sesion` para resolver la
sesión y las empresas accesibles) y las escrituras `security definer` con `search_path = ''`; todas
`revoke … from public, anon` y `grant execute … to authenticated`. La organización y el actor salen de la
sesión y el permiso se resuelve **en la empresa del RMA**.

| RPC | Devuelve / hace | Errores |
|---|---|---|
| `registrar_rma(p_comprobante_id uuid, p_lineas jsonb, p_forma_rma text, p_motivo text, p_observaciones text default null)` | Alta de un RMA sobre una **factura confirmada** no anulada; `p_lineas` = `[{linea_id, cantidad}]`; la cantidad no excede lo vendido ni lo ya devuelto; numera `RMA-####` y registra `rma.registrada`. | `42501` sin Ventas en edición · `P0002` comprobante inexistente · `22023` dato o línea inválida · `55000` borrador/anulada · `P0001` tope |
| `listar_rma(p_busqueda text default null, p_forma_rma text default null, p_estado text default null, p_empresa_id uuid default null, p_pagina integer default 1, p_tamano integer default 10)` | Listado paginado con número, tienda, comprobante, cliente, producto, cantidad, forma, motivo, operador, estado, `actualizado_en`, vínculo a la nota/reingreso y `filas`. | `42501` sin sesión con organización · `22023` forma o estado de filtro desconocido |
| `cambiar_estado_rma(p_id uuid, p_estado text, p_actualizado_en timestamptz)` | Avance lineal `abierto → en_gestion → cerrado`; idempotente, bloqueo optimista y evento `rma.estado_cambiado`. | `42501` sin Ventas en edición · `P0002` inexistente · `22023` estado o transición inválida · `40001` conflicto |
| `vincular_nota_credito_rma(p_rma_id uuid, p_tipo text, p_lineas jsonb default null, p_concepto text default null)` | Emite y vincula la nota con `emitir_nota_credito` (importe o productos), cierra el RMA y deja `rma.nota_credito_vinculada`; idempotente y excluyente con el reingreso. | `42501` sin `emitir_nota_credito` · `P0002` inexistente · `22023` tipo o dato inválido · `55000` ya resuelto con stock · `P0001` tope de la nota |
| `reingresar_stock_rma(p_rma_id uuid, p_deposito_id uuid default null)` | Una entrada por ítem al depósito de origen (o al indicado) con `registrar_movimiento_stock`, motivo «Devolución» y nota `RMA-####`; cierra el RMA y deja `rma.stock_reingresado`; idempotente y excluyente con la nota. | `42501` sin Ventas o Stock en edición · `P0002` inexistente · `22023` depósito/motivo inválido · `55000` ya resuelto con nota |

Ayuda interna sin grant a `authenticated`: `private.listar_rma_sesion(text, text, text, uuid, integer,
integer)`. Contrato completo: [Ventas · devoluciones (RMA), técnico](ventas-rma-devoluciones.md#rpc).

### Ventas reportes básicos (MSF-338)

Fuente: `supabase/migrations/20270104090000`–`20270104090200` (rama `epic/MSF-338-…`, aún sin merge a
`main`). Las dos RPC de `public` son `security definer` con `set search_path = ''`, `revoke execute … from
public, anon` y `grant execute … to authenticated`; la autorización va **adentro** (organización activa +
sección `reportes` + empresas accesibles) porque las vistas de `analitica` están cerradas para
`authenticated`.

| RPC | Devuelve / hace | Errores |
|---|---|---|
| `ventas_reportes_conteo(p_desde date, p_hasta date, p_empresa_id uuid default null)` | `integer`: comprobantes que cuentan como venta en el período (mismo predicado y mismo alcance que el tablero). Decide el estado vacío «No hay ventas en ese período». `p_empresa_id` acota a una tienda y nunca amplía el alcance. | `42501` sin la sección `reportes` · `22023` rango inválido |
| `leer_ranking_ventas(p_desde date, p_hasta date, p_incluir_consumidor_final boolean default false, p_empresa_id uuid default null, p_pagina integer default 1, p_tamano integer default 1000)` | Página del ranking (posición, cliente, comprobantes, facturado, participación, último comprador) más `total_filas` del alcance. Lee la **misma vista** que el tablero y recalcula posición y participación sobre el resultado filtrado. Tope de 5.000 filas por pedido. | `42501` sin la sección `reportes` · `22023` rango, página o tamaño de lote inválido |

Las vistas del contrato (`analitica.ventas_producto_mas_vendido` y `analitica.ventas_ranking_clientes`) no
son RPC: las consume Superset con el rol `superset_analitica`; el aislamiento lo fuerza la cláusula `rls` del
guest token, que desde esta épica acota también por `empresa_id`. Contrato y detalle:
[Ventas · reportes básicos (técnico)](ventas-reportes.md).

> **MSF-189 (MSF-562):** el alta de una consulta ya no encola en `dominio.consultas_avisos`; el disparador
> llama a `private.emitir_aviso('consulta_nueva', …, empresa)` y lo envía el flow `enviar-avisos`. Esas RPC
> de `service_role` quedan para drenar lo que ya estaba encolado. Detalle:
> [Avisos y listas](avisos-y-listas.md).

### Avisos y listas (MSF-189)

Fuente: `supabase/migrations/20261210120000`–`20261210130300` (rama `epic/MSF-189-…`, aún sin merge a
`main`). Las RPC de `public` son `security invoker`, con `revoke … from public, anon` y `grant execute … to
authenticated`; la RLS es la autoridad.

| RPC | Devuelve / hace | Errores |
|---|---|---|
| `public.listar_preferencias_aviso()` | `(tipo, nombre, activo)[]` de las secciones con nivel ≥ `lectura`; sin fila = encendido | — |
| `public.guardar_preferencia_aviso(p_tipo text, p_activo boolean)` | Upsert de la preferencia del usuario actual; devuelve `(tipo, activo)` | `22023` tipo desconocido o nulo; `42501` sección sin acceso |
| `public.crear_estado_consulta(p_nombre text)` | Alta al final del orden; `(id, nombre, activo, orden)` | `42501`, `23514` vacío, `23505` repetido |
| `public.renombrar_estado_consulta(p_id uuid, p_nombre text)` | `(id, nombre)` | `42501`, `23514`, `23505`, `P0002` |
| `public.cambiar_estado_estado_consulta(p_id uuid, p_activo boolean)` | `(id, activo)`; no borra | `42501`, `P0002` |

`private.emitir_aviso`, `private.reclamar_avisos_listos`, `private.marcar_aviso_enviado` y
`private.registrar_fallo_aviso` **no** se conceden a la app; solo el rol `kestra_orquestacion` ejecuta las
tres últimas. Contrato, flow y operación: [Avisos y listas](avisos-y-listas.md).

### Solicitud de acceso (MSF-148)

Fuente: `supabase/migrations/20261017100000_solicitudes_acceso.sql` y
`20261017100001_rpc_solicitar_acceso.sql` (merge PR #110). Contrato completo, Edge Function y correo:
[Perfil y permisos avanzados](perfil-y-permisos.md).

| RPC | Devuelve / hace | Seguridad |
|---|---|---|
| `public.solicitar_acceso(p_seccion text)` | `{ id, organizacion_id, nuevo, correo_enviado }`; inserta en `public.solicitudes_acceso` con `on conflict do nothing` (un pedido por persona, sección y día) | `security definer`, `search_path = ''`; exige sesión, membresía activa y sección del catálogo; rechaza una sección que ya tenga `lectura`/`edicion`; `42501` sin sesión/membresía, `22023` sección inválida o ya accesible; `revoke … from public, anon` + `grant execute … to authenticated` |

La tabla no admite escritura directa (`authenticated` sólo tiene `select` con RLS propia o de
administrador); el envío del correo lo hace la Edge Function `solicitar-acceso` con la service-role.

### Precios e IVA (MSF-114)

Fuente: `supabase/migrations/20261022120901`–`20261022150100` (rama de la épica, aún sin merge a `main`).
Contrato completo en [Precios e IVA (técnico)](precios-e-iva.md). Todas las RPC hacen
`revoke … from public, anon` y `grant execute … to authenticated`; las vistas son `security_invoker` y
heredan la RLS de las tablas base. La organización y el actor salen de la sesión.

| RPC | Devuelve | Seguridad |
|---|---|---|
| `fijar_cotizacion_inicial(p_valor numeric)` | la fila `dominio.cotizacion_inicial` de la organización | `security invoker`; exige `edicion` en `empresas`; `23514` valor inválido |
| `guardar_regla_precio_empresa(p_empresa, p_base, p_ajuste_pct, p_updated_at, p_mostrar_con_iva)` | la fila `dominio.precios_empresa` | `security invoker`; exige `edicion` en `empresas`; bloqueo optimista por `updated_at` (`40001`); `23514` ajuste inválido; `P0002` empresa inexistente |
| `previsualizar_precios_empresa(p_empresa, p_base, p_ajuste_pct, p_muestra)` | tabla `{ producto_id, nombre, sku, moneda, central_ars, neto_ars, final_ars }` | `security invoker`; exige `lectura` en `empresas`; muestra acotada de productos activos |
| `guardar_alicuota_categoria(p_categoria, p_alicuota)` | el id de la alícuota | `security invoker`; exige `edicion` en `categorias`; `23514` alícuota inactiva |
| `asignar_alicuota_producto(p_producto, p_alicuota)` | el id de la alícuota (`null` = hereda la de su categoría) | `security invoker`; exige `edicion` en `productos`; `23514` alícuota inactiva |
| `guardar_precios_escala(p_producto, p_x5, p_x10, p_x50)` | vacío | `security invoker`; exige `edicion` en `productos`; idempotente; `23514` precio inválido, `22003` demasiado grande |

Vistas de lectura (`security_invoker`): `public.productos_precio_costo` (precio central, costo en pesos y
margen; el costo solo llega con la sección `rentabilidad`), `public.precios_empresa_neto` (central y neto
por producto y empresa) y `public.precios_empresa_final` (alícuota, precio final y precio visible según el
interruptor de la empresa).

Cálculo en `private`: `a_pesos`, `precio_central_ars`, `aplicar_regla_precio`, `precio_neto_empresa`,
`alicuota_producto`, `aplicar_iva` y `precio_para(producto, empresa, escala default 'x1')` — una escala
fuera de `x1`/`x5`/`x10`/`x50` devuelve `22023` y una escala sin precio cargado cae en el precio de lista.

### Cotización del dólar (MSF-116)

Fuente: `supabase/migrations/20261023140000`–`20261023140500` (rama de la épica, aún sin merge a `main`).
Contrato completo en [Dólar y recálculo](dolar-y-recalculo.md#rpc-public). Todas las RPC hacen
`revoke … from public, anon` y `grant execute … to authenticated`; la organización y el actor salen de la
sesión.

| RPC | Devuelve | Seguridad |
|---|---|---|
| `cargar_cotizacion(p_valor numeric)` | valor, anterior, variación y vencimiento de la pendiente | `security invoker`; exige `edicion`; `23514` valor inválido, `22003` fuera de rango |
| `estado_cotizacion()` | vigente, productos activos en USD y pendiente no vencida | `security invoker`; exige `lectura` |
| `previsualizar_cotizacion()` | variación, `recalcula`, precios por empresa y muestra hoy/nuevo | `security definer` acotado; exige `edicion`; `P0002` sin pendiente |
| `confirmar_cotizacion()` | id, si recalculó y cuántos precios | `security definer`; una transacción; `P0002` sin pendiente vigente |
| `descartar_cotizacion()` | vacío | `security definer`; idempotente |
| `listar_cotizaciones(p_limite integer, p_cursor text)` | filas paginadas y cursor siguiente | `security invoker`; `cotizacion_dolar` ≥ `lectura`; `22023` cursor inválido |
| `cotizacion_del_dia()` | si hay carga confirmada hoy en Buenos Aires | `security invoker`; `cotizacion_dolar` ≥ `lectura` |

`listar_cotizaciones` es el historial nuevo de MSF-116; no confundir con `listar_historial_cotizaciones`
(cotizaciones importadas del panel anterior, MSF-275).

### Tienda pública (MSF-147 y MSF-167)

Fuente: `supabase/migrations/20261023100000`–`20261023150300` (MSF-147 y MSF-167, ramas de sus épicas).
`publico` es un esquema **solo de funciones** de lectura anónima: `anon` ejecuta las funciones y no tiene
privilegios sobre `public`, `dominio` ni `private`. Las funciones de tienda son `security definer`,
`stable`, `search_path = ''`, filtran por el `host` y `empresa.activa`, devuelven una lista blanca de
campos y una respuesta idéntica (vacía o `null`) para dominio desconocido o empresa desactivada.
Los helpers `private.disponible_publico`, `private.precio_final_publico` y `private.imagen_publica`
**no** tienen `execute` para roles de API.

**MSF-147 (dominio, identidad y catálogo visible):**

| RPC / función | Devuelve / hace | Seguridad |
|---|---|---|
| `publico.tienda_por_dominio(host)` | `(tienda_id, empresa_nombre, estado)`; cero filas si no existe o la empresa está inactiva | `security definer`; `anon` y `authenticated` |
| `publico.identidad_por_dominio(host)` | Colores, tipografías y rutas de logo/banners; tema base si no hay fila | `security definer`; `anon` y `authenticated` |
| `publico.contenido_por_dominio(host)` | Ocho textos comerciales y `boton_destino`; vacío si no hay fila | `security definer`; `anon` y `authenticated` |
| `publico.catalogo_visible_por_dominio(host)` | Categorías y productos efectivamente visibles, destacados primero; `null` si el dominio no existe o la empresa está inactiva | `security definer`; `anon` y `authenticated` |
| `public.guardar_tienda_identidad(...)` | Guarda el estado completo de la identidad; idempotente | `security definer`; edición en Empresas; `42501`, `P0002`, `22023` |
| `public.guardar_tienda_contenido(...)` | Guarda los textos con recorte y límites; idempotente | `security definer`; edición en Empresas; `42501`, `22023` con `hint` del campo |
| `public.listar_catalogo_tienda(empresa)` | Categorías con conteo, productos con visibilidad efectiva y motivo, y resumen `{visibles, destacados}` | `security definer`; `lectura` en Empresas; `42501`, `P0002` |
| `public.guardar_catalogo_tienda(empresa, categorias, productos)` | Aplica la diferencia en una transacción y devuelve el resumen | `security definer`; edición en Empresas; `42501`, `P0002`, `22023` |

**MSF-167 (catálogo y ficha):** agrega `categorias_por_dominio`, `catalogo_pagina_por_dominio`,
`producto_por_dominio` e `imagen_publica`. Detalle de contratos, decisiones y operación:
[Tienda online: dominio, identidad y catálogo visible](tienda-dominio-e-identidad.md) y
[Tienda pública: catálogo y ficha](tienda-catalogo-y-ficha.md).

### Acceso y sesión (MSF-119)

Épica MSF-119 (F-ACC-01, F-ACC-02, F-ACC-03, F-ORG-01). El login, la recuperación y la definición de contraseña
los resuelve **GoTrue (Supabase Auth)**, no una RPC propia; lo que la épica agrega es el estado de la membresía y
el bloqueo por intentos. Fuente: `supabase/migrations/20261012140100`–`20261014100000`.

| RPC / función | Para qué | Seguridad |
|---|---|---|
| `public.bloqueo_acceso_hasta(p_correo text) → timestamptz` | Instante hasta el que el correo queda bloqueado, o `null`. No distingue correos existentes de inexistentes. | `security definer`; `anon` y `authenticated`; `search_path = public` |
| `public.registrar_fallo_acceso(p_correo text) → timestamptz` | Suma un fallo al contador del correo y devuelve el bloqueo vigente. Un correo nulo, vacío o de más de 254 caracteres no cuenta y no se hashea. | `security definer`; `anon` y `authenticated`; `search_path = ''` |
| `public.limpiar_intentos_acceso()` | Borra el contador del correo del JWT tras un ingreso exitoso; nadie puede resetear el de otro. | `security definer`; solo `authenticated` |
| `public.verificar_intento_acceso(event jsonb) → jsonb` | Auth Hook `password_verification_attempt`: `{decision: 'continue' \| 'reject', message?}`. Bloqueado → rechaza siempre con el mismo mensaje, sea la contraseña válida o no. Si la función lanza, GoTrue rechaza (falla cerrado). | `security definer`; solo `supabase_auth_admin`; `search_path = ''` |
| `private.hash_correo_acceso(p_correo text) → text` | HMAC-SHA256 del correo normalizado con la clave `acceso_hmac` de Vault. | `security definer`; revocado a `public`, `anon` y `authenticated` |
| `private.contar_fallo_acceso(p_hash text, p_servidor boolean) → timestamptz` | Conteo atómico con `pg_advisory_xact_lock`; `p_servidor` marca que el hook ya contó ese intento (ventana de 10 s). | `security definer`; revocado a `public`, `anon` y `authenticated` |
| `private.purgar_intentos_acceso(p_excepto text)` | Purga acotada (100 filas por llamada) de intentos viejos. | `security definer`; revocado a `public`, `anon` y `authenticated` |
| `private.cortar_sesiones_suspendido()` | Trigger `AFTER UPDATE` de `usuarios_organizacion`: borra las filas de `auth.sessions` del usuario cuando `estado` pasa a `suspendido`. | `security definer`; revocado a `public`, `anon` y `authenticated` |

- **Superficie de `anon`:** `grant usage on schema public to anon` existe solo para estas RPC de acceso;
  `20261013120001` revoca `EXECUTE` a `public` y `anon` sobre el resto de las funciones de `public` y
  `20261013130000` quita los privilegios por defecto de `anon` para lo que nazca después. El pgTAP
  `estado_usuario` falla si `anon` ejecuta algo fuera de estas RPC.
- **Sin API propia:** el panel llama a `supabase.auth.signInWithPassword`, `resetPasswordForEmail` y
  `updateUser`; el estado de la membresía se lee de `public.usuarios_organizacion` (`select estado`).
- Contrato completo, flujo, pruebas y operación: [Acceso y organización (técnico)](acceso.md).

### Alta de organizaciones (MSF-162)

Sin migraciones: el alta reutiliza la Edge Function del template `crear-organizacion`
(`supabase/functions/crear-organizacion/`). Se invoca con el JWT del superadmin y cuerpo
`{ nombre, email_fundador }`; responde `201 { organizacion_id, invitado }`, `403` si el llamador no
es superadmin (o el token falta/es inválido) y `400`/`502` si la invitación o la membresía fallan,
revirtiendo la organización. Las escrituras usan `service_role`, que vive solo en el entorno de la
función; `authenticated` y `anon` no tienen `INSERT` sobre `organizaciones` (pgTAP
`alta_organizacion_nueva.test.sql`). Contrato completo y flujo:
[Organizaciones nuevas](organizaciones-nuevas.md).

### Cuenta web del cliente (MSF-237)

Fuente: `supabase/migrations/20261206100000`–`20261206110100` y
`supabase/functions/{invitar-cliente,recuperar-clave-cliente}` (rama de la épica, pendiente de merge a
`main`). Contrato completo, RLS y operación: [Cuenta web del cliente](cuenta-web-cliente.md).

| RPC / función | Para qué | Seguridad |
|---|---|---|
| `public.preparar_cuenta_cliente(p_cliente, p_empresa)` | Valida permisos, correo, dominio y usuario de Auth antes de invitar; no escribe. | `security definer`; `authenticated`; `42501`/`22023`/`P0002` |
| `public.vincular_cuenta_cliente(p_cliente, p_empresa, p_auth_user, p_actor)` | Alta idempotente de la cuenta en estado `activa` y evento de Actividad. | Solo `service_role` (Edge Function) |
| `public.cambiar_estado_cuenta_cliente(p_cliente, p_empresa, p_estado)` | Suspender/reactivar; idempotente; efecto inmediato en el acceso. | `authenticated`; exige edición y alcance |
| `public.cuentas_web_de_cliente(p_cliente)` | Estado, correo de acceso y último ingreso por tienda. | `authenticated`; lectura de Clientes |
| `public.registrar_restablecimiento_cuenta_cliente(p_cliente, p_empresa)` | Evento de Actividad tras enviar el enlace de nueva clave. | `authenticated`; cuenta activa |
| `public.cuenta_cliente_para_recuperar(host, correo)` | Decide si la recuperación envía el correo. | Solo `service_role`; sin filas si no corresponde |
| `publico.acceso_cliente_por_dominio(host)` | Estado (`activa`/`suspendida`/`sin_cuenta`/`no_habilitado`) y tipo solo si activa. | `authenticated`; `null` uniforme |
| `publico.precios_cliente_por_dominio(host, productos uuid[])` | Precios por escala del cliente activo (minorista x1; mayorista x1–x50). | `authenticated`; máximo 50 productos; lista blanca |

- **Edge Functions:** `invitar-cliente` (JWT del operador; crea/reutiliza el usuario de Auth y no escribe
  `usuarios_organizacion`) y `recuperar-clave-cliente` (anónima; respuesta uniforme). La service-role vive
  solo en su entorno.
- **Contrato aditivo:** `public.buscar_clientes` y `public.exportar_clientes` agregan
  `p_con_cuenta_web boolean default false` y `buscar_clientes` devuelve `cuentas_web jsonb`; con el
  parámetro omitido el comportamiento previo se conserva.
- **Helper interno:** `private.precio_final_publico_escala(producto, empresa, escala)` no tiene `grant` a
  `anon`/`authenticated`; el pgTAP de paridad lo compara con `private.precio_para(...).final`.

## Cómo descubrir el contrato

1. **Migraciones** en `supabase/migrations` (fuente de verdad).
2. **Graphify**: `graphify query "RPC de reparaciones"` / `graphify explain "cambiar_estado_reparacion"`.
3. **Tests pgTAP** en `supabase/tests/database` (firman el comportamiento esperado).
4. **Specs** en `specs/<slug>/spec.md` (requisitos y escenarios).

!!! warning "Pendiente"
    Todavía no hay un **OpenAPI** del panel (es PostgREST + RPC). Cuando se agregue, esta página debe linkearlo y el check de contratos debe validarlo.

> **service_role:** puede ejecutar las RPC y leer los esquemas `dominio`/`private` (grants explícitos). No se expone al cliente; el seed local lo usa sólo para preparar datos.
