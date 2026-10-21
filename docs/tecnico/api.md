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

### Service técnico (MSF-182)

Fuente: `supabase/migrations/20261020*` (rama `epic/MSF-182-…`, aún sin merge a `main`). Las mutaciones de reparaciones son `security definer` con `search_path = ''` (la tabla no admite escritura directa); las de catálogos, `security invoker`. Todas: `revoke … from public, anon` y `grant execute … to authenticated`. Errores: `22023` validación (campo en `hint`), `42501` sin permiso, `40001` conflicto, `55000` anulada/cerrada, `P0002` inexistente.

## Cómo descubrir el contrato

1. **Migraciones** en `supabase/migrations` (fuente de verdad).
2. **Graphify**: `graphify query "RPC de reparaciones"` / `graphify explain "cambiar_estado_reparacion"`.
3. **Tests pgTAP** en `supabase/tests/database` (firman el comportamiento esperado).
4. **Specs** en `specs/<slug>/spec.md` (requisitos y escenarios).

!!! warning "Pendiente"
    Todavía no hay un **OpenAPI** del panel (es PostgREST + RPC). Cuando se agregue, esta página debe linkearlo y el check de contratos debe validarlo.
