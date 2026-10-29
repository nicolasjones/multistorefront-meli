# Plan de implementación · Clientes habilitados en empresas (tiendas)

**Spec**: `specs/20261018-070000-clientes-empresas/spec.md`
**Alcance**: `refine` + `supabase`
**Rama**: `feat/clientes-empresas` → PR contra `dokploy`

## Contexto técnico

- El prototipo (`design/pantallas/Clientes.dc.html`) ya muestra «Tiendas» en la tabla y
  «Habilitado en» en el diálogo; `ClienteFicha.dc.html` muestra una tarjeta «Tiendas» con switches
  y «Cuenta web» (esta última fuera de alcance, MSF-450).
- `public.clientes` es de la organización (`organizacion_id`) y **no** tenía relación con
  `dominio.empresas`. `buscar_clientes` es `security invoker` y ya devuelve el listado paginado.
- El patrón de relación N:M con escritura solo por RPC existe en `usuarios_empresas` +
  `asignar_empresas_usuario` (`20261016160100_asignar_empresas_usuario.sql`): se reutiliza el
  enfoque (tabla, disparador de pertenencia, RLS de lectura, RPC security definer).

## Principios aplicados

- **I (aislamiento)**: RLS por organización y sección; `anon` sin acceso; validación de pertenencia
  en RPC y disparador.
- **II (especificar antes)**: spec con criterios y matriz de pantalla.
- **III (auditable)**: un único camino de escritura (RPC) y `comment on` de tabla/función; la
  relación no se escribe desde el navegador directamente.
- **VI (panel operable)**: chips accesibles (teclado, `aria-pressed`), responsive por
  `ContenidoAdaptable`, estados de carga/error/vacío existentes.
- **VII (esquemas)**: `clientes_empresas` en `public` (relación transversal de plataforma, igual
  que `usuarios_empresas`); `dominio.empresas` solo se referencia.

## Fases

### Fase 1 · Base de datos

1. Migración aditiva `supabase/migrations/20261021160100_clientes_empresas.sql`:
   tabla, índices, disparador, RLS + grants de lectura, backfill, RPC
   `guardar_empresas_de_cliente` y recreación de `buscar_clientes` con `empresas jsonb`.
2. pgTAP `supabase/tests/database/clientes_empresas.test.sql` (21 aserciones).

### Fase 2 · Contrato web

3. `lib/clientes.ts`: `EmpresaDeCliente`, `FormularioCliente.empresas`, `aFormulario(cliente,
   empresas)`, `aValores` con `empresas`.
4. `hooks/useEmpresasDeCliente.ts`: lectura (`clientes_empresas`) + escritura (RPC).
5. `hooks/useBuscarClientes.ts`: `ClienteListado.empresas`.

### Fase 3 · Pantallas

6. `FormularioCliente`: bloque «Habilitado en» (chips seleccionables, carga/error/vacío, ayuda).
7. `list.tsx`: columna «Tiendas» con chips.
8. `create.tsx`: alta → guardar tiendas (default todas); `edit.tsx`: preselección + reemplazo.
9. `show.tsx`: «Habilitado en» de solo lectura.

### Fase 4 · Pruebas y documentación

10. Vitest del hook nuevo y actualización de `FormularioCliente`, `list`, `edit`, `show` y
    `useBuscarClientes` (fixtures con `empresas`).
11. `docs/clientes.md` § «Relación con empresas / tiendas» + mapa de fidelidad.

## Verificación

En el worktree de VPS2 (`/root/msf-check`, `pnpm install --offline`):

- `pnpm test:web` (Vitest)
- `pnpm test:db:ci` (pgTAP contra el stack CI) — o el job `database` del CI
- `pnpm lint`, `pnpm build`
- `pnpm estilos:check`, `pnpm test:estilos:sueltos`
- `pnpm prototipo:check`, `pnpm matriz:check` (`GITHUB_BASE_REF=dokploy`), `pnpm docs:check`

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| `buscar_clientes` cambia el tipo de retorno | `drop` + `create` con la misma firma de entrada y grants repuestos; los pgTAP existentes no usan `select *` |
| N+1 al listar tiendas | se agregan en la misma RPC con `jsonb_agg` |
| Alta parcial (cliente sin tiendas si falla el 2.º paso) | se registra el error y se navega a la ficha; reintentar el alta duplicaría |
| Backfill masivo | una sola sentencia `insert … select … on conflict do nothing` |
| Filtro por tienda del prototipo | fuera de alcance y documentado; no cambia firmas |
