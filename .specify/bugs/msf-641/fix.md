# Bug Fix: ventas_precios_especiales — descuento por cliente no se aplica (MSF-641)

- **Slug**: msf-641
- **Fixed**: 2026-10-31
- **Status**: not-applied (el defecto no existe en `dokploy`; vive en la rama de MSF-232)

## Causa raíz (verificada por inspección, sin base local)

En `dokploy` (HEAD de esta rama) `20270115090100_lineas_descuento.sql` redefine `public.guardar_lineas_comprobante`
(`v_unitario := coalesce(v_manual, round(v_precio.neto * (1 - v_descuento / 100), 2))`, guarda `descuento_pct`) y
`public.obtener_comprobante` (línea con `'descuento_pct'`). Es la última definición de ambas funciones en `dokploy`.

El commit `f2dc0f0f` (`origin/epic/MSF-232-service-tecnico-service-cobro-y-avisos`) agrega migraciones **con versión
posterior** que vuelven a crear esas funciones desde el cuerpo previo a MSF-340:

- `20270121120200_lineas_sin_stock.sql:547` recrea `guardar_lineas_comprobante`; en `:710` usa `round(v_precio.neto, 2)`
  (sin descuento ni `descuento_pct`) ⇒ tests 6, 7, 9 y 10 (precio 800/1000, total 8000, IVA 1680).
- `20270121120500_obtener_comprobante_origen.sql:14` recrea `obtener_comprobante` sin `descuento_pct`
  ⇒ test 13 (NULL).

Ninguna de esas migraciones existe en `origin/dokploy` (`git ls-tree origin/dokploy supabase/migrations | grep 20270121120` ⇒ 0).

## Changes

| File | Change | Notes |
|------|--------|-------|
| — | ninguno en `dokploy` | Arreglar acá no cambia nada: la regresión la introduce la rama de MSF-232 |

## Acción requerida (fuera del alcance de esta rama: "no tocar Service técnico ni el merge de MSF-232")

En la rama de MSF-232, al reescribir esas funciones hay que **partir del cuerpo de `20270115090100`**, no del de `20261203200300`:

1. `20270121120200_lineas_sin_stock.sql`: leer `coalesce(cl.descuento, 0) into v_tipo_cliente, v_descuento` en
   `guardar_lineas_comprobante`; `v_unitario := coalesce(v_manual, round(v_precio.neto * (1 - v_descuento / 100), 2))`;
   insertar `descuento_pct` (`case when v_manual is null then v_descuento else 0 end`).
2. `20270121120500_obtener_comprobante_origen.sql`: agregar `'descuento_pct', l.descuento_pct` a la línea.
3. Correr `ventas_precios_especiales.test.sql` (23 tests) sobre esa rama.

## Local Verification

- No hay Postgres/Docker accesible en este entorno (`psql`/`supabase` ausentes, socket Docker denegado): los tests pgTAP
  quedan para el CI `database`. `node scripts/verificar-migraciones.mjs` ⇒ OK (419 archivos, sin versiones duplicadas).

## Follow-ups

- Aplicar los puntos 1–3 en la rama de MSF-232 (PR #519).
