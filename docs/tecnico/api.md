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
| `public.definir_empresas_producto(...)` | Empresas que venden un producto (atómica) |
| `public.ranking_clientes(...)` | Ranking por facturación (solo lectura) |
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

### Service técnico: listado, ítems e impresión (MSF-199)

Fuente: `supabase/migrations/20261022100100`–`20261022110200` (rama `epic/MSF-199-…`, aún sin merge a
`main`). Contrato completo, modelo y límites: [Service técnico: listado, ítems e
impresión](service-listado-items-impresion.md).

| RPC | Devuelve / hace | Seguridad |
|---|---|---|
| `public.listar_reparaciones(p_empresa uuid, p_periodo text, p_serie text, p_tecnico uuid, p_pagina int, p_tamano int)` | `{ total_filas, filas[] }`; período `hoy|semana|mes` sobre la entrega prevista; la serie ignora el período; página 1–200 filas (25 por defecto); sin costos internos | `security definer` (desvío: reaplica a mano organización, `lectura`+ y `empresas_accesibles()`); `42501` sin permiso, `22023` período inválido |
| `public.agregar_item_reparacion(p_reparacion_id, p_tipo, p_descripcion, p_producto_id, p_cantidad, p_precio)` | Inserta un ítem, recalcula totales y devuelve la reparación con `items` | `security definer`; exige `edicion`; `22023` con campo en `hint`, `42501`, `P0002`, `55000` si está entregada/anulada; no mueve stock |
| `public.quitar_item_reparacion(p_item_id)` | Quita un ítem, recalcula totales y devuelve la reparación | `security definer`; mismas reglas que agregar |
| `public.obtener_reparacion(id)` | Agrega `items`, `total_mano_obra`, `total_repuestos`, `total_cliente` y `ganancia_estimada` (`null` sin `ver_costos`) | Contrato aditivo; las claves anteriores no cambian |

Todas hacen `revoke … from public, anon` y `grant execute … to authenticated`; fijan `search_path = ''`.

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
