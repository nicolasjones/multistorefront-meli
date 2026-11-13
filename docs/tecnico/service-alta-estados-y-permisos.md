---
owner: tecnico
sources:
  - specs
  - supabase/migrations
  - apps/web/src
---

# Service técnico: alta, estados y permisos (MSF-182)

Épica **MSF-182** (F-SVC-01, F-SVC-02, F-SVC-03 y F-SVC-05). Spec, plan y tareas:
`specs/20261020-100000-service-alta-estados-y-permisos/` en la rama
`epic/MSF-182-service-tecnico-service-alta-estados-y-p`. Alcance de entrega: `refine` y `supabase`. Versión de
producto: [Service técnico: alta, estados y permisos](../producto/service-alta-estados-y-permisos.md).

> **Fidelidad.** Esta página se redactó desde la spec y las tareas de la rama de la épica. Las migraciones
> `supabase/migrations/20261020*` y el código de `apps/web` **no están en este checkout** (`main`); los nombres de
> archivo salen de `tasks.md`. TODO (dueño: quien mergee la épica): verificar nombres y firmas contra las
> migraciones al mergear.

## Datos

Cuatro tablas en `dominio` (Principio VII); roles y actividad siguen en `public` (solo datos). ER y reglas en
[Datos](datos.md#service-tecnico-msf-182).

| Objeto | Migración (tasks.md) |
|---|---|
| `dominio.modelos_equipo`, `dominio.estados_reparacion` | `20261020100100`, `20261020100200` |
| `private.sembrar_service` (siete modelos y siete estados, idempotente, trigger + backfill) | `20261020100300` |
| `dominio.reparaciones`, `private.siguiente_numero_reparacion` | `20261020110100`, `20261020110200` |
| `dominio.reparacion_historial` + `crear_reparacion` | `20261020110300` |
| Rol `tecnico` en `roles_organizacion`/`permisos_rol` | `20261020130100` |
| Funcionalidad `service-tecnico` (`private.tiene_feature`) | `20261020100700` |

- RLS por `organizacion_id = private.organizacion_id()` y `private.nivel_seccion('service_tecnico')` (`lectura`/
  `edicion` para leer; `edicion` para escribir). Sin `delete`; `anon` sin privilegios.
- Los modelos y estados son por organización; la numeración `R-0001` es por empresa, bajo bloqueo transaccional.
- Los costos internos no tienen `select` directo; solo `obtener_reparacion` los devuelve, nulos sin `ver_costos`.
- Reversión explícita en el encabezado de cada migración (aditivas).

## API (RPC de `public`)

Todas con `revoke … from public, anon` y `grant execute … to authenticated`. Errores: `22023` validación (campo en
`hint`), `42501` sin permiso, `40001` conflicto de edición, `55000` reparación anulada o cerrada, `P0002`
inexistente, `23505` duplicado.

| RPC | Seguridad | Para qué |
|---|---|---|
| `crear_modelo_equipo`, `actualizar_modelo_equipo`, `cambiar_estado_modelo_equipo` | invoker | Alta, edición (bloqueo optimista por `updated_at`) y activar/desactivar idempotente |
| `crear_estado_reparacion`, `actualizar_estado_reparacion`, `mover_estado_reparacion`, `cambiar_estado_estado_reparacion` | invoker | ABM de estados; mover intercambia `orden` en forma atómica |
| `uso_modelo_equipo`, `uso_estado_reparacion` | invoker | Cantidad de reparaciones que los usan (aviso al desactivar) |
| `crear_reparacion` | definer, `search_path = ''` | Valida cliente, modelo activo y empresa; número, primer estado activo, ingreso de hoy, evento `alta` |
| `actualizar_reparacion` | definer | Bloqueo optimista; no edita anuladas; no cambia número, empresa ni estado |
| `obtener_reparacion`, `tecnicos_de_service` | definer | Lectura con máscara de costos; técnicos = usuarios con `service_tecnico` en `edicion` |
| `cambiar_estado_reparacion` | definer | `for update`, idempotente, rechaza anuladas y cerradas; evento `estado` |
| `registrar_entrega_reparacion` | definer | Estado con `cierra`, fecha no anterior al ingreso ni futura, `entregado_por` obligatorio; evento `entrega` |
| `anular_reparacion` | definer | Motivo obligatorio; `anulada_en`/`anulada_motivo`; irreversible; evento `anulacion` |

La búsqueda de cliente usa `public.buscar_clientes`; el alta rápida consume la RPC de alta mínima de Clientes
(MSF-180), sin duplicar su lógica (TODO dueño: Clientes, confirmar nombre y firma antes de implementar F-SVC-02).

## Flujos

- **Estado:** cualquier estado activo a cualquier otro (también hacia atrás); entregadas y anuladas no vuelven a
  cambiar. «Anulada» no es un estado: es la marca `anulada_en` + motivo. Diagrama en la spec (Flujo 1) y en
  [Flujos](flujos.md).
- **Entrega:** todo estado con `cierra = true` («Entregado», «Sin reparación») abre el diálogo y llama a
  `registrar_entrega_reparacion`, que cambia el estado en la misma transacción.

## Actividad

En la misma transacción vía `private.registrar_actividad`, sin evento si no hubo cambio: `modelo.*` y `estado.*`
(`creado`, `editado`, `desactivado`, `reactivado`, `reordenado`), `reparacion.creada`, `reparacion.editada`,
`reparacion.estado_cambiado`, `reparacion.entregada`, `reparacion.anulada`. Contrato en
[Actividad](../actividad.md).

## Permisos

Rol `tecnico`: `service_tecnico` = `edicion`; `inicio`, `clientes`, `productos` y `stock` = `lectura`; resto
`ninguno`; acciones sin `eliminar`, `exportar` ni `ver_costos`. Amplía `private.matriz_inicial()` y
`private.matriz_acciones_iniciales()` de forma aditiva (backfill con `on conflict do nothing`); los seis roles
existentes no cambian. La matriz es fija. Detalle en [Permisos por rol](../permisos-por-rol.md) y
[Permisos por empresa](permisos-por-empresa.md).

## Frontend (`apps/web`)

Rutas protegidas por nivel: `/service-tecnico/modelos`, `/service-tecnico/estados`,
`/service-tecnico/reparaciones` y `/service-tecnico/reparaciones/nueva|:id`; entrada de menú y
`SECCION_POR_RECURSO`; capa de llamadas en `lib/serviceTecnico.ts` y `lib/reparaciones.ts`. La Tienda por defecto
es la empresa activa ([Empresa activa](../empresa-activa.md)).

## Pruebas

pgTAP: `service_catalogos`, `service_reparaciones`, `service_estado_entrega`, `rol_tecnico` (aislamiento,
numeración concurrente, máscara de costos, `anon` sin ejecución, `rls_en_toda_tabla`). Vitest por pantalla y E2E
`apps/web/e2e/service-tecnico.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`).

## Fuera de alcance

«Disponible en» por tienda, listado/ítems/impresión (MSF-199), avisos reales al cliente, matriz editable
(enero) y migración de reparaciones históricas.
