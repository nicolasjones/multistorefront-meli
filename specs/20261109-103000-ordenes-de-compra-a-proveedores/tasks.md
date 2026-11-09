# Tasks: F-PRV-09 · Órdenes de compra a proveedores

**Input**: `specs/20261109-103000-ordenes-de-compra-a-proveedores/` (spec.md, plan.md) · **Épica**: MSF-450 · **Historia**: F-PRV-09 (MSF-454).

**Formato**: `- [ ] T### [F-PRV-09][USx] descripción (FR/SC)`. Cada FR/SC tiene **una sola** tarea dueña.

**Validación por historia**: `pnpm lint`, `pnpm build`, `pnpm test:web` y `pnpm test:db` verdes antes de cerrar la fase.

## Fase 1 — Datos y API (US1)

- [ ] T001 [F-PRV-09][US1] Migración `supabase/migrations/20270114130001_ordenes_compra_tablas.sql`: `dominio.ordenes_compra` (empresa, proveedor, fecha, estado `emitida|recibida|anulada`, observaciones, fecha de recepción, motivo de anulación) y `dominio.ordenes_compra_items` (producto y cantidad), FKs compuestas por organización, checks de estado, RLS por organización y nivel de `stock` (lectura para `authenticated`, sin escritura directa), grants por tabla, `anon` sin privilegios, reversión en el encabezado (FR-001)
- [ ] T002 [P] [F-PRV-09][US1] Migración `supabase/migrations/20270114130100_ordenes_compra_rpc.sql`: `public.crear_orden_compra` (`security definer`, valida empresa activa accesible, proveedor activo de la organización, fecha no futura, permiso `edicion` en `stock`, productos en alerta del proveedor y cantidades > 0) y `public.productos_en_reposicion_de_proveedor` (productos del proveedor en `sin_stock`/`stock_bajo` con `max(1, mínimo − disponible)` como cantidad sugerida), `revoke`/`grant`, reversión en el encabezado (FR-002, FR-003)
- [ ] T003 [P] [F-PRV-09][US2] En la misma migración: `public.listar_ordenes_compra` (paginación y filtro por estado, `security invoker`), `public.detalle_orden_compra` (cabecera y líneas, `security invoker`) y `public.cambiar_estado_orden_compra` (`emitida` → `recibida` con fecha / `anulada` con motivo; idempotente, estados terminales sin cambio) (FR-004, FR-005, FR-006)

## Fase 2 — Pantalla (US1 + US2)

- [ ] T004 [F-PRV-09][US1] `apps/web/src/lib/ordenesCompra.ts`: tipos, validación del formulario (empresa, proveedor, fecha no futura, cantidades), suggested de cantidad y mapeo de errores de la base a mensajes claros, con `ordenesCompra.test.ts` (FR-002, FR-003)
- [ ] T005 [P] [F-PRV-09][US1] `apps/web/src/hooks/useOrdenesCompra.ts`: listado paginado con filtro de estado, carga de productos en reposición del proveedor, alta y cambio de estado (FR-002, FR-004, FR-005, FR-006)
- [ ] T006 [P] [F-PRV-09][US1] `apps/web/src/components/stock/OrdenCompraFormDialog.tsx`: diálogo «Nueva orden de compra» (empresa con la empresa activa por omisión, proveedor, fecha, productos en alerta con cantidad sugerida editable, observaciones), estados compartidos y foco (FR-002, FR-003, FR-008)
- [ ] T007 [P] [F-PRV-09][US2] `apps/web/src/components/stock/OrdenCompraDetalleDialog.tsx`: detalle de la orden (cabecera y líneas) con las acciones «Marcar como recibida» y «Anular» (motivo) solo con `edicion` en `stock` (FR-005, FR-006)
- [ ] T008 [F-PRV-09][US2] `apps/web/src/pages/stock/ordenes-compra.tsx`: pantalla «Órdenes de compra» con filtro de estado y de empresa (`FiltroEmpresa`), tabla adaptable (fecha, proveedor, empresa, estado, unidades), paginación, «Nueva orden», estados vacío/carga/error (FR-004, FR-007, FR-008)
- [ ] T009 [P] [F-PRV-09][US2] Ruta y navegación: recurso `ordenes-compra` en `apps/web/src/App.tsx` (`/stock/ordenes-compra`), pestaña «Órdenes de compra» en `PestanasStock` y entrada de menú en `destinosPanel.ts` (sección `stock`) (FR-007)
- [ ] T010 [F-PRV-09][US2] Vitest de la pantalla y del diálogo: validación, error de la base, filtro y paginación, acciones por rol, reencuadre al cambiar de empresa (SC-002)

## Fase 3 — Cierre de la historia

- [ ] T011 [F-PRV-09][US1] pgTAP `supabase/tests/database/ordenes_compra.test.sql`: aislamiento entre organizaciones, permisos por rol, los tres estados y sus transiciones, rechazo de datos inválidos, sin escritura directa ni `delete`, `anon` sin privilegios (SC-001)
- [ ] T012 [F-PRV-09][US1] E2E `apps/web/e2e/ordenes-compra.e2e.ts`: recorrido de alta desde el listado de reposición y seguimiento, con rótulo `[MSF-454:…]` (SC-003)
- [ ] T013 [F-PRV-09][US1] Documentación: `docs/ordenes-compra.md` (modelo, permisos, estados, vínculo pendiente con el ingreso de mercadería, reversión) y registro de la historia en `docs/cuentas-y-compras-a-proveedores.md`; enlace en `docs/stock.md` (FR-009)
- [ ] T014 [F-PRV-09][US1] Gates: `pnpm lint`, `pnpm build`, `pnpm docs:check`, `pnpm matriz:check`, `pnpm prototipo:check` y `pnpm test:db` verdes (SC-001, SC-003)

**Checkpoint F-PRV-09**: `pnpm lint`, `pnpm build`, `pnpm test:web` y `pnpm test:db` verdes.
