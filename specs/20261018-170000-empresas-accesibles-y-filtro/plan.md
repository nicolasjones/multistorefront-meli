# Plan de implementación · Empresas accesibles en el selector y en el filtro de Clientes

**Spec**: `specs/20261018-170000-empresas-accesibles-y-filtro/spec.md`
**Alcance**: `refine` + `supabase`
**Rama**: `feat/empresas-accesibles-filtro` → PR contra `dokploy`

## Contexto técnico

- `private.empresas_accesibles()` (20261016140100) resuelve por membresía: Administrador → todas las
  activas de su organización; miembro → las asignadas. El superadmin no tiene membresía → `[]`.
- `private.organizacion_id()` ya devuelve la organización activa del superadmin
  (`superadmin_organizacion_activa`) cuando no hay membresía.
- `private.is_superadmin()` existe desde la fundación; `nivel_seccion`/`puede_accion` ya le dan
  edición sobre la organización activa.
- La web: `useEmpresaActiva` (F-ROL-06) y `list.tsx` de Clientes. Hoy `list.tsx` usa `useEmpresas`
  (`dominio.empresas` por RLS) para la fila «Tienda» y no sigue la activa.
- El prototipo (`AdminHeader.dc.html`) tiene un único botón «Empresa activa»; `Clientes.dc.html`
  inicializa `tFilt` desde `gc_co` (la empresa activa).

## Principios aplicados

- **I (aislamiento)**: la rama del superadmin se acota a `private.organizacion_id()`; el resto queda
  igual.
- **II (especificar antes)**: spec con criterios y matriz de pantalla.
- **VI (panel operable)**: el filtro sigue usando `ToggleButtonGroup` (teclado, `aria-pressed`); sin
  controles nuevos.
- **VII (esquemas)**: `create or replace` de una función `private`; sin tablas nuevas.

## Fases

### Fase 1 · Base de datos

1. Migración aditiva `supabase/migrations/20261021160700_selector_empresas_superadmin.sql`:
   `create or replace private.empresas_accesibles()` con la rama del superadmin + `comment` +
   grants.
2. pgTAP `supabase/tests/database/selector_empresas_superadmin.test.sql` (9 aserciones).

### Fase 2 · Contrato web

3. `hooks/useEmpresasAccesibles.ts`: empresas accesibles vía `empresas_para_selector()` +
   `empresaActivaId` (con «última petición gana»).
4. `components/clientes/FiltroTienda.tsx`: acepta una lista `{ id, nombre }` (sin la columna `activa`).

### Fase 3 · Pantallas

5. `pages/clientes/list.tsx`: usa `useEmpresasAccesibles` y sigue la empresa activa.
6. `components/navegacion/SelectorEmpresa.tsx`: la etiqueta de organización sólo para el superadmin.

### Fase 4 · Pruebas y documentación

7. Vitest: `useEmpresasAccesibles.test.tsx`, `SelectorEmpresa.test.tsx`, `list.test.tsx`,
   `list.ranking.test.tsx`.
8. `docs/empresa-activa.md` (superadmin + etiqueta de organización) y `docs/clientes.md`
   (empresas accesibles + sigue la activa).

### Fase 5 · «Todas mis empresas» y el parpadeo del menú

9. Migración aditiva `supabase/migrations/20261021160800_empresa_activa_todas.sql`:
   `create or replace private.roles_de_referencia()` (sin empresa activa → mejor rol entre las
   empresas) y RPC `public.usar_todas_las_empresas()`.
10. pgTAP `supabase/tests/database/empresa_activa_todas.test.sql` y ajuste de las aserciones de
    `roles_por_empresa.test.sql` afectadas por «sin empresa activa = mejor rol».
11. Web: `lib/empresaActiva.ts` (`usarTodasLasEmpresas`), `hooks/useEmpresaActiva.ts` (`esTodas`,
    `cambiarATodas`) y `components/navegacion/SelectorEmpresaActiva.tsx` (opción «Todas mis empresas»).
12. Fix: `components/navegacion/SiderPanel.tsx` no se vacía al recargar permisos con permisos ya
    cargados.
13. Documentación: `docs/empresa-activa.md`.

## Verificación

En el worktree de VPS2 (`/root/msf-check`, `pnpm install --offline`):

- `pnpm test:web` (Vitest) y `pnpm test:db:ci` (pgTAP contra el stack CI)
- `pnpm lint`, `pnpm build`
- `pnpm estilos:check`, `pnpm test:estilos:sueltos`
- `pnpm prototipo:check`, `pnpm matriz:check` (`GITHUB_BASE_REF=dokploy`), `pnpm docs:check`

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| La rama del superadmin amplía permisos de más | se acota a `private.organizacion_id()` (organización activa) y a empresas `activa`; pgTAP cubre aislamiento |
| El filtro deja de listar una empresa que antes aparecía | es el objetivo: sólo las accesibles; el Administrador sigue viendo todas las de su organización |
| La etiqueta de organización desaparece para un caso legítimo | se conserva para el superadmin y en las pantallas de empresa (`/empresas/edit/:id`) |
| Dos llamadas a `empresas_para_selector()` (selector + filtro) | son ligeras y sólo al montar/cambiar de organización |
