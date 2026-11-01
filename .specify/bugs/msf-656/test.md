# Bug Verification: RLS de comprobantes, líneas, RMA e ítems por empresas accesibles

- **Slug**: msf-656
- **Tested**: 2026-11-01
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

El arreglo está aplicado (las cuatro políticas `SELECT` de `dominio.comprobantes_venta`,
`dominio.comprobantes_venta_lineas`, `dominio.rma` y `dominio.rma_items` agregan la empresa accesible) y quedó
fijado con un pgTAP nuevo. **No se pudo ejecutar la reproducción ni el pgTAP en este entorno**: no hay demonio de
Docker con permiso ni CLI de Supabase, así que no hay Postgres contra el cual correr `pnpm test:db`. El resultado
es `partial` por diseño (no se afirma `verified` sin haber ejercido la reproducción): la ejecución queda para el
CI, que es el gate.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | `pnpm test:db` (pgTAP) | not-run | Sin Docker/Supabase en este entorno: `permission denied while trying to connect to the Docker daemon socket`. El pgTAP nuevo reproduce el caso (persona de una sola tienda). |
| New / updated tests | `supabase/tests/database/rls_empresas_rma_comprobantes.test.sql` | not-run | 17 aserciones escritas; se ejecutan en el CI (`pnpm test:db:ci`). |
| Regression suite | Revisión estática de los 40 pgTAP que leen `dominio.comprobantes_venta`, `dominio.comprobantes_venta_lineas`, `dominio.rma` o `dominio.rma_items` (directo o por RPC `security invoker`) | pass | Ninguna aserción dependía de ver filas de una tienda no accesible; los casos de «otra tienda» ya esperaban cero filas. |
| Migraciones aditivas | `pnpm db:validar:aditivas` | pass | `420 migraciones verificadas en supabase/migrations: ninguna destructiva sin camino de reversión documentado.` |
| Documentación | `pnpm docs:check` | pass | `Documentación de cambios: OK` · `Migraciones OK: 420 archivo(s), 1 nuevo(s) contra origin/dokploy.` |
| Lint / type-check | `pnpm lint` | pass | exit 0 (solo warnings preexistentes de `react-hooks`; el diff no toca `apps/web`). |
| Build | `pnpm build` | pass | `✓ built in 1.88s` (exit 0). |
| Calidad determinista | `pnpm calidad` | pass | oxlint (SAST), knip (código muerto), jscpd (duplicación), dependency-cruiser (arquitectura) y syncpack (versiones) en ok; gitleaks no se pudo correr (sin binario ni Docker) y se re-ejecuta en el CI. |

## Output Excerpts

```
$ pnpm db:validar:aditivas
420 migraciones verificadas en supabase/migrations: ninguna destructiva sin camino de reversión documentado.

$ pnpm docs:check
Documentación de cambios: OK (7 archivos comparados contra HEAD~1).
Migraciones OK: 420 archivo(s), 1 nuevo(s) contra origin/dokploy.

$ pnpm lint   → exit 0
$ pnpm build  → ✓ built in 1.88s   (exit 0)

$ pnpm calidad
ok  oxlint (SAST)
ok  knip (código muerto)
ok  jscpd (duplicación)
ok  dependency-cruiser (arquitectura)
ok  syncpack (versiones)
```

## Residual Risks

- **La reproducción no se ejecutó**: el resultado `verified` queda pendiente del CI. Si el pgTAP nuevo falla,
  el síntoma sigue vigente.
- **Comprobantes heredados sin `empresa_id`**: se mantienen visibles para la organización (`empresa_id is null or
  ...`), igual que antes del arreglo. Son documentos anteriores a F-VTA-04, que no pertenecen a ninguna tienda. Si
  el negocio decide que deben ocultarse, hay que cambiar la política y la aserción que los fija.
- **Otros catálogos con el mismo patrón**: `dominio.cuentas_cobro_empresas` y `dominio.transportes_empresas`
  filtran solo por organización y sección `ventas` (filtran por tienda las tablas de sus catálogos). Quedan
  señalados como seguimiento en `fix.md`: están fuera del alcance de MSF-656 y necesitan su propio ticket.
- **Performance**: las políticas de las hijas usan `exists` sobre la clave primaria del padre
  (`comprobantes_venta.id`, `rma.id`), así que el plan usa índice; no se midió con `EXPLAIN` porque no hay base
  local.

## Recommendation

Cerrar el bug en el CI: el pgTAP nuevo es el que prueba que una persona de una sola tienda ya no lee por
`/rest/v1/` los comprobantes, las líneas, los RMA y sus ítems de otra tienda. Si el CI deja `rls_empresas_rma_comprobantes`
en verde y las 207 pruebas de `supabase/tests/database` también, la historia queda verificada; si no, reopen con
la salida de `pnpm test:db:ci`.
