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
| `public.tecnicos_de_service()` | Técnicos elegibles (usuarios con `edicion` en Service técnico) |
| `public.crear_modelo_equipo` / `actualizar_modelo_equipo` / `cambiar_estado_modelo_equipo` | Catálogo de modelos |
| `public.crear_estado_reparacion` / `actualizar_estado_reparacion` / `mover_estado_reparacion` / `cambiar_estado_estado_reparacion` | Catálogo de estados |
| `public.uso_modelo_equipo(id?)` / `uso_estado_reparacion(id?)` | Cantidad de reparaciones que usan cada modelo/estado |
| `public.historial_ultimo_numero(...)` | Último número histórico para la numeración nueva |
| `publico.crear_consulta_publica(host, origen, nombre, contacto, mensaje, producto_id)` | Alta pública de una consulta; la empresa sale del dominio de la tienda |
| `public.actualizar_consulta(...)` / `contar_consultas_nuevas(...)` / `responsables_consultas(...)` | Bandeja: edición con bloqueo optimista, contador y responsables |
| `public.guardar_correo_avisos_consultas(empresa_id, correo, updated_at)` | Dirección de avisos de consultas de la empresa |
| `publico.categorias_por_dominio(host)` | Categorías visibles de la tienda del dominio (menú y pie) |
| `publico.catalogo_pagina_por_dominio(host, categoria, solo_con_stock, precio_max, orden, pagina)` | Página de 24 productos con filtros y orden; lista blanca de campos |
| `publico.producto_por_dominio(host, producto)` | Ficha pública de un producto visible; misma `null` si no existe o no se publica |
| `publico.imagen_publica(ruta)` | Booleano de respaldo de la política de lectura anónima de imágenes |

### Service técnico (MSF-182)

Fuente: `supabase/migrations/20261020*` (rama `epic/MSF-182-…`, aún sin merge a `main`). Las mutaciones de reparaciones son `security definer` con `search_path = ''` (la tabla no admite escritura directa); las de catálogos, `security invoker`. Todas: `revoke … from public, anon` y `grant execute … to authenticated`. Errores: `22023` validación (campo en `hint`), `42501` sin permiso, `40001` conflicto, `55000` anulada/cerrada, `P0002` inexistente.

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

### Tienda pública (MSF-147 y MSF-167)

Fuente: `supabase/migrations/20261023100000`–`20261023150300` (MSF-147 y MSF-167, ramas de sus épicas).
`publico` es un esquema **solo de funciones** de lectura anónima: `anon` ejecuta las funciones y no tiene
privilegios sobre `public`, `dominio` ni `private`. Las funciones de tienda son `security definer`,
`stable`, `search_path = ''`, filtran por el `host` y `empresa.activa`, devuelven una lista blanca de
campos y `null` idéntico para dominio desconocido o empresa desactivada.
MSF-167 agrega `categorias_por_dominio`, `catalogo_pagina_por_dominio`, `producto_por_dominio` e
`imagen_publica`; los helpers `private.disponible_publico`, `private.precio_final_publico` y
`private.imagen_publica` **no** tienen `execute` para roles de API. Detalle de contratos, decisiones y
operación: [Tienda pública: catálogo y ficha](tienda-catalogo-y-ficha.md).

## Cómo descubrir el contrato

1. **Migraciones** en `supabase/migrations` (fuente de verdad).
2. **Graphify**: `graphify query "RPC de reparaciones"` / `graphify explain "cambiar_estado_reparacion"`.
3. **Tests pgTAP** en `supabase/tests/database` (firman el comportamiento esperado).
4. **Specs** en `specs/<slug>/spec.md` (requisitos y escenarios).

!!! warning "Pendiente"
    Todavía no hay un **OpenAPI** del panel (es PostgREST + RPC). Cuando se agregue, esta página debe linkearlo y el check de contratos debe validarlo.

> **service_role:** puede ejecutar las RPC y leer los esquemas `dominio`/`private` (grants explícitos). No se expone al cliente; el seed local lo usa sólo para preparar datos.
