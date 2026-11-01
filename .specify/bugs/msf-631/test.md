# Bug Verification: Dos tests desactualizados (conteo de migraciones y upsert en storage.objects)

- **Slug**: msf-631
- **Tested**: 2026-11-01T21:50:34Z
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

El test de conteo de migraciones ya no falla (piso en vez de conteo exacto) y el test pgTAP de
perfil de usuario dejó de depender del índice único `(bucket_id, name)` que Storage dropeó, así
que `on conflict (bucket_id, name)` (el error `42P10` del ticket) ya no está en el repo. La parte
que no se pudo ejercitar localmente es la suite pgTAP: necesita el stack de Supabase y `pg_prove`,
que no hay en este contenedor; la ejecuta el job `database` del CI, que este diff sí dispara.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | `node --test scripts/migraciones-ventas-comprobantes.test.mjs` | pass | 4 tests, 4 pass, 0 fail |
| New / updated tests | `pnpm test:tooling` | pass | 30 tests, 30 pass, 0 fail |
| Regression suite (tooling) | `pnpm test:tooling` (incluye `operaciones`, `supabase-ci`, `reset-db-ci-sql`) | pass | 30/30 |
| Documentation gate | `DOCUMENTATION_CHECK_BASE=origin/dokploy pnpm docs:check` | pass | "Documentación de cambios: OK" + "Migraciones OK: 433 archivo(s), 0 nuevo(s)" |
| Lint / type-check | `pnpm lint` | pass | exit 0, 0 errores (warnings preexistentes de `apps/web`, ajenos al cambio) |
| Build | `pnpm build` | pass | exit 0, "✓ built in 2.82s" |
| Calidad determinista | `pnpm calidad` | pass | oxlint, knip, jscpd, dependency-cruiser y syncpack OK; gitleaks no corre local (placeholder npm, sin binario nativo) — el CI lo corre con el binario v8.30.1 y ya pasó |
| Suite pgTAP | `pnpm test:db:ci` | not-run | requiere el stack de Supabase del CI (Docker + `pg_prove`); no hay Docker en este contenedor. Queda para el job `database` del CI |
| Reproducción del `42P10` | análisis del esquema upstream de `supabase/storage` | pass | `0072-drop-bucketid-objname-index.sql` dropea `storage.bucketid_objname`; el `on conflict (bucket_id, name)` del ticket no puede resolver contra un stack actual |

## Output Excerpts

```
$ node --test scripts/migraciones-ventas-comprobantes.test.mjs
✔ hay migraciones de la épica y todas tienen versión de 14 dígitos
✔ las versiones de la épica son posteriores a la última de origin/dokploy
✔ ninguna versión de migración está repetida
✔ la doc cita solo migraciones que existen
ℹ tests 4 / ℹ pass 4 / ℹ fail 0

$ pnpm test:tooling
ℹ tests 30 / ℹ pass 30 / ℹ fail 0

$ DOCUMENTATION_CHECK_BASE=origin/dokploy pnpm docs:check
Documentación de cambios: OK (3 archivos comparados contra origin/dokploy).
Migraciones OK: 433 archivo(s), 0 nuevo(s) contra origin/dokploy.

$ pnpm lint        → exit 0
$ pnpm build       → exit 0 (✓ built in 2.82s)
```

Balance del plan pgTAP tras el cambio: `select plan(27)` y 27 aserciones contadas
(`is` 19 + `ok` 1 + `lives_ok` 4 + `throws_ok` 3).

## Residual Risks

- La suite pgTAP completa no se corrió localmente: el job `database` del CI la corre contra el
  stack del propio CI (Supabase CLI 2.116.0), que puede estar en la era de versión única de
  Storage. El test nuevo es válido en las dos eras: `on conflict do nothing` no exige ningún
  índice y el `update` sólo necesita la policy `fotos_perfil_update_titular` del repo.
- El entorno de la auditoría (storage-api v1.84.19) no se puede levantar en este contenedor; la
  evidencia de que el esquema nuevo acepta el `insert` es que el propio fixture del test
  (líneas 52-55) inserta en `storage.objects` y el test 12 (`throws_ok` por insertar en la carpeta
  ajena) pasó en esa auditoría: el `insert` del titular no está bloqueado por RLS.
- `storage.protect_delete` (Storage `0055`) impide `delete` directos sobre `storage.objects`, por
  eso el "reemplazo" se probó con `update` y no con `delete` + `insert`.

## Recommendation

- Mergear cuando el job `database` del CI pase en verde (el diff toca `supabase/`, así que la
  suite pgTAP se ejecuta). Si el CI llegara a fallar por el test 11, la causa sería la versión de
  `storage-api` del stack del CI y no el cambio: revisar la versión antes de tocar el test.
