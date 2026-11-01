# Bug Fix: Dos tests desactualizados (conteo de migraciones y upsert en storage.objects)

- **Slug**: msf-631
- **Fixed**: 2026-11-01T21:50:34Z
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

El conteo exacto de migraciones de la épica de comprobantes pasa a ser un piso (`>= 12`), y el
test pgTAP de perfil de usuario deja de depender del índice único `(bucket_id, name)` de
`storage.objects`: Storage lo dropeó a propósito (migración `0072` de `supabase/storage`) para
admitir varias versiones por nombre, así que `on conflict (bucket_id, name)` falla con `42P10`
en un stack actual.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `scripts/migraciones-ventas-comprobantes.test.mjs` | modified | `assert.equal(deLaEpica.length, 12)` → `assert.ok(deLaEpica.length >= 12, …)` (commit `d4578a31`) |
| `supabase/tests/database/perfil_usuario.test.sql` | modified | test 11: `on conflict (bucket_id, name) do update` → `on conflict do nothing` + `update` de la fila propia; `plan(26)` → `plan(27)` |
| `.specify/bugs/msf-631/assessment.md` | added | evaluación del bug con la evidencia upstream |
| `.specify/bugs/msf-631/fix.md` | modified | este informe |
| `.specify/bugs/msf-631/test.md` | modified | informe de verificación |

Sin cambios en migraciones, RLS, esquemas, secretos ni dependencias.

## Diff Highlights

```sql
-- antes (exige el índice único `bucketid_objname`, que Storage dropeó en 0072):
insert into storage.objects (bucket_id, name, owner_id) values (...)
  on conflict (bucket_id, name) do update set updated_at = now()

-- después (válido en las dos eras de Storage):
insert into storage.objects (bucket_id, name, owner_id) values (...)
  on conflict do nothing
update storage.objects set updated_at = now()
  where bucket_id = 'fotos-perfil' and name = '<uid>/avatar'
```

## Tests Added or Updated

- `scripts/migraciones-ventas-comprobantes.test.mjs` — el conteo exacto se reemplaza por un piso;
  el mensaje de falla dice cuántos hay. Las otras tres aserciones (14 dígitos, unicidad de
  versiones, doc que cita migraciones existentes) no cambian.
- `supabase/tests/database/perfil_usuario.test.sql` — el test 11 se separa en dos aserciones:
  "el titular puede cargar su foto" (insert que la RLS no bloquea) y "el titular puede reemplazar
  su foto" (`update` de la fila propia, que cubre `fotos_perfil_update_titular`). El `plan()` pasa
  de 26 a 27.

## Local Verification

- `node --test scripts/migraciones-ventas-comprobantes.test.mjs` → 4 tests, 4 pass, 0 fail.
- `pnpm test:tooling` → 30 tests, 30 pass, 0 fail.
- `pnpm docs:check` → "Documentación de cambios: OK" + "Migraciones OK: 433 archivo(s), 0 nuevo(s)".
- `pnpm lint` → exit 0, 0 errores (sólo warnings preexistentes de `apps/web`, ajenos al cambio).
- `pnpm build` → OK.
- `pnpm calidad` → todos los checks OK salvo gitleaks, que localmente no tiene binario nativo
  (el paquete npm `gitleaks` es un placeholder); en el CI corre el binario nativo v8.30.1 y pasó.
- Suite pgTAP (`pnpm test:db:ci`): **not-run** localmente — requiere el stack de Supabase del CI
  (Docker y `pg_prove`), no disponibles en este contenedor. Queda para el job `database` del CI,
  que este diff sí dispara (toca `supabase/`).

## Deviations from Assessment

- El `assessment.md` se formaliza en este mismo commit: el triage original se había hecho
  (fix.md y test.md del 2026-11-01) sin dejar el archivo que el flujo `speckit.bug.fix` exige como
  prerrequisito.
- La corrección del test pgTAP la hace este commit y no el anterior: el diagnóstico previo
  ("depende de la versión de `storage-api` del entorno de auditoría, no del repo") era incorrecto.
  El repo ataba su test a un índice que el proveedor dropeó a propósito (upstream `0072`); el CI
  sólo passaba porque su `storage-api` todavía está en la era de versión única.

## Follow-ups

- Fijar la versión de `storage-api` del stack del CI (o documentarla) para que una diferencia de
  esquema de Storage no vuelva a aparecer sólo en un entorno. No bloquea esta historia.
