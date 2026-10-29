# Implementation Plan: Service técnico · Service alta, estados y permisos

**Branch**: `epic/MSF-182-service-tecnico-service-alta-estados-y-p` | **Date**: 2026-10-20 | **Spec**: [spec.md](./spec.md) | **Épica**: MSF-182

## Summary

Cuatro tablas de dominio (`modelos_equipo`, `estados_reparacion`, `reparaciones`, `reparacion_historial`) con RLS por organización y por nivel de la sección `service_tecnico`, RPC de alta, edición, cambio de estado, entrega y anulación, pantallas de administración de modelos y estados, el detalle de reparación (alta/edición/estado/historial/entrega/anulación) y el rol Técnico en la matriz fija de permisos. Todo reutiliza el contrato de MSF-121 (`private.nivel_seccion`, `private.puede_accion`, empresa activa), el de actividad (`private.registrar_actividad`) y el patrón CRUD de clientes.

## Technical Context

- **Lenguaje/Stack**: TypeScript + React + Refine + MUI (`apps/web`), Supabase self-hosted (Postgres, RPC, pgTAP). Sin Kestra, Superset ni workers (Constitución IV, V).
- **Pruebas**: pgTAP (`pnpm test:db`, requiere `pnpm dev:supabase`), Vitest (`pnpm test:web`), E2E Playwright en `apps/web/e2e/*.e2e.ts` (ver `docs/e2e-app.md`; se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`).
- **Validación**: `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm docs:check`, `pnpm matriz:check`, `pnpm prototipo:check`.
- **Restricciones**: migraciones aditivas con reversión en el encabezado; `anon` sin privilegios; `revoke … from public, anon` + `grant execute … to authenticated` en cada RPC; sin service-role en el navegador.
- **Dependencias externas verificadas**: `private.nivel_seccion/puede_accion`, `permisos_actuales`, `SECCION_POR_RECURSO` (`docs/permisos-por-rol.md`), `private.registrar_actividad` (`docs/actividad.md`), `public.buscar_clientes`. **Pendiente de confirmar**: nombre y firma de la RPC de alta mínima de cliente de MSF-180 (la épica pide verificarlo con Clientes antes de implementar F-SVC-02).

## Constitution Check

| Principio | Cumplimiento |
|-----------|--------------|
| I Aislamiento | RLS por `organizacion_id` en las cuatro tablas; FK compuestas `(id, organizacion_id)` impiden cruzar organizaciones; pgTAP de aislamiento entre dos organizaciones (SC-001, SC-003). |
| II Especificar primero | Esta spec; cada tarea referencia FR/SC. |
| III Idempotencia/auditoría | `cambiar_estado`, activar/desactivar y sembrado idempotentes; actividad `reparacion.*`, `modelo.*`, `estado.*` en la misma transacción; historial propio de la reparación. |
| IV Despliegues independientes | Solo `refine` + `supabase`. |
| V Simplicidad | Sin tabla contador (bloqueo transaccional para la numeración); sin infraestructura nueva. |
| VI Panel operable | Entrada de menú «Service técnico» con icono y pestañas; rutas canónicas `/service-tecnico/{modelos,estados,reparaciones,reparaciones/nueva,reparaciones/:id}`; estados vacío/error/carga/éxito del kit; teclado y 320/768/1440 px; sin identificadores técnicos visibles (se muestra `R-0001`, nombre de cliente, nombre de modelo). |
| VII Esquemas | **Re-verificado en spec, plan y tareas**: `modelos_equipo`, `estados_reparacion`, `reparaciones`, `reparacion_historial` → **`dominio`** (negocio del producto); `roles_organizacion`, `permisos_rol`, `permisos_rol_accion`, `registro_actividad` → **`public`** (sin cambio, solo datos nuevos). RPC expuestas en `public`; ayudas en `private`. |
| VIII Documentación | `docs/service-tecnico.md` (nuevo), `docs/permisos-por-rol.md`, `docs/actividad.md`. |

Supabase self-hosted: nada se asume de Supabase Cloud.

## Project Structure

```text
supabase/migrations/
  20261021163400_modelos_equipo.sql                 # F-SVC-01
  20261021163500_estados_reparacion.sql             # F-SVC-01
  20261021163600_service_sembrado.sql               # F-SVC-01 (siete modelos/estados, trigger + backfill)
  20261021163700_modelos_equipo_rpc.sql             # F-SVC-01
  20261021163800_estados_reparacion_rpc.sql         # F-SVC-01
  20261021163900_service_catalogo_actividad.sql     # F-SVC-01
  20261021164000_service_funcionalidad.sql          # F-SVC-01 (feature flag service-tecnico)
  20261021164300_reparaciones.sql                   # F-SVC-02
  20261021164400_reparaciones_numeracion.sql        # F-SVC-02
  20261021164500_reparacion_historial_crear.sql     # F-SVC-02
  20261021164600_reparaciones_actualizar.sql        # F-SVC-02
  20261021164700_reparaciones_leer.sql              # F-SVC-02 (obtener, técnicos, máscara de costos)
  20261021164800_service_uso.sql                    # F-SVC-02
  20261021164900_reparaciones_actividad.sql         # F-SVC-02
  20261021165000_reparaciones_estado.sql            # F-SVC-03
  20261021165200_reparaciones_entrega.sql           # F-SVC-03
  20261021165300_reparaciones_anular.sql            # F-SVC-03
  20261021165400_reparaciones_estado_actividad.sql  # F-SVC-03
  20261021165600_rol_tecnico.sql                    # F-SVC-05
supabase/tests/database/
  service_catalogos.test.sql  service_reparaciones.test.sql
  service_estado_entrega.test.sql  rol_tecnico.test.sql
apps/web/src/
  lib/serviceTecnico.ts  lib/reparaciones.ts  lib/permisos.ts (SECCION_POR_RECURSO)
  components/navegacion/destinosPanel.ts (entrada «Service técnico»)
  components/service/ (ModeloFormDialog, EstadoFormDialog, ClienteSelector,
                       AltaRapidaClienteDialog, EntregaDialog, AnularDialog, HistorialEstados)
  pages/service-tecnico/ (modelos.tsx, estados.tsx, reparaciones.tsx, reparacion.tsx)
apps/web/e2e/service-tecnico.e2e.ts
docs/service-tecnico.md
```

Los timestamps de migración son propios de cada historia y no se encadenan entre sí (las historias son autosuficientes).

## Diseño por historia

### F-SVC-01 · Modelos y estados (S)
- Tablas con `unique (id, organizacion_id)` (para FK compuestas de F-SVC-02), unicidad por organización sin distinguir mayúsculas/tildes según el patrón ya usado en el repo, `check` de importes y `updated_at` para bloqueo optimista; grants por columna (`organizacion_id` la fija el servidor).
- Sembrado `private.sembrar_service(org)` idempotente (`on conflict do nothing`), trigger sobre `organizaciones` y backfill en la misma migración.
- `mover_estado_reparacion`: intercambio de `orden` en una sola sentencia con bloqueo de las dos filas (sin violar la unicidad de `orden`).
- Menú: destino con `seccionPermiso: 'service_tecnico'` y `private.tiene_feature('service-tecnico')`; recursos en `SECCION_POR_RECURSO`.

### F-SVC-02 · Alta y edición (L)
- `reparaciones.numero` con `unique (empresa_id, numero)`; `crear_reparacion` toma `pg_advisory_xact_lock` por empresa, calcula `max(numero)+1` e inserta: sin saltos, sin tabla contador. Test de concurrencia en pgTAP.
- Máscara de costos: columnas de costo sin `select` directo para `authenticated`; `obtener_reparacion` devuelve nulos sin `ver_costos`. Escritura de costos solo en la RPC con esa acción.
- `ClienteSelector` sobre `buscar_clientes`; `AltaRapidaClienteDialog` consume la RPC de MSF-180 (esta épica no escribe en `public.clientes`).
- Uso de modelos/estados: RPC de conteo + aviso con confirmación en Modelos y Estados (extiende las pantallas de F-SVC-01, que ya está mergeada cuando F-SVC-02 arranca).

### F-SVC-03 · Estado, historial y entrega (M)
- `cambiar_estado_reparacion` y `registrar_entrega_reparacion` bloquean la fila (`for update`) y escriben `reparacion_historial` por RPC `security definer` con `search_path = ''`.
- Entrega: cualquier estado con `cierra = true`; después de cerrar o anular no hay más cambios de estado.
- E2E del criterio de verificación de la épica: alta → tres estados → entrega.

### F-SVC-05 · Rol Técnico (S)
- Migración propia que redefine `private.matriz_inicial()` y `private.matriz_acciones_iniciales()` agregando `tecnico` (valores confirmados por Nicolás en *Decisiones abiertas* 2), inserta el rol en `roles_organizacion` y hace backfill de `permisos_rol`/`permisos_rol_accion` con `on conflict do nothing`.
- Regresión: los niveles de los seis roles existentes quedan idénticos (pgTAP compara contra la matriz vigente).

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|-----------|
| La RPC de alta mínima de cliente (MSF-180) no está en `main` | Verificarla antes de F-SVC-02 (T024 la usa); si cambia de nombre, solo se ajusta `lib/reparaciones.ts`. |
| Carrera en la numeración | Bloqueo transaccional + `unique (empresa_id, numero)` + test de concurrencia. |
| Fuga de costos a roles sin `ver_costos` | Máscara en base (no solo UI) + pgTAP por rol. |
| Cambios simultáneos de estado | `for update` + idempotencia + test. |
| Ampliar la matriz de roles rompe niveles existentes | Migración aditiva con `on conflict do nothing` + pgTAP de regresión. |
| E2E con sesión desactivado en el CI público | Se escribe con omisión sin credenciales (patrón `permisos-por-empresa.e2e.ts`) y se corre local/staging; se anota en el PR. |
| Decisiones abiertas (permisos del Técnico fuera de Service, costos, transiciones) | Provisorias y centralizadas en datos (matriz) o en una sola RPC, fáciles de ajustar. |

## Reversión

Cada migración lleva su reversión en el encabezado (aditiva): `drop` de las funciones y tablas nuevas en orden inverso (`reparacion_historial` → `reparaciones` → `estados_reparacion` → `modelos_equipo`), `delete` de las filas del rol `tecnico` en `permisos_rol`/`permisos_rol_accion`/`roles_organizacion` y restauración de las funciones `private.matriz_*` de `20261013130002`. No se destruye ninguna columna ni tabla en el mismo PR que la crea; deshacer la épica completa es un único `git revert -m 1` del merge commit.
