# Bug Assessment: PR #889 dejó el CI `database` y `web (1)` en rojo (MSF-844)

- **Slug**: msf-844
- **Created**: 2026-11-13
- **Source**: pasted text (tracker MSF-844) + verificación con `gh pr view 889`,
  `gh run view 43342254406 --log-failed` y `gh pr diff 889 --name-only`
- **Verdict**: valid
- **Severity**: high (el CI de `database` y `web (1)` bloquea el PR; `validacion` hereda el rojo)

## Report (verbatim or summarized)

"[Bug] PR #889 (a11y + baja de organización con datos): CI `database`/`web (1)`/`validacion` rojo — FK diferidas con alcance demasiado amplio + regresión a11y en listas.test.tsx (modo bug)."

Diagnóstico del tracker (verificado contra el run 43342254406, SHA 2c56cc74):

- `database`: la migración `supabase/migrations/20270304100000_baja_organizacion_con_ingresos_de_mercaderia.sql`
  recorre TODA la clausura recursiva de FK `on delete cascade` desde `public.organizaciones`
  (155 tablas, 71 FK según el propio PR) y convierte cada FK inmediata (`restrict`/`no action`) de
  esa clausura en `deferrable initially deferred`. Rompe 38 pruebas de
  `supabase/tests/database/ventas_motos_registro.test.sql`, 1 de `comprobantes_venta_contrato.test.sql`,
  3 de `cotizacion_historial.test.sql` y 1 de `stock_historial.test.sql`.
- `web (1)`: `apps/web/src/pages/configuracion/listas.test.tsx:152` espera `getAllByRole('region')`
  con longitud 2, pero el propio PR agregó `role="region"` a las tablas con scroll y ahora hay 4.

## Symptom

El PR #889 (rama `fix/productos-create-y-ui-hallazgos` → `dokploy`) no puede mergearse: el job
`database` falla y el job `web (1)` falla; `validacion` sólo verifica que nada haya fallado, así
que hereda el rojo.

Causa 1 (base de datos): diferir las FK de las 155 tablas de la clausura afecta tablas de dominio
ajenas al alcance declarado ("baja de organización con ingresos de mercadería"): ventas, motos,
cotizaciones y stock. Dos efectos observables:

- `throws_ok('23503', …)` sobre un INSERT con una FK cruzada deja de.launchar la excepción en esa
  sentencia (la comprobación pasa al COMMIT) y el test falla con «caught: no exception»; las
  pruebas siguientes del archivo heredan la fila basura y fallan en cascada (38 fallos en
  `ventas_motos_registro.test.sql`).
- `truncate` sobre una tabla con FK diferidas cambia de error: `0A000` («la FK corta antes que el
  trigger») en `cotizacion_historial.test.sql` y `55006 cannot TRUNCATE "movimientos_stock" because
  it has pending trigger events` en `stock_historial.test.sql`.

Causa 2 (web): el conteo de regiones de la pantalla «Listas configurables» cambió de 2 a 4 porque
las tablas con scroll pasaron a ser `role="region"`; la aserción quedó con el número viejo.

## Reproduction

1. `git checkout 2c56cc7489a9099c5d775b7f911cca8d20e0836a` (el commit del PR que quedó en rojo).
2. Base: `pnpm db:ci:preparar` + `pnpm test:db:ci` → falla en
   `ventas_motos_registro.test.sql` (38), `comprobantes_venta_contrato.test.sql` (1),
   `cotizacion_historial.test.sql` (3) y `stock_historial.test.sql` (1).
3. Web: `pnpm --filter @platform/web exec vitest run src/pages/configuracion/listas.test.tsx` →
   `expected [ <section …>…(3) ] to have a length of 2 but got 4` en `listas.test.tsx:152`.
4. Evidencia del run: `gh run view 43342254406 --log-failed` (jobs `database` 131613940160 y
   `web (1)` 131613940196).

## Root Cause Hypothesis

Causa 1: la migración altera el modo de comprobación de las FK de toda la clausura de la cascada de
`public.organizaciones`, no sólo de las que participan en la baja con ingresos de mercadería. El
alcance correcto es «la tabla ORIGEN de la clave está en el alcance declarado y la tabla DESTINO
también se borra en esa cascada»; la clausura completa incluye tablas de ventas, motos, cotizaciones
y stock que no tienen nada que ver con esta baja. Confianza: alta (el diff del PR y el catálogo de
`pg_constraint` coinciden con el alcance descrito).

Causa 2: la aserción cuenta las regiones de la pantalla; al pasar las tablas con scroll a regiones
con nombre propio el conteo real pasó a 4 y la prueba quedó con el número anterior. Confianza: alta.

## Proposed Remediation

**Preferido**

1. Migración nueva `supabase/migrations/20270304100001_baja_organizacion_con_ingresos_de_mercaderia.sql`
   (aditiva; la versión `20270304100000` ya la usa `20270304100000_endurecer_privilegios_anon_y_plataforma_ia.sql`
   en la base): el bloque `do $$` altera ÚNICAMENTE las FK inmediatas cuya tabla ORIGEN está en el
   alcance declarado y cuya tabla DESTINO también se borra en la cascada de la organización.
2. pgTAP `supabase/tests/database/baja_organizacion_con_ingresos.test.sql`: la baja con ingresos
   tiene que completar, borrar UN registro usado por otro sigue prohibido (se fuerza con
   `set constraints all immediate`) y — guarda anti-regresión — ninguna clave foránea fuera del
   alcance declarado puede quedar diferida.
3. Web: la tabla con scroll del panel es una región con nombre y con foco (`tabIndex`,
   `role="region"`, nombre propio), y `listas.test.tsx:152` se actualiza al conteo real.

**Files likely to change**

- `supabase/migrations/20270304100001_baja_organizacion_con_ingresos_de_mercaderia.sql` (nuevo)
- `supabase/tests/database/baja_organizacion_con_ingresos.test.sql` (nuevo)
- `apps/web/src/components/pagina/ContenidoAdaptable.tsx` (región con nombre en la tabla desplazable)
- `apps/web/src/pages/configuracion/listas.test.tsx` (aserción al conteo real)
- `docs/empresas.md` (la baja con ingresos deja de ser un límite conocido)

**Tests to add or update**

- pgTAP: baja con ingresos completa; borrar un producto/proveedor usado sigue dando 23503 al
  confirmar; ninguna FK fuera del alcance quedó diferida.
- Vitest: `listas.test.tsx` cuenta las regiones reales de la pantalla.

## Risks & Considerations

- `dominio.movimientos_stock` NO entra en el alcance de diferimiento: sus FK (`no action`) dejan
  eventos de trigger pendientes y `truncate dominio.movimientos_stock` pasa a fallar con 55006
  (`stock_historial.test.sql`, caso 3). Sus claves no hacen falta para la baja: la cascada ya borra
  los movimientos antes que las existencias y los motivos (probado por `stock_historial.test.sql:192`,
  «se puede borrar una organización con movimientos (cascada)»).
- Las FK `restrict` no admiten diferirse: hay que recrearlas como `no action deferrable initially
  deferred` (drop + add + validate), como hacía la migración del PR.
- Una clave diferida cambia el momento de la comprobación, no la regla: borrar un registro usado
  por otro sigue prohibido (23503), llega al COMMIT.
- La migración es aditiva y su reversión está documentada en el encabezado; no destruye datos.

## Deviations from Assessment

(none yet)
