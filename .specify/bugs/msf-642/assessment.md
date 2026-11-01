# Bug Assessment: restaurar descuento por cliente en guardar_lineas_comprobante y obtener_comprobante (rama MSF-232)

- **Slug**: msf-642
- **Created**: 2026-10-31
- **Source**: pasted text (Jira MSF-642, seguimiento de MSF-641; sin URL)
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

"[seguimiento MSF-641] MSF-232: restaurar descuento por cliente en guardar_lineas_comprobante y obtener_comprobante".
MSF-641 (`.specify/bugs/msf-641/fix.md`, commit 5cc0fa82) ya diagnosticó que `ventas_precios_especiales.test.sql`
(tests 6, 7, 9, 10 y 13 de 23) falla por migraciones de la épica MSF-232, no por `dokploy`.

## Symptom

En la rama de la épica MSF-232 el descuento por cliente (F-VTA-32 / MSF-340) deja de aplicarse: las líneas se
guardan al neto de escala sin descuento, `descuento_pct` queda en 0 y `obtener_comprobante` no devuelve
`descuento_pct`. Esperado: precio = round(neto × (1 − descuento/100), 2) y `descuento_pct` en la línea.

## Reproduction

1. Tomar `origin/epic/MSF-232-service-tecnico-service-cobro-y-avisos` (PR #519) con todas sus migraciones aplicadas.
2. Correr `pnpm test` (con `pnpm dev:supabase`) → `supabase/tests/database/ventas_precios_especiales.test.sql`.
3. Fallan 6, 7, 9, 10 (precio/total/IVA sin descuento) y 13 (`descuento_pct` NULL).
Verificado por lectura estática del código; no hay Postgres/Docker local en este entorno.

## Suspected Code Paths

(todas en `origin/epic/MSF-232-service-tecnico-service-cobro-y-avisos`; ninguna existe en `dokploy`/esta rama)
- `supabase/migrations/20270121120200_lineas_sin_stock.sql:547` — recrea `public.guardar_lineas_comprobante` partiendo del
  cuerpo de `20261203200300` (previo a MSF-340): `:710` `v_unitario := coalesce(v_manual, round(v_precio.neto, 2))`,
  sin lectura de `clientes.descuento` y sin `descuento_pct` en el insert (`:722`).
- `supabase/migrations/20270121120500_obtener_comprobante_origen.sql:14` — recrea `public.obtener_comprobante`
  "aditivo sobre 20261203200300"; la línea (`:78`) no incluye `'descuento_pct'`.
- Referencia correcta: `supabase/migrations/20270115090100_lineas_descuento.sql` (líneas 86-88 lectura del descuento,
  184 precio con descuento, 199/205 insert de `descuento_pct`, 294 clave en `obtener_comprobante`).
- `20270121120300_generar_comprobante_reparacion.sql:173` inserta líneas sin `descuento_pct`: queda en el default 0, correcto
  (precio copiado del ítem de reparación, sin descuento de cliente); no requiere cambio.

## Root Cause Hypothesis

Las migraciones de MSF-232 se escribieron antes de MSF-340 y, al renumerarlas por encima de `20270115090100`
(commits eb923fde / 6f6482d2), `create or replace` pasó a ser la última definición de ambas funciones y pisa la versión
con descuento. Conflicto semántico de "última migración gana", no textual. Confianza: alta.

## Proposed Remediation

**Preferred**: trabajar en la rama de la épica MSF-232 (no en `dokploy`). Editar (no agregar migración nueva, porque
aún no están en `dokploy`; si ya estuvieran aplicadas en un entorno, sería migración posterior) las dos migraciones:
1. `20270121120200_lineas_sin_stock.sql`, función `guardar_lineas_comprobante`: declarar `v_tipo_cliente`/`v_descuento`,
   leer `select cl.tipo, coalesce(cl.descuento,0) ... from public.clientes cl where cl.id = v_c.cliente_id and cl.organizacion_id = v_org`;
   `v_unitario := coalesce(v_manual, round(v_precio.neto * (1 - v_descuento / 100), 2))`; insertar
   `descuento_pct` = `case when v_manual is null then v_descuento else 0 end`; mantener la lógica sin_stock de MSF-418.
2. `20270121120500_obtener_comprobante_origen.sql`: añadir `'descuento_pct', l.descuento_pct` a cada línea, conservando
   `origen_*` y `sin_stock`.
Actualizar los comentarios de cabecera ("sobre 20261203200300" → "sobre 20270115090100") y la reversión documentada.

**Alternativas**:
- Migración nueva `2027012112xxxx` posterior que restaure ambas funciones fusionadas: más segura si las migraciones ya
  corrieron en algún entorno, pero duplica cuerpos grandes.

**Files likely to change** (en la rama de MSF-232):
- `supabase/migrations/20270121120200_lineas_sin_stock.sql`
- `supabase/migrations/20270121120500_obtener_comprobante_origen.sql`
- docs de la spec `specs/20261028-100000-service-cobro-y-avisos/` (nota de desvío corta, con hash de commit) si aplica

**Tests to add or update**:
- `supabase/tests/database/ventas_precios_especiales.test.sql` (23 tests) debe quedar en verde, sin tocarlo.
- Un caso pgTAP combinando descuento de cliente + línea `sin_stock` en el mismo comprobante (guardar conserva la línea
  sin_stock y aplica descuento a las de catálogo).
- `node scripts/verificar-migraciones.mjs` (sin versiones duplicadas / orden).

## Risks & Considerations

- Debe mantenerse íntegro el comportamiento MSF-418 (sin_stock conservado y sumado a totales; `origen_*`, `left join` de depósito).
- Una línea sin_stock no lleva descuento (copia del ítem de reparación).
- El descuento se lee en el servidor de `public.clientes`, nunca del payload (regla F-VTA-32).
- Cambio solo en cuerpos de funciones con misma firma: sin BREAKING ni cambios de grants; revisar que se conserven
  `revoke ... from public, anon` / `grant ... to authenticated`.
- Este worktree está en `dokploy`: no hay defecto aquí; el fix requiere la rama de MSF-232 (PR #519).

## Open Questions

- [NEEDS CLARIFICATION: ¿las migraciones 20270121120200/…500 ya se aplicaron en algún entorno? Define editar vs. migración posterior.]
