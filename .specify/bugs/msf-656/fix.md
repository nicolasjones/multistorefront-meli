# Bug Fix: RLS de comprobantes, líneas, RMA e ítems por empresas accesibles

- **Slug**: msf-656
- **Fixed**: 2026-11-01
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Las políticas `SELECT` de `dominio.comprobantes_venta`, `dominio.comprobantes_venta_lineas`, `dominio.rma` y
`dominio.rma_items` filtraban solo por organización y por la sección `ventas`: una persona limitada a una tienda
leía por `/rest/v1/` los comprobantes, las líneas y las devoluciones de las otras tiendas de su organización
(causa de fondo de MSF-632). Se reemplazan esas cuatro políticas por unas equivalentes que agregan el segundo
eje de aislamiento —la empresa accesible (`private.empresas_accesibles()`)—, igual que ya hacían
`cobros_comprobante`, `formas_pago`, `contrarreembolsos` y `historial_comprobantes`.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `supabase/migrations/20270122100000_rls_empresas_rma_comprobantes.sql` | added | Reemplaza las cuatro políticas `SELECT` (drop + create). Sin cambios de tabla ni de esquema. |
| `supabase/tests/database/rls_empresas_rma_comprobantes.test.sql` | added test | pgTAP: persona de una sola tienda, administrador y otra organización (17 aserciones). |
| `docs/ventas-comprobantes.md` | modified | El RLS vigente del comprobante y de sus líneas incluye la empresa accesible. |
| `docs/ventas-rma-devoluciones.md` | modified | El RLS vigente de `rma`/`rma_items` incluye la empresa accesible (las líneas la heredan del RMA). |

## Diff Highlights

```sql
-- comprobantes_venta: la cabecera filtra por empresa accesible
    and (empresa_id is null or empresa_id in (select private.empresas_accesibles()))

-- comprobantes_venta_lineas: la línea hereda la empresa de su comprobante
    and exists (
      select 1 from dominio.comprobantes_venta c
      where c.id = comprobante_id
        and c.organizacion_id = comprobantes_venta_lineas.organizacion_id
        and (c.empresa_id is null or c.empresa_id in (select private.empresas_accesibles()))
    )

-- rma: la cabecera filtra por empresa accesible
    and empresa_id in (select private.empresas_accesibles())

-- rma_items: el ítem hereda la empresa de su RMA
    and exists (
      select 1 from dominio.rma r
      where r.id = rma_id
        and r.organizacion_id = rma_items.organizacion_id
        and r.empresa_id in (select private.empresas_accesibles())
    )
```

## Tests Added or Updated

- `supabase/tests/database/rls_empresas_rma_comprobantes.test.sql` — fija el arreglo:
  1. las cuatro políticas `SELECT` filtran por `private.empresas_accesibles()` (si alguien revierte la migración, la prueba falla);
  2. persona con acceso solo a la Tienda A: no ve el RMA, sus ítems, las líneas ni los comprobantes de la Tienda B;
  3. la misma persona ve su propia tienda y el comprobante heredado sin empresa;
  4. administrador: ve las dos tiendas y el comprobante heredado;
  5. otra organización: no ve nada.

## Local Verification

- Comandos ejecutados:
  - `pnpm db:validar:aditivas` → `420 migraciones verificadas en supabase/migrations: ninguna destructiva sin camino de reversión documentado.`
  - `pnpm docs:check` → OK con la base del PR (`GITHUB_BASE_REF=main`, como en el CI); con la base por omisión `HEAD~1` depende de que el último commit toque `docs/`. `pnpm docs:check` también imprime `Migraciones OK: 420 archivo(s), 1 nuevo(s) contra origin/dokploy.`
  - `pnpm lint` → sin errores (no se tocan archivos de `apps/web`).
  - `pnpm build` → sin errores.
  - `pnpm calidad` → oxlint, knip, jscpd, dependency-cruiser y syncpack en ok; **gitleaks no se pudo correr** (sin binario ni Docker) y la herramienta lo informa como «hallazgos» (exit 1); se re-ejecuta en el CI.
- Revisión manual: se relevaron los 40 pgTAP que leen `dominio.comprobantes_venta`, `dominio.comprobantes_venta_lineas`,
  `dominio.rma` o `dominio.rma_items` (directo o por RPC `security invoker`) para confirmar que ninguna aserción
  dependa de ver filas de una tienda no accesible; las RPC de lectura (`listar_comprobantes`, `listar_rma`,
  `listar_pagos`, `listar_contrarreembolsos`) ya acotaban por empresa accesible.
- pgTAP (`pnpm test:db`): **no se pudo correr en este entorno** (no hay acceso al demonio de Docker ni al CLI de
  Supabase: `permission denied while trying to connect to the Docker daemon socket`). Queda para el CI
  (`pnpm test:db:ci` corre los 207 archivos de `supabase/tests/database`).

## Deviations from Assessment

- La evaluación dejaba abierta la pregunta de si `comprobantes_venta` (cabecera) entraba en el alcance. Entra:
  es la misma causa y la misma política; el diagnóstico del tracker la nombra explícitamente («y
  `comprobantes_venta`») y sin ella las líneas quedarían filtradas por un padre que por API seguiría，露出 la
  cabecera.
- La evaluación propose heredar la empresa en las hijas con un `exists` sobre la cabecera; se mantiene, pero el
  `exists` incluye además la condición de organización (`c.organizacion_id = ...`) para que la comprobación no
  dependa de una fila de otra organización.
- Se conserva la lectura de los comprobantes **sin** `empresa_id` (`empresa_id is null or ...`): son los
  documentos heredados de F-CLI-08 (anteriores a F-VTA-04), que no pertenecen a ninguna tienda y antes eran
  visibles para la organización. La alternativa (filtrarlos) escondería datos de la organización a todos,
  incluido el administrador. La decisión está fijada por el pgTAP y documentada en `docs/ventas-comprobantes.md`.

## Follow-ups

- **Mismo patrón, otras tablas (fuera del alcance de MSF-656)**: `dominio.cuentas_cobro_empresas`
  (`supabase/migrations/20261022120300_cuentas_cobro.sql:133`) y `dominio.transportes_empresas`
  (`supabase/migrations/20261022120700_transportes.sql:214`) filtran solo por organización y sección `ventas`, y
  exponen el `empresa_id` de otra tienda. La fuga es menor (son tablas de vínculo de catálogos por organización:
  `cuentas_cobro` y `transportes` son de la organización, la tienda solo los habilita), pero el patrón es el mismo
  y conviene un ticket propio con su pgTAP.
- `dominio.historial_cotizaciones_dolar` y `dominio.transiciones_estado_comprobante` filtran por organización y
  sección, pero no guardan datos por tienda: no son un desvío de esta historia.
- **Residual (Baja, no bloquea)**: las cuatro políticas exigen empresa *asignada* (`empresas_accesibles()`), no el
  nivel de Ventas *en esa* empresa (`private.nivel_ventas_en_empresa`). Una persona con Ventas en la Tienda A y un
  rol sin Ventas en la Tienda B aún lee B por `/rest/v1/`. No se cierra acá: `nivel_ventas_en_empresa` tiene
  `execute` revocado para `authenticated` (`20261203100400_comprobantes_rpc.sql:50`), así que usarla en una política
  exige un envoltorio nuevo (como `puede_leer_faltantes_empresa`) y un pgTAP que hoy no se puede correr sin Docker.
  Seguimiento trazado: **MSF-737** (Tarea `seguimiento`, Backlog); la fuga es más acotada que antes del arreglo.
