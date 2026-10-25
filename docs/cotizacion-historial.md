---
owner: producto
sources: [supabase/migrations, specs]
---
# Historial de cotizaciones del dólar (F-PRE-04)

Épica MSF-116, historia MSF-286. Migración `supabase/migrations/20261023140400_cotizacion_historial.sql`;
spec en `specs/20261023-120000-dolar-y-recalculo/` (FR-016, FR-017, FR-018).

## Inmutabilidad (FR-016)

`dominio.cotizaciones` es append-only. Un trigger (`private.rechazar_cambio_cotizacion`, `ENABLE ALWAYS`)
rechaza `UPDATE`, `DELETE` y `TRUNCATE` para cualquier rol, incluidos el dueño y `service_role`. Las únicas
salidas son las acciones referenciales de la propia base (profundidad de trigger > 1): `cargada_por → null`
al borrar a quien cargó, y el borrado en cascada cuando la organización ya no existe.

**Escritores actuales de la tabla** (grep sobre migraciones, seeds, `workers/` y `apps/`): solo el
`insert` de `public.confirmar_cotizacion` (`20261023140300_cotizacion_confirmar_recalculo.sql`). No hay
importación, seed ni worker que actualice o borre filas.

**Efecto en operación:** como el trigger es `ENABLE ALWAYS`, corre también con
`session_replication_role = replica`. Un `pg_restore` de datos sobre una tabla ya poblada o un
`TRUNCATE ... CASCADE` que la alcance ahora falla: restaurar sobre una base vacía (los `INSERT` no se
bloquean). Borrar una organización sigue funcionando (cascada permitida).

## Consulta (FR-017)

`public.listar_cotizaciones(p_limite, p_cursor)`: `security invoker` (rige la RLS), más nueva primero,
paginada por cursor opaco (`<cargada_en>|<id>`), con la variación contra la carga anterior (null en la
primera). Exige `cotizacion_dolar` ≥ `lectura` (42501 si no); `anon` sin ejecución.

## Pantalla (FR-018)

«Historial de cargas» en Cotización (`TablaHistorial`), solo si el rol tiene `cotizacion_dolar` ≥ lectura.
«Cargó» muestra «—» si el usuario ya no existe. Empresa activa: no aplica (la cotización es de la
organización); ver la fila «Empresa activa» de la matriz de la spec.

## Reversión

Migración posterior que elimine `public.listar_cotizaciones(integer, text)`, los triggers
`cotizaciones_inmutable_fila` y `cotizaciones_inmutable_truncate`, y `private.rechazar_cambio_cotizacion()`.

> **Revisión de fuentes:** 2026-10-25 — se revisaron las fuentes de esta página y su contenido no cambia.
