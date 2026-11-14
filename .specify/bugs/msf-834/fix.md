# Bug Fix: reconciliar MSF-834 con la implementación publicada de F-1/F-3

- **Slug**: msf-834
- **Fixed**: 2026-11-14
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

La rama `fix/bug-MSF-834` había quedado 67 commits atrás de `origin/dokploy` y
traía su propia copia de las cinco migraciones `20270310100000…20270310100400`
(contenido anterior) cuando la misma implementación F-1/F-3 ya estaba publicada en
`dokploy` por el PR #950 (commits `5b9f2bd3`, `0efe7641`, `c1c48968`). Se
reconcilió la rama con lo ya publicado (`git merge origin/dokploy`) tomando las
migraciones, pgTAP, docs y marcas de tareas de `dokploy`, y se eliminaron las dos
versiones duplicadas que solo existían en esta rama. No se reescribió SQL.

Con eso, los cinco hallazgos de la devolución quedan cubiertos por el código
publicado y el guard de migraciones pasa (versiones únicas y sin modificar).

## Changes

| File | Change | Notes |
|------|--------|-------|
| `supabase/migrations/20270310100000_comprobantes_lineas_promocion.sql` | adopted from `dokploy` | resuelve el `add/add` con la versión publicada |
| `supabase/migrations/20270310100100_precio_linea_venta.sql` | adopted from `dokploy` | idem |
| `supabase/migrations/20270310100200_lineas_precio_promocional.sql` | adopted from `dokploy` | idem |
| `supabase/migrations/20270310100300_copiar_presupuesto_y_notas_precio_promocional.sql` | kept (published) | `dokploy` la ubica en `…300` |
| `supabase/migrations/20270310100400_confirmar_comprobante_precios_vigentes.sql` | kept (published) | `dokploy` la ubica en `…400` |
| `supabase/migrations/20270310100300_confirmar_comprobante_precios_vigentes.sql` | **removed** | duplicado de versión de esta rama |
| `supabase/migrations/20270310100400_copiar_presupuesto_y_notas_precio_promocional.sql` | **removed** | duplicado de versión de esta rama |
| `supabase/tests/database/ventas_precio_promocional.test.sql` | adopted from `dokploy` | versión publicada (801 líneas) |
| `supabase/tests/database/ventas_precio_promocional_ciclo.test.sql` | adopted from `dokploy` | versión publicada (779 líneas) |
| `docs/ventas-comprobantes.md`, `docs/promociones-precio.md`, `specs/…/tasks.md`, `specs/…/notas.md`, `spec.md` | adopted from `dokploy` | llegan con el merge |

## Resolución de los hallazgos

| Hallazgo | Estado | Evidencia |
|---|---|---|
| Versiones de migración reusadas/duplicadas | resuelto | `node scripts/verificar-migraciones.mjs` → `Migraciones OK: 651 archivo(s), 0 nuevo(s)`; ya no quedan `20270310100300`/`20270310100400` duplicadas |
| Guarda de `confirmar_comprobante` recalculaba todas las líneas (FR-024) | resuelto | `supabase/migrations/20270310100400_confirmar_comprobante_precios_vigentes.sql:71-90` filtra candidatas (`with candidatas as materialized`) y solo recalcula esas; medición de 200 líneas en `supabase/tests/database/ventas_precio_promocional_ciclo.test.sql:711-770` |
| `tasks.md` con tareas `[ ]` / notas pendientes | resuelto | `specs/20261113-120000-precio-promocional-en-pos-y-comprobantes/tasks.md:9-15,37-42` marcan `[x]` T000–T006 y T014–T019; evidencia en `notas.md:5-23` |
| Contrato sin documentar en `docs/ventas-comprobantes.md` | resuelto | `docs/ventas-comprobantes.md:305-321` (precedencia, `precio_referencia`/`promocion_id`, `40001` + `precios_cambiaron`, `copiar_presupuesto`, rendimiento) |
| Baseline FR-005 con un solo escenario | resuelto | `supabase/tests/database/ventas_precio_promocional.test.sql:343-362` compara contra la expresión legada en minorista, mayorista x10, descuento 5 %/15 %, precio propio, exento y manual |
| FR-007 sin aserción de comprobante cerrado (`55000`) | resuelto | `supabase/tests/database/ventas_precio_promocional.test.sql:643` (`throws_ok … '55000'`) |
| FR-008 sin presupuesto pendiente / `aceptar_presupuesto` | resuelto | `supabase/tests/database/ventas_precio_promocional_ciclo.test.sql:537-559` (T016) |
| FR-011/FR-012 a medias (parcial, exento, motos, cobros) | resuelto | `supabase/tests/database/ventas_precio_promocional_ciclo.test.sql:562-629` (nota total/parcial, saldo, cobros, IVA 21 % y exento, contrarreembolso de motos) |

## Tests Added or Updated

- `supabase/tests/database/ventas_precio_promocional.test.sql` — 141 aserciones: precedencia, baseline legado multi-escenario, vigencia, A/B, permisos, snapshot inmutable, copiar presupuesto, notas y FR-024 de `guardar_lineas_comprobante`.
- `supabase/tests/database/ventas_precio_promocional_ciclo.test.sql` — 143 aserciones: guarda de confirmación con y sin efectos, bandera, presupuestos (FR-008), notas total/parcial, saldo, cobros, IVA/exento, motos y FR-024 de `confirmar_comprobante`.

## Local Verification

- Commands run:
  - `node scripts/verificar-migraciones.mjs` → `Migraciones OK: 651 archivo(s), 0 nuevo(s) contra origin/dokploy.` (exit 0)
  - `pnpm docs:check` → `Documentación de cambios: OK` + `Migraciones OK` (exit 0)
  - `pnpm test:db:guard-migraciones` → 30/30 tests OK (exit 0)
  - `pnpm lint` → exit 0 (solo warnings preexistentes de `set-state-in-effect`)
  - `pnpm build` → `✓ built in 2.34s` (exit 0)
  - `pnpm der:check` → exit 1 por 138 specs preexistentes sin DER (línea base, no tocadas por este PR)
- Manual checks: no. El pgTAP y la reproducción contra Supabase no se pudieron correr localmente porque Docker no está disponible en el nodo; los corre el CI.

## Deviations from Assessment

El assessment proponía una migración nueva sobre `private.precio_para`. La
implementación publicada en `dokploy` (PR #950) resolvió el mismo gate con una
función envoltorio (`private.precio_linea_venta`) y dejó `precio_para` intacto:
se adoptó esa versión para no duplicar el fix ni regresar las correcciones de
F-3. La devolución del Revisor admitía explícitamente «renumerar o reconciliar
con lo ya publicado»; se eligió reconciliar. Renumerar los archivos de esta rama
habría reaplicado SQL anterior sobre el publicado (la guarda lenta sin filtro de
candidatas y los pgTAP viejos), que es justamente lo que pide corregir el
hallazgo de FR-024.

## Follow-ups

- Este PR queda como reconciliación de la rama; la implementación de F-1/F-3 ya
  está en `dokploy` por el PR #950. Si el orquestador lo prefiere, el PR #954 se
  cierra como superado por #950.
