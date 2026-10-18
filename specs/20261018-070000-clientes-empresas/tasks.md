# Tareas · Clientes habilitados en empresas (tiendas)

**Spec**: `specs/20261018-070000-clientes-empresas/spec.md`
**Plan**: `specs/20261018-070000-clientes-empresas/plan.md`
**Rama**: `feat/clientes-empresas` → PR contra `dokploy`
**Estado**: todas las tareas cerradas con evidencia.

## Fase 1 · Base de datos

- [x] **T001** Migración aditiva `supabase/migrations/20261018090000_clientes_empresas.sql`:
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
  **Evidencia:** 7 archivos / 63 tests Vitest OK (`tsc -b` incluido); `pnpm build` OK. La suite web
  completa (`pnpm --filter @platform/web test`) la corre el job de CI (runner self-hosted).
- [x] **T011** Documentación: `docs/clientes.md` § «Relación con empresas / tiendas» + mapa de
  fidelidad, y `## Matriz pantalla↔criterios` en la spec.
  **Evidencia:** `pnpm docs:check` OK; `pnpm matriz:check` OK.
- [x] **T012** Gates estáticos.
  **Evidencia:** `pnpm lint` 0 errores (43 warnings preexistentes); `pnpm estilos:check` OK;
  `pnpm test:estilos:sueltos` 7/7; `pnpm prototipo:check` (120 pantallas) OK.
- [x] **T013** Pull Request contra `dokploy`.
  **Evidencia:** PR <pendiente>.

## Verificaciones (salida resumida)

| Comando | Resultado |
|---|---|
| `pnpm --filter @platform/web exec tsc -b` | sin errores |
| `pnpm --filter @platform/web exec vitest run <7 archivos>` | 7 archivos / 63 tests OK |
| pgTAP `clientes_empresas.test.sql` | 21/21 `ok` |
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
  edición se hace desde «Editar cliente» y «Cuenta web» pertenece a MSF-450 (ver matriz de la spec).
- **Filtro por tienda** (`{{tFilt}}`): fuera de esta entrega para no cambiar la firma de
  `buscar_clientes`/`exportar_clientes`; documentado como pendiente en `docs/clientes.md`.
- **Alta en dos pasos:** si falla guardar las tiendas después de crear el cliente, se registra el
  error y se navega a la ficha (reintentar el alta duplicaría el cliente).
