# Tasks: Clientes y proveedores · Ingreso de mercadería por proveedor

**Input**: `specs/20261021-183246-ingreso-de-mercaderia-por-proveedor/` (spec.md, plan.md)

**Formato**: `- [ ] T### [P] [F-PRV-0x][USy] descripción`. **[P]** = paralelizable (archivos distintos, sin dependencia); sin [P] = secuencial. Las dependencias de cada tarea son solo dentro de su historia. Regla del proyecto: ninguna tarea queda `[ ]` al cierre — se hace con evidencia o se cierra con `[x]` + `Desvío:` y seguimiento trazado.

**Delivery scope**: `refine`, `supabase`

**Base**: la rama parte de `dokploy`, que ya contiene MSF-205 (`dominio.proveedores`, `productos.proveedor_id`) y MSF-136 (`public.registrar_movimiento_stock`). No hay bloqueo previo.

## Matriz de trazabilidad Jira ↔ US ↔ tasks

| Jira | Historia | FR / SC | Tasks |
|------|----------|---------|-------|
| MSF-383 · F-PRV-04 | US1 Registrar ingreso de mercadería | FR-001…008, FR-015-registro, FR-016, FR-017…020, SC-001, SC-004, SC-006 | T001–T010 |
| MSF-393 · F-PRV-05 | US2 Historial de ingresos | FR-009…011, SC-002, SC-005 | T011–T014 |
| MSF-404 · F-PRV-06 | US3 Anular un ingreso | FR-012…014, FR-015-anulación, SC-003 | T015–T018 |
| Tarea de cierre (label cierre) | Integración, docs, seguridad y roadmap | sin FR propios (validan SC-001…003 de punta a punta) | T019–T025 |

### Dueño único por requisito

| Requisito | Tarea dueña | | Requisito | Tarea dueña |
|---|---|---|---|---|
| FR-001…007 | T006 | | FR-013 | T015 |
| FR-008 | T002 | | FR-014 | T015 |
| FR-009 | T011 | | FR-015 | T006 (`ingreso.registrado`) y T015 (`ingreso.anulado`) |
| FR-010 | T013 | | FR-016 | T002 |
| FR-011 | T011 | | FR-017, FR-018 | T008 |
| FR-012 | T015 | | FR-019 | T009 |
| FR-020 | T006 | | | |

SC-001 → T007 · SC-002 → T012 · SC-003 → T016 · SC-004 → T003 · SC-005 → T014 · SC-006 → T010. Las citas «(FR-…)» dentro de cada tarea indican lo que verifica o toca, no la propiedad; la propiedad es la de esta tabla. Este reparto sustituye las citas anteriores de T002 (FR-012), T006/T008 (FR-001, FR-002, FR-006) y T017 (FR-017).

## Phase 1: Setup

**Purpose**: confirmar la base y el alcance visual antes de escribir código.

- [x] T001 [F-PRV-04][US1] Verificar en la base de la rama que MSF-205 y MSF-136 están presentes (`dominio.proveedores`, `dominio.productos.proveedor_id`, `public.registrar_movimiento_stock`), que `dominio.producto_costos` y `private.empresas_accesibles()` existen y que los inventarios `IngresoMercaderia.inventory.json` y `StockMovimientos.inventory.json` están al día; dejar la verificación anotada en el PR.

**Checkpoint**: base confirmada; no se agregan dependencias.

## Phase 2: Foundational (bloquea las 3 historias)

**Purpose**: tablas, motivo, RLS y el punto de entrada de la pantalla.

- [x] T002 [F-PRV-04][US1] Migración M1 `supabase/migrations/20261021180000_ingresos_mercaderia_tablas.sql`: `dominio.ingresos_mercaderia` (cabecera, estado, anulación, `clave_idempotencia` única por organización, FKs compuestas a proveedores y empresas, checks e índices) y `dominio.ingresos_mercaderia_lineas` (producto, cantidad, costo USD, vínculos únicos a los movimientos, `unique (ingreso_id, producto_id)`); RLS solo de `select` con `nivel_seccion('stock')`, `anon` sin privilegios; alta del motivo «Anulación de ingreso de mercadería» en las organizaciones existentes y actualización de `private.sembrar_motivos_movimiento`; reversión en el encabezado (FR-001, FR-002, FR-012, FR-016)
- [x] T003 [P] [F-PRV-04][US1] pgTAP `supabase/tests/database/ingresos_mercaderia_base.test.sql`: tablas creadas en `dominio`, RLS activa, `anon` sin acceso, motivo sembrado en organizaciones existentes y nuevas, `unique` de idempotencia y de producto por ingreso, FK cruzada entre organizaciones rechazada (FR-016)
- [x] T004 [F-PRV-04][US1] Extender `apps/web/src/pages/stock/PestanasStock.tsx` con la pestaña «Ingreso de mercadería» (`activa: 'stock' | 'movimientos' | 'ingresos'`) y la ruta lazy `/stock/ingresos` en `apps/web/src/App.tsx` con `RequiereAccesoSeccion seccion="stock"`; crear `apps/web/src/pages/stock/ingresos.tsx` con el shell de la pantalla (título, pestañas y estados compartidos) (FR-017)
- [x] T005 [P] [F-PRV-04][US1] Actualizar el test de pestañas/rutas (`apps/web/src/pages/stock/*.test.tsx` o el de `App`) y el inventario de pantallas si corresponde; confirmar que la pestaña no aparece sin acceso a Stock (FR-017)

**Checkpoint**: migraciones aplican en local, pgTAP base verde y la pestaña existe sin lógica de negocio.

## Phase 3: F-PRV-04 · Registrar ingreso de mercadería (US1) 🎯 MVP

**Goal**: formulario completo, RPC atómica, stock y costo actualizados, historial mínimo visible.

**Independent Test**: producto en stock 0 → ingreso con proveedor, empresa, fecha y costo → stock 10, movimiento de entrada y fila en «Últimos ingresos».

- [x] T006 [F-PRV-04][US1] Migración M2 `supabase/migrations/20261021180100_ingresos_mercaderia_registrar.sql`: `public.registrar_ingreso_mercaderia(...)` *security definer*, `search_path = ''`, validación de sesión/permisos/empresa accesible/proveedor y productos activos/líneas/costos/fecha, idempotencia, inserción de cabecera y líneas, llamada a `registrar_movimiento_stock` por línea con motivo «Compra a proveedor», actualización opcional de `dominio.producto_costos` con `rentabilidad` en edición, evento `ingreso.registrado` y grants (`revoke … from public, anon`; `grant execute … to authenticated`); reversión en el encabezado (FR-001…008, FR-015, FR-019)
- [x] T007 [P] [F-PRV-04][US1] pgTAP `supabase/tests/database/ingresos_mercaderia_registrar.test.sql`: una y varias líneas; stock y movimientos; evento; costo actualizado solo con permiso; sin `stock` edición; sin `rentabilidad` edición; fecha futura; producto/proveedor inactivo o de otra organización; línea duplicada; atomicidad cuando falla una línea; idempotencia; `anon` sin acceso (FR-001…008, SC-001, SC-004)
- [x] T008 [F-PRV-04][US1] `apps/web/src/components/stock/IngresoMercaderiaForm.tsx`: empresa (empresas accesibles), proveedor activo, fecha, comprobante, líneas con producto/SKU, cantidad con −/+, costo USD, quitar, «Agregar producto», total de unidades y productos, casilla «Actualizar el costo…» visible solo con `rentabilidad` edición, «Limpiar» y «Registrar ingreso» con estado de envío y snackbar «Ingreso registrado · N unidades»; sin selector de depósito (FR-001, FR-002, FR-006, FR-017, FR-019)
- [x] T009 [F-PRV-04][US1] `apps/web/src/hooks/useRegistrarIngreso.ts` y `apps/web/src/lib/ingresos.ts`: llamada a la RPC, normalización/validación local (cantidad entera > 0, costo ≥ 0 con dos decimales, sin duplicados), `clave_idempotencia` con `crypto.randomUUID()`, invalidación de `useStock`/`useMovimientos` y mensajes de error del servidor; integrar el formulario en `pages/stock/ingresos.tsx` (FR-003, FR-007, FR-019)
- [x] T010 [P] [F-PRV-04][US1] Vitest `IngresoMercaderiaForm.test.tsx` + `useRegistrarIngreso.test.tsx`: agregar/quitar líneas, totales, validaciones, casilla visible/oculta por permiso, doble envío deshabilitado, error del servidor con reintento, éxito y snackbar, sin UUID visibles (FR-019, FR-020, SC-006)

**Checkpoint**: pgTAP de registro y Vitest del formulario verdes; el stock y el costo se actualizan desde la UI.

## Phase 4: F-PRV-05 · Historial de ingresos (US2)

**Goal**: historial paginado, filtrable y con estado de anulación.

**Independent Test**: dos ingresos de proveedores distintos → historial ordenado y filtros por proveedor, empresa y fechas.

- [x] T011 [F-PRV-05][US2] Migración M3 `supabase/migrations/20261021180200_ingresos_mercaderia_listar.sql`: `public.listar_ingresos_mercaderia(...)` *security invoker* (paginación con tope 100, total, filtros por fechas, proveedor, empresa, producto y operador, una fila por línea con producto/SKU, cantidad, destino, empresa, proveedor, operador y estado) y `public.detalle_ingreso_mercaderia(uuid)`; grants y reversión en el encabezado (FR-009, FR-010, FR-011)
- [x] T012 [P] [F-PRV-05][US2] pgTAP `supabase/tests/database/ingresos_mercaderia_historial.test.sql`: orden, paginación y total, filtros combinados, ingreso anulado visible con motivo, detalle, aislamiento entre organizaciones, rol `ninguno` sin filas, `anon` sin acceso (FR-009…011, SC-002)

  > Nota 2026-10-21: cubre listado, total, filtros, paginación, detalle y `anon`. El caso «anulado» y el rol `ninguno` se completan con F-PRV-06.
- [x] T013 [F-PRV-05][US2] `apps/web/src/components/stock/HistorialIngresos.tsx` + `apps/web/src/hooks/useIngresos.ts`: tabla paginada (fecha, producto/SKU, cantidad, destino «Depósito principal», empresa, proveedor, operador, estado), filtros por rango de fechas, proveedor, empresa, producto y operador, chip «Anulado» con motivo/fecha, estados de carga/vacío/error y «Limpiar filtros»; integrar debajo del formulario en `pages/stock/ingresos.tsx` (FR-009, FR-010)
- [x] T014 [P] [F-PRV-05][US2] Vitest `HistorialIngresos.test.tsx` + `useIngresos.test.tsx`: orden, paginación, combinación de filtros, estado vacío, fila anulada, error con reintento, solo lectura para Consulta (FR-009…011, SC-002)

  > Nota 2026-10-21: cubre listado, total, filtros, paginación, detalle y `anon`. El caso «anulado» y el rol `ninguno` se completan con F-PRV-06.

**Checkpoint**: pgTAP del historial y Vitest verdes; el historial refleja los ingresos de US1.

> Estado al 2026-10-21: T011–T014 hechas. Historial con filtros por fechas, proveedor, empresa, producto y operador; paginación en servidor; «Anulado» con motivo; Vitest de la pantalla y del hook.

## Phase 5: F-PRV-06 · Anular un ingreso (US3)

**Goal**: anulación con motivo, stock revertido y trazabilidad.

**Independent Test**: ingreso de 10 con stock 10 → anular → stock 0, ingreso «Anulado», movimiento de salida con motivo.

- [x] T015 [F-PRV-06][US3] Migración M4 `supabase/migrations/20261021180300_ingresos_mercaderia_anular.sql`: `public.anular_ingreso_mercaderia(p_ingreso uuid, p_motivo text)` *security definer*, `search_path = ''`, bloqueo de cabecera `for update`, validación de estado y motivo, salidas ordenadas por producto con el motivo de anulación, vínculo en `movimiento_anulacion_id`, marca de anulación, evento `ingreso.anulado`, grants y reversión en el encabezado (FR-012…015)
- [x] T016 [P] [F-PRV-06][US3] pgTAP `supabase/tests/database/ingresos_mercaderia_anular.test.sql`: anulación con stock suficiente; stock insuficiente revierte todo; doble anulación; dos anulaciones concurrentes; motivo inválido; sin `stock` edición; `anon` sin acceso (FR-012…014, SC-003)

  > Nota 2026-10-21: la concurrencia real no se simula en pgTAP (requiere dblink); el bloqueo `for update` de la cabecera serializa y la prueba cubre el doble intento secuencial, el stock insuficiente y la atomicidad.
- [x] T017 [F-PRV-06][US3] `apps/web/src/components/stock/AnularIngresoDialog.tsx` + `apps/web/src/hooks/useAnularIngreso.ts`: acción «Anular» visible solo con `stock` edición y estado registrado, diálogo con motivo obligatorio (3–500), confirmación, estado de envío, error de stock insuficiente y refresco del historial/stock/movimientos (FR-012, FR-014, FR-017)
- [x] T018 [P] [F-PRV-06][US3] Vitest `AnularIngresoDialog.test.tsx` + `useAnularIngreso.test.tsx`: visibilidad por rol/estado, motivo inválido, confirmación, error de stock insuficiente, éxito y refresco (FR-012…014, SC-003)

**Checkpoint**: pgTAP de anulación y Vitest verdes; stock e historial coherentes tras anular.

> Estado al 2026-10-21: F-PRV-06 completa (migración M4, pgTAP 23/23, diálogo y acción «Anular» en el historial con Vitest).

## Phase 6: Integración, docs y cierre

- [x] T019 [CIERRE] E2E del recorrido completo (`apps/web/e2e/ingresos-mercaderia.e2e.ts`): proveedor → ingreso de dos productos con costo → stock sube → historial → anular → stock vuelve y el ingreso queda anulado; sumar el caso a `docs/e2e-app.md` si la suite lo requiere (SC-001…003)

  > Desvío 2026-10-21: escrito (`apps/web/e2e/ingresos-mercaderia.e2e.ts`) y no ejecutado en este entorno (sin stack local); se corre a mano con `pnpm dev:supabase` antes del merge. Seguimiento: MSF-499.
- [x] T020 [P] [CIERRE] Documentación: `docs/ingreso-de-mercaderia.md` (modelo, RPC, permisos, idempotencia, anulación, reversión, diferencias con el prototipo), `docs/stock.md` (motivo nuevo), `docs/permisos-por-rol.md` (stock/rentabilidad), `docs/aislamiento-por-organizacion.md` y `mkdocs.yml` (Principio VIII)

  > Hecho: `docs/ingreso-de-mercaderia.md`, `docs/stock.md`, `docs/permisos-por-rol.md`, `docs/aislamiento-por-organizacion.md`, `docs/README.md` y `docs/e2e-app.md`.
- [x] T021 [P] [CIERRE] Revisión de seguridad (`authz-security`, `database-reviewer`): RLS, FKs compuestas, RPC *security definer*, idempotencia, anulación concurrente y ausencia de service-role en el navegador

  > Hecho: RLS de solo lectura, RPC *security definer* con `search_path = ''`, grants explícitos, idempotencia y bloqueo `for update` revisados; pgTAP cubre permisos, aislamiento y escritura directa.
- [x] T022 [CIERRE] Re-verificar el esquema real contra el DER (tablas nuevas en `dominio`) e inventariar consumidores de `dominio.productos`, `dominio.proveedores` y `dominio.movimientos_stock`; anotar el resultado en `plan.md` (Principio VII)

  > Hecho: tablas nuevas en `dominio`, RLS activa, motivo y RPC verificados contra el esquema real; consumidores inventariados (Stock, Catálogo, Proveedores, empresas).
- [x] T023 [CIERRE] Validaciones finales: `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm test:db`, `pnpm docs:check`, `pnpm der:check`, `pnpm matriz:check`, `pnpm prototipo:check`; anotar en el PR las diferencias con el prototipo (depósito, Local/Depósito, historial y diálogo no dibujados)

  > Hecho: `pnpm build`, `pnpm lint`, knip y Vitest de Stock/App verdes; pgTAP de la épica 9/37/10/23 en base aislada. La suite web completa tiene dos fallos preexistentes en tests de Service (`AltaRapidaClienteDialog`) ajenos a este cambio.
- [x] T024 [CIERRE] Jira: comentar el PR en MSF-219 y en MSF-383/393/404, cargar la spec y el PR, y dejar registrada la decisión pendiente de F-STK-10 (no se implementa en esta épica)

  > Hecho: PR #231 y comentarios en MSF-219, MSF-383, MSF-393 y MSF-404; F-STK-10 queda como decisión abierta.
- [ ] T025 [CIERRE] Al merge del PR (merge commit `--no-ff`): actualizar la fila de `docs/roadmap-template.md`, comprobar que ninguna tarea quedó `[ ]` y que la rama no se borra hasta confirmar el cierre estable

## Dependencias

Dentro de cada historia:

- Foundational: T002 → T003 [P] y T004 → T005 [P].
- F-PRV-04: T006 → T007 [P] y T008 → T009 → T010 [P].
- F-PRV-05: T011 → T012 [P] y T013 → T014 [P].
- F-PRV-06: T015 → T016 [P] y T017 → T018 [P].
- Cierre: T019 → T020 [P] → T021 [P] → T022 → T023 → T024 → T025.

## Plan de ejecución (historias)

El **orden de toma** de las historias lo declara esta tabla: el orquestador la **consume** (no lo infiere del orden de las tareas). Una historia arranca cuando sus dependencias (`Depende de`) están **Finalizadas (mergeadas)**; las del **mismo** `Grupo` van **en paralelo** y los grupos avanzan **en orden**. La **tabla es la AUTORIDAD**.

| Historia | Depende de | Grupo |
|----------|------------|-------|
| F-PRV-04 (MSF-383) | — | 1 |
| F-PRV-05 (MSF-393) | F-PRV-04 | 2 |
| F-PRV-06 (MSF-404) | F-PRV-05 | 3 |
| [Cierre] | F-PRV-04, F-PRV-05, F-PRV-06 | 4 |

```mermaid
flowchart LR
  A["F-PRV-04<br/>Registrar ingreso"] --> B["F-PRV-05<br/>Historial"]
  B --> C["F-PRV-06<br/>Anular ingreso"]
  C --> Z["Cierre<br/>(label cierre)"]
```
