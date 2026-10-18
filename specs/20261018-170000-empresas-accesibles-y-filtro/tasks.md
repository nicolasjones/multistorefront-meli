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
  **Evidencia:** PR #149 (https://github.com/nicolasjones/multistorefront-meli/pull/149).

## Fase 5 · «Todas mis empresas» y el parpadeo del menú

- [x] **T011** Migración aditiva `supabase/migrations/20261018170000_empresa_activa_todas.sql`:
  `create or replace private.roles_de_referencia()` (sin empresa activa → mejor rol entre las empresas)
  y RPC `public.usar_todas_las_empresas()`, con `comment` y grants.
  **Evidencia:** `supabase/tests/database/empresa_activa_todas.test.sql`; migración aplicada en el
  stack CI en transacción revertida.
- [x] **T012** pgTAP `supabase/tests/database/empresa_activa_todas.test.sql` (18 aserciones) y ajuste de
  las 3 aserciones de `roles_por_empresa.test.sql` afectadas por «sin empresa activa = mejor rol».
  **Evidencia:** `supabase/tests/database/empresa_activa_todas.test.sql`, `roles_por_empresa.test.sql`.
- [x] **T013** Web: `lib/empresaActiva.ts` (`usarTodasLasEmpresas`), `hooks/useEmpresaActiva.ts`
  (`esTodas`, `cambiarATodas`) y `components/navegacion/SelectorEmpresaActiva.tsx` (opción «Todas mis
  empresas», «Varios»).
  **Evidencia:** `lib/empresaActiva.test.ts`, `components/navegacion/SelectorEmpresaActiva.test.tsx`.
- [x] **T014** Fix del parpadeo: `components/navegacion/SiderPanel.tsx` no se vacía al recargar los
  permisos con permisos ya cargados.
  **Evidencia:** `components/navegacion/SiderPanel.test.tsx` (recarga vs carga inicial).
- [x] **T015** Documentación: `docs/empresa-activa.md` («Todas mis empresas» y el no-parpadeo).
  **Evidencia:** `pnpm docs:check` OK.
- [x] **T016** Gates y PR contra `dokploy`.
  **Evidencia:** PR #150 (https://github.com/nicolasjones/multistorefront-meli/pull/150).

## Verificaciones (salida resumida)

| Comando | Resultado |
|---|---|
| `pnpm --filter @platform/web exec tsc -b` | sin errores |
| `pnpm --filter @platform/web test` (suite completa) | 97 archivos / 824 tests OK |
| pgTAP `selector_empresas_superadmin.test.sql` | 9/9 `ok` |
| pgTAP `empresa_activa_todas.test.sql` | 18/18 `ok` |
| pgTAP `roles_por_empresa.test.sql` | 36/36 `ok` |
| pgTAP `cambiar_empresa_activa.test.sql` | 25/25 `ok` |
| `pnpm lint` | 0 errores (49 avisos preexistentes) |
| `pnpm estilos:check` | OK |
| `pnpm test:estilos:sueltos` | OK |
| `pnpm prototipo:check` | 120 pantallas OK |
| `pnpm docs:check` | OK |
| `pnpm matriz:check` | OK |
| `pnpm build` | OK |
