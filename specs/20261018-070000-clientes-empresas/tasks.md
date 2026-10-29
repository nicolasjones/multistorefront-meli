# Tareas · Clientes habilitados en empresas (tiendas)

**Spec**: `specs/20261018-070000-clientes-empresas/spec.md`
**Plan**: `specs/20261018-070000-clientes-empresas/plan.md`
**Rama**: `feat/clientes-empresas` → PR contra `dokploy` (Fase 5: `feat/clientes-filtro-tienda`) 
**Estado**: todas las tareas cerradas con evidencia.

## Fase 1 · Base de datos

- [x] **T001** Migración aditiva `supabase/migrations/20261021160100_clientes_empresas.sql`:
  tabla `public.clientes_empresas` (PK compuesta, FKs en cascada, índices), disparador de
  pertenencia, RLS + grants de lectura, backfill, RPC `guardar_empresas_de_cliente` y recreación de
  `buscar_clientes` con `empresas jsonb`.
  **Evidencia:** migración aplicada en el stack CI dentro de una transacción revertida (sin dejar
  estado); `pnpm test:db:validar-aditivas` 5/5.
- [x] **T002** pgTAP `supabase/tests/database/clientes_empresas.test.sql` (21 aserciones): RPC
  (alta/reemplazo/vacío/null/repetidos), permisos por rol (`edicion`/`lectura`/`ninguno`),
  aislamiento entre organizaciones, disparador, PK y `anon`.
  **Evidencia:** corrida contra el stack CI → `1..21`, 21 `ok`, 0 `not ok`.

**Checkpoint 1**: la migración aplica y RPC/RLS/`buscar_clientes` responden. ✅

## Fase 2 · Contrato web

- [x] **T003** `apps/web/src/lib/clientes.ts`: `EmpresaDeCliente`, `empresas` en
  `FormularioCliente`, `aFormulario(cliente, empresas)` y `aValores` con `empresas` fuera de las
  columnas de `clientes`.
  **Evidencia:** `apps/web/src/lib/clientes.test.ts` 6/6.
- [x] **T004** `apps/web/src/hooks/useEmpresasDeCliente.ts`: `useEmpresasDeCliente` (lectura con
  «última petición gana») y `useGuardarEmpresasDeCliente` (RPC).
  **Evidencia:** `useEmpresasDeCliente.test.tsx` 6/6.
- [x] **T005** `apps/web/src/hooks/useBuscarClientes.ts`: `ClienteListado.empresas`.
  **Evidencia:** `useBuscarClientes.test.tsx` 6/6; `pnpm --filter @platform/web exec tsc -b` sin
  errores.

**Checkpoint 2**: el navegador lee y escribe el contrato. ✅

## Fase 3 · Pantallas

- [x] **T006** `FormularioCliente`: bloque «Habilitado en» con chips seleccionables
  (`aria-pressed`, teclado), estados de carga/error/vacío y texto de ayuda.
  **Evidencia:** `FormularioCliente.test.tsx` (incluye selección y `empresas` en el payload).
- [x] **T007** `pages/clientes/list.tsx`: columna «Tiendas» con chips y `—` sin tiendas.
  **Evidencia:** `pages/clientes/list.test.tsx` (columna y chips).
- [x] **T008** `pages/clientes/create.tsx` (default todas + guardar relación) y
  `pages/clientes/edit.tsx` (preselección + reemplazo).
  **Evidencia:** `pages/clientes/edit.test.tsx` (`guardar('c-1', ['e-1'])`); `tsc -b` sin errores.
- [x] **T009** `pages/clientes/show.tsx`: «Habilitado en» de solo lectura.
  **Evidencia:** `pages/clientes/show.test.tsx`.

**Checkpoint 3**: listado, formulario y ficha muestran la relación. ✅

## Fase 4 · Pruebas, documentación y cierre

- [x] **T010** Suites afectadas y build.
  **Evidencia:** 7 archivos / 63 tests Vitest OK (con `tsc -b`); suite web completa
  `pnpm --filter @platform/web test` → 89 archivos / 754 tests OK; `pnpm build` OK.
- [x] **T011** Documentación: `docs/clientes.md` § «Relación con empresas / tiendas» + mapa de
  fidelidad, y `## Matriz pantalla↔criterios` en la spec.
  **Evidencia:** `pnpm docs:check` OK; `pnpm matriz:check` OK.
- [x] **T012** Gates estáticos.
  **Evidencia:** `pnpm lint` 0 errores (43 warnings preexistentes); `pnpm estilos:check` OK;
  `pnpm test:estilos:sueltos` 7/7; `pnpm prototipo:check` (120 pantallas) OK.
- [x] **T013** Pull Request contra `dokploy`.
  **Evidencia:** PR #139 (https://github.com/nicolasjones/multistorefront-meli/pull/139).

## Fase 5 · Filtro por tienda (F-CLI-11)

- [x] **T014** Migración aditiva `supabase/migrations/20261021160600_clientes_filtro_por_tienda.sql`:
  `p_empresa_id uuid default null` en `buscar_clientes`, `exportar_clientes` y `ranking_clientes`
  (filtro `exists` sobre `public.clientes_empresas`), con grants, comentarios y reversión
  documentados; recreación por cambio de firma.
  **Evidencia:** migración aplicada en el stack CI en transacción revertida; `pnpm test:db:validar-aditivas`.
- [x] **T015** pgTAP `supabase/tests/database/clientes_filtro_tienda.test.sql` (16 aserciones):
  filtro por tienda en listado, exportación y ranking; combinación con tipo y texto; cliente sin
  tienda excluido; tienda de otra organización sin filas (RLS); privilegios de las firmas nuevas.
  **Evidencia:** `supabase/tests/database/clientes_filtro_tienda.test.sql` → `ok` en la suite pgTAP
  completa (63 archivos / 1738 aserciones, `Result: PASS`).
- [x] **T016** Web: `components/clientes/FiltroTienda.tsx` (fila «Tienda»), `empresaId` en
  `useBuscarClientes`/`useRankingClientes`/`exportarClientes`, y `pages/clientes/list.tsx`
  aplicándolo al listado, al ranking y a la exportación.
  **Evidencia:** `components/clientes/FiltroTienda.test.tsx`, `pages/clientes/list.test.tsx`,
  `components/clientes/RankingClientes.test.tsx`, `lib/exportarClientes.test.ts`,
  `lib/exportarRanking.test.ts`.
- [x] **T017** Documentación: `docs/clientes.md` (relación, ranking, reversión) y `spec.md`
  (US5, FR-009, matriz pantalla↔criterios).
  **Evidencia:** `pnpm docs:check` OK; `pnpm matriz:check` OK.
- [x] **T018** Gates estáticos y build.
  **Evidencia:** `tsc -b` (sin errores), `pnpm lint` (0 errores; 47 avisos preexistentes), `pnpm build`
  (OK), `pnpm estilos:check`, `pnpm prototipo:check` (120 pantallas), `pnpm matriz:check`,
  `pnpm docs:check` (base `dokploy`), `pnpm test:db:validar-aditivas` (5/5) — todo OK.
- [x] **T019** Pull Request contra `dokploy`.
  **Evidencia:** PR #143 → `dokploy`, merge commit `cae5bc6`; CI (changes, application, database,
  web 1/2/3) verde; dev reconstruido (bundle `index-GD1G1Whq.js` con «Todas las tiendas») y migración
  `20261021160600` aplicada a la base dev.

## Verificaciones (salida resumida)

| Comando | Resultado |
|---|---|
| `pnpm --filter @platform/web exec tsc -b` | sin errores |
| `pnpm --filter @platform/web exec vitest run <7 archivos>` | 7 archivos / 63 tests OK |
| `pnpm --filter @platform/web test` (suite completa) | 96 archivos / 812 tests OK |
| pgTAP `clientes_empresas.test.sql` | 21/21 `ok` |
| pgTAP `clientes_filtro_tienda.test.sql` | 16/16 `ok` |
| pgTAP suite completa (`pg_prove supabase/tests/database/*.sql`) | 63 archivos / 1738 tests `PASS` |
| `pnpm test:db:validar-aditivas` | 5/5 |
| `pnpm lint` | 0 errores |
| `pnpm estilos:check` | OK |
| `pnpm test:estilos:sueltos` | 7/7 |
| `pnpm prototipo:check` | 120 pantallas OK |
| `pnpm docs:check` | OK |
| `pnpm matriz:check` | OK |
| `pnpm build` | OK |

## Desvíos

- **Ficha:** el prototipo muestra la tarjeta «Tiendas» con switches en línea y el estado de
  «Cuenta web» por tienda. Se muestra la relación como chips de solo lectura («Habilitado en»); la
  edición se hace desde «Editar cliente» y «Cuenta web» pertenece a MSF-450 (ver matriz de la spec,
  ver commit ad92b62).
- **Filtro por tienda** (`{{tFilt}}`): se implementó en la Fase 5 (F-CLI-11) tras cerrarse la
  entrega original para no cambiar la firma de `buscar_clientes`/`exportar_clientes`; el desvío
  original quedó resuelto (ver commit ad92b62 y la Fase 5).
- **Alta en dos pasos:** si falla guardar las tiendas después de crear el cliente, se registra el
  error y se navega a la ficha (reintentar el alta duplicaría el cliente; ver commit ad92b62).
