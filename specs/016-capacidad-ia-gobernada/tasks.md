# Tasks: Capacidad de IA gobernada

## Dependencies

`Setup -> Foundational -> US1 -> US2 -> US3 -> Polish`. US1 entrega el núcleo configurable; US2 depende de sus contratos y políticas; US3 depende de las interacciones auditables.

## Phase 1 — Setup

- [X] T001 Crear el paquete interno y sus exports en `packages/ia/src/index.ts` y `packages/ia/package.json`.
- [X] T002 [P] Crear los tipos compartidos de proveedor, contrato, política, interacción y resultado en `packages/ia/src/types.ts`.
- [X] T003 [P] Agregar las rutas y recursos de administración IA en `apps/web/src/App.tsx` y `apps/web/src/providers/accessControlProvider.ts`.

## Phase 2 — Foundational

- [X] T004 Crear migración aditiva de proveedores, credenciales protegidas, perfiles de modelo, modelos descubiertos, contratos, políticas globales, interacciones, eventos y bucket privado `ia-evidencias` en `supabase/migrations/20260920153631_capacidad_ia_gobernada.sql`.
- [X] T005 Implementar RLS, grants mínimos y RPCs `SECURITY DEFINER` del contrato de administración en `supabase/migrations/20260920153631_capacidad_ia_gobernada.sql` y `supabase/migrations/20260920154501_capacidad_ia_runtime.sql`.
- [X] T006 Implementar lectura efímera por runtime autorizado y el script de aprovisionamiento desde configuración ignorada/entorno hacia Vault, sin acceso de Kestra ni `authenticated`, en `supabase/migrations/20260920154501_capacidad_ia_runtime.sql` e `infra/ia/aprovisionar-proveedores.ps1`.
- [X] T007 Crear pruebas pgTAP de esquema, RLS, Vault ID oculto, permisos y aislamiento en `supabase/tests/database/capacidad_ia_gobernada.test.sql`.
- [X] T008 Implementar sanitización, redacción y validación de esquema de contrato en `packages/ia/src/sanitizar.ts` y `packages/ia/src/validarContrato.ts`.
- [X] T009 Crear pruebas Vitest de secretos, datos excluidos y esquemas inválidos en `packages/ia/src/validarContrato.test.ts`.

**Checkpoint:** migración y tests de base verdes; ningún secreto llega a Kestra, UI o logs.

## Phase 3 — User Story 1: Configurar una capacidad reutilizable

**Goal:** el superadmin configura un proveedor cerrado, clave y modelos sin exponer el secreto.

- [X] T010 [US1] Seedear el catálogo cerrado y adaptadores, registrar por proveedor evidencia verificable vigente de cero retención, fecha, vencimiento y superadmin verificador, y rechazar habilitación sin esos campos en `packages/ia/src/proveedores/catalogo.ts`, la migración de T004 y `supabase/tests/database/capacidad_ia_gobernada.test.sql`.
- [X] T011 [P] [US1] Implementar adaptadores de descubrimiento de modelos y su contrato común en `packages/ia/src/proveedores/index.ts`.
- [X] T012 [US1] Implementar descubrimiento y perfiles reutilizables de proveedor+modelo desde claves ya aprovisionadas en Vault en `packages/ia/src/configuracion.ts`.
- [X] T013 [P] [US1] Crear pantallas Refine de proveedor/configuración en `apps/web/src/pages/ia/proveedores.tsx` y `apps/web/src/pages/ia/modelos.tsx`.
- [X] T014 [US1] Crear pruebas de aprovisionamiento, perfiles proveedor+modelo y ausencia de clave en Refine/Kestra/logs en `packages/ia/src/configuracion.test.ts` e `infra/ia/aprovisionar-proveedores.test.ps1`.

**Independent Test:** superadmin carga una clave fixture, descubre modelos y selecciona principal/fallback; administrador no puede leer ni cambiar la configuración.

**Checkpoint:** detenerse tras validar US1.

## Phase 4 — User Story 2: Gobernar contratos y políticas globales

**Goal:** contratos y políticas globales son exclusivos de superadmin.

- [X] T015 [US2] Implementar registro/versionado de contratos y políticas en `packages/ia/src/politicas.ts`.
- [X] T016 [P] [US2] Crear pantallas superadmin de contratos y políticas en `apps/web/src/pages/ia/contratos.tsx` y `apps/web/src/pages/ia/politicas.tsx`.
- [X] T017 [US2] Implementar validación de política activa, límites y perfiles principal/fallback —del mismo u otro proveedor— en `packages/ia/src/ejecutar.ts`.
- [X] T018 [US2] Agregar pruebas pgTAP y Vitest de rechazo por contrato/política y denegación total a administradores de organización en `supabase/tests/database/capacidad_ia_gobernada.test.sql` y `packages/ia/src/ejecutar.test.ts`.

**Independent Test:** superadmin activa una política global y una solicitud fuera de contrato se rechaza antes de invocar proveedor; administrador de organización no puede ver ninguna pantalla ni fila de IA.

**Checkpoint:** detenerse tras validar US2.

## Phase 5 — User Story 3: Auditar y gobernar interacciones

**Goal:** toda interacción queda auditada, tiene fallback seguro, revisión humana y purga.

- [X] T019 [US3] Implementar máquina de estados, presupuesto, fallback y eventos append-only en `packages/ia/src/interacciones.ts`.
- [X] T020 [P] [US3] Implementar evento JSON sanitizado y plantilla de alerta Kestra en `infra/kestra/flows/alertas.yml`.
- [X] T021 [P] [US3] Crear historial y resolución superadmin en `apps/web/src/pages/ia/interacciones.tsx`.
- [X] T022 [US3] Implementar purga idempotente de 90 días en `supabase/migrations/<timestamp>_capacidad_ia_gobernada.sql`.
- [X] T023 [US3] Agregar pruebas de fallback, revisión, purga, RLS y ausencia de secretos en `packages/ia/src/interacciones.test.ts` y `supabase/tests/database/capacidad_ia_gobernada.test.sql`.

**Independent Test:** timeout usa fallback una vez; agotamiento queda sólo para superadmin; purga elimina evidencia y mantiene agregado no sensible.

**Checkpoint:** detenerse tras validar US3.

## Phase 6 — Polish

- [X] T024 Documentar la adopción de futuros consumidores y variables nuevas en `packages/ia/README.md` y `.env.example`.
- [X] T025 Ejecutar `pnpm lint`, `pnpm build`, `pnpm infra:config`, `pnpm test` y `git diff --check` desde la raíz.

## Parallel Opportunities

T002/T003, T010/T011, T013, T016, T020/T021 pueden ejecutarse en paralelo una vez completadas sus dependencias.

## MVP

US1: catálogo, Vault, modelos y consumidor fixture; luego US2 y US3.
