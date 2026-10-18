# Tareas · Empresas accesibles en el selector y en el filtro de Clientes

**Spec**: `specs/20261018-170000-empresas-accesibles-y-filtro/spec.md`
**Plan**: `specs/20261018-170000-empresas-accesibles-y-filtro/plan.md`
**Rama**: `feat/empresas-accesibles-filtro` → PR contra `dokploy`
**Estado**: todas las tareas cerradas con evidencia.

## Fase 1 · Base de datos

- [x] **T001** Migración aditiva `supabase/migrations/20261018160000_selector_empresas_superadmin.sql`:
  `create or replace private.empresas_accesibles()` con la rama del superadmin (empresas activas de
  `private.organizacion_id()`), `comment on function` y grants repuestos.
  **Evidencia:** migración aplicada en el stack CI en transacción revertida;
  `pnpm test:db:validar-aditivas`.
- [x] **T002** pgTAP `supabase/tests/database/selector_empresas_superadmin.test.sql` (9 aserciones):
  superadmin sin organización activa, con organización activa, aislamiento entre organizaciones,
  activación válida y ajena, y regresión de Administrador y miembro.
  **Evidencia:** `supabase/tests/database/selector_empresas_superadmin.test.sql`.

**Checkpoint 1**: el superadmin lista y activa empresas de su organización activa; el resto no cambia. ✅

## Fase 2 · Contrato web

- [x] **T003** `apps/web/src/hooks/useEmpresasAccesibles.ts`: empresas accesibles por
  `empresas_para_selector()` + `empresaActivaId`, con «última petición gana» y estados de carga/error.
  **Evidencia:** `apps/web/src/hooks/useEmpresasAccesibles.test.tsx`.
- [x] **T004** `apps/web/src/components/clientes/FiltroTienda.tsx`: la lista de empresas pasa a
  `{ id, nombre }` (la columna `activa` ya no aplica).
  **Evidencia:** `components/clientes/FiltroTienda.test.tsx`.

**Checkpoint 2**: el contrato del filtro es el mismo origen que el selector. ✅

## Fase 3 · Pantallas

- [x] **T005** `apps/web/src/pages/clientes/list.tsx`: usa `useEmpresasAccesibles`, inicializa el
  filtro en la empresa activa y la sigue cuando cambia; el chip manda sobre la pantalla.
  **Evidencia:** `pages/clientes/list.test.tsx` (filtro por tienda + sigue la empresa activa),
  `pages/clientes/list.ranking.test.tsx`.
- [x] **T006** `apps/web/src/components/navegacion/SelectorEmpresa.tsx`: la etiqueta de organización
  se muestra sólo al superadmin fuera de una pantalla de empresa; en la ruta de empresa sigue
  navegando.
  **Evidencia:** `components/navegacion/SelectorEmpresa.test.tsx`.

**Checkpoint 3**: la barra superior y el filtro respetan el rol. ✅

## Fase 4 · Pruebas, documentación y cierre

- [x] **T007** Suites afectadas y build.
  **Evidencia:** Vitest (hook + selector + list/ranking) OK; `tsc -b` sin errores; `pnpm build` OK.
- [x] **T008** Documentación: `docs/empresa-activa.md` (superadmin y etiqueta de organización) y
  `docs/clientes.md` (empresas accesibles + sigue la empresa activa); `## Matriz pantalla↔criterios`
  en la spec.
  **Evidencia:** `pnpm docs:check` OK; `pnpm matriz:check` OK.
- [x] **T009** Gates estáticos.
  **Evidencia:** `pnpm lint`, `pnpm estilos:check`, `pnpm test:estilos:sueltos`, `pnpm prototipo:check`.
- [x] **T010** Pull Request contra `dokploy`.
  **Evidencia:** PR contra `dokploy`.

## Verificaciones (salida resumida)

| Comando | Resultado |
|---|---|
| `pnpm --filter @platform/web exec tsc -b` | sin errores |
| pgTAP `selector_empresas_superadmin.test.sql` | 9/9 `ok` |
| `pnpm docs:check` | OK |
| `pnpm matriz:check` | OK |
| `pnpm build` | OK |
