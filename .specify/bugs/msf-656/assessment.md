# Bug Assessment: RLS de rma, rma_items y comprobantes_venta_lineas no filtra por empresas accesibles

- **Slug**: msf-656
- **Created**: 2026-11-01
- **Source**: pasted text (It's a Plan MSF-656)
- **Verdict**: valid
- **Severity**: high

## Report (summarized)

Las políticas SELECT de `dominio.rma`, `dominio.rma_items` y `dominio.comprobantes_venta_lineas` no filtran por empresas accesibles: por la API (PostgREST) se leen datos de otras tiendas.

## Symptom

Un usuario `authenticated` con nivel `lectura`/`edicion` en `ventas`, pero con acceso a solo algunas empresas (tiendas) de su organización, puede hacer `select` directo sobre esas tablas y ver filas de empresas a las que no tiene acceso. Esperado: solo filas de `private.empresas_accesibles()`.

## Reproduction

1. Organización con dos empresas A y B; usuario U con sección `ventas` en lectura y acceso solo a A.
2. Existe un RMA / comprobante con líneas de la empresa B.
3. U consulta `/rest/v1/rma`, `/rma_items`, `/comprobantes_venta_lineas` (esquema dominio) con su JWT.
4. Se devuelven filas de B. [NEEDS CLARIFICATION: confirmar con pgTAP; no se ejecutó en esta evaluación.]

## Suspected Code Paths

- `supabase/migrations/20270113100000_rma_tablas.sql:82` — `rma_select`: solo `organizacion_id` + `nivel_seccion('ventas')`; la tabla sí tiene `empresa_id`.
- `supabase/migrations/20270113100000_rma_tablas.sql:89` — `rma_items_select`: igual; `rma_items` NO tiene `empresa_id` (hay `rma_id` con FK compuesto a `rma`).
- `supabase/migrations/20261203200100_comprobantes_lineas.sql:61` — `comprobantes_venta_lineas_select`: igual; la tabla NO tiene `empresa_id` (tiene `comprobante_id`).
- `supabase/migrations/20261018100000_ventas_contrato_comprobantes.sql:46` — `comprobantes_venta_select` (cabecera) tiene el mismo patrón sin filtro de empresa; `empresa_id` se agregó en `20261203100100_comprobantes_cabecera.sql:36`. Mismo defecto, fuera del título; confirmar alcance.
- Patrón correcto de referencia: `20261205200000_consultas_configuracion.sql:51` (`empresa_id in (select private.empresas_accesibles())`).
- Las RPC `security definer` de lectura (`listar_rma`, etc.) ya filtran por empresa (p. ej. `20270114110100_listar_pagos.sql:108`); el fallo es solo en el acceso directo por tabla.

## Root Cause Hypothesis

Las políticas se copiaron del patrón de aislamiento por organización (`organizacion_id` + nivel de sección) y omitieron el segundo eje de aislamiento (empresa/tienda) que sí usan otras tablas. Para `rma_items` y `comprobantes_venta_lineas` además no hay columna `empresa_id`, así que el filtro debe heredarse del padre. Confianza: alta.

## Proposed Remediation

**Preferred**: nueva migración aditiva (no editar las antiguas) que haga `drop policy` + `create policy` de las tres (y, si se confirma, de `comprobantes_venta`):
- `rma`: añadir `and empresa_id in (select private.empresas_accesibles())`.
- `rma_items`: `and exists (select 1 from dominio.rma r where r.id = rma_id and r.organizacion_id = rma_items.organizacion_id and r.empresa_id in (select private.empresas_accesibles()))` (la RLS de `rma` ya aplica; el exists puede ir con subselect directo).
- `comprobantes_venta_lineas`: análogo vía `comprobantes_venta.empresa_id`.
Camino de reversión documentado en la spec/migración: restaurar las políticas previas. Esquema `dominio` correcto (Principio VII).

**Alternatives**:
- Desnormalizar `empresa_id` en las tablas hijas (con FK compuesto + backfill): políticas más baratas y simples, pero migración más pesada y riesgo de divergencia.
- Revocar `select` directo a `authenticated` y exponer solo por RPC: rompe lecturas de la UI que usan PostgREST directo.

**Files likely to change**:
- `supabase/migrations/<nueva>_rls_empresas_rma_lineas.sql`
- `supabase/tests/database/rma_alta.test.sql` / `rma_seguimiento.test.sql` / `ventas_comprobantes_lineas.test.sql` (o un test nuevo)
- `docs/` relevante (docs:check obliga documentación)

**Tests to add or update**:
- pgTAP: usuario con acceso solo a empresa A no ve `rma`, `rma_items`, `comprobantes_venta_lineas` (ni `comprobantes_venta`) de B; sí ve los de A; usuario con "todas" ve ambos.
- Verificar que los tests existentes y las pantallas de devoluciones/ventas siguen pasando.

## Risks & Considerations

- Performance: el `exists` en políticas de hijas sobre tablas grandes; usar `(select ...)` y los índices existentes (`rma_empresa_idx`, FK de comprobante).
- Posible regresión en lecturas directas de la UI de ventas/devoluciones para usuarios multi‑tienda (revisar `apps/web/src/pages/ventas/devoluciones.tsx`).
- Vistas/analítica (Superset, `analitica_ventas_*`) que lean estas tablas con otro rol no deben afectarse.
- Migración aditiva: es un reemplazo de política, reversible.

## Open Questions

- [NEEDS CLARIFICATION: ¿se incluye `comprobantes_venta` (cabecera) en el alcance? Tiene el mismo defecto.]
- [NEEDS CLARIFICATION: ¿hay otras tablas hijas de dominio con el mismo patrón?]
