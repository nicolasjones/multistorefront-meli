# Bug Assessment: Dos tests desactualizados (conteo de migraciones y upsert en storage.objects)

- **Slug**: msf-631
- **Created**: 2026-11-01T21:50:34Z
- **Source**: pasted text (auditoría de suites del agente, 2026-10-31; épica MSF-585)
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim o resumido)

Auditoría de las suites existentes (stack con las 394 migraciones de `dokploy`, 2026-10-31).
Casi todo pasa: lint 0 errores, `tsc -b` OK, Vitest 3.394 tests en 306 archivos, `test:ia` 85
tests, pgTAP 6.899 tests en 189 archivos. Fallan estos dos por desactualización:

1. `scripts/migraciones-ventas-comprobantes.test.mjs:16` (`pnpm test:tooling`): falla con
   `17 !== 12`. El test fija en 12 la cantidad de migraciones `20261203*` y `20261204*` y hoy
   hay 17.
2. `supabase/tests/database/perfil_usuario.test.sql`, test 11:
   `42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification`.
   El test hace `insert into storage.objects … on conflict (bucket_id, name)` y el esquema de
   Storage del stack demo (imagen `storage-api` v1.84.19) no tiene un índice único sobre esas
   columnas.

Esperado: las suites pasan completas en un stack actual. Real: esos dos fallan; no son errores
del código de la aplicación.

## Symptom

Dos tests del repo fijan supuestos que ya no se sostienen: el conteo exacto de migraciones de la
épica de comprobantes, y la existencia del índice único `(bucket_id, name)` sobre
`storage.objects`. El primero es del repo; el segundo depende de una versión de Storage que el
repo ya no puede dar por cierta.

## Reproduction

1. `pnpm test:tooling` → `scripts/migraciones-ventas-comprobantes.test.mjs` falla con
   `17 !== 12` (la cantidad de migraciones `20261203*`/`20261204*` pasó de 12 a 17).
2. Con un stack de Supabase actual (`storage-api` v1.84.19), `pnpm test:db:ci` →
   `supabase/tests/database/perfil_usuario.test.sql` falla en el test 11 con
   `42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification`.

## Suspected Code Paths

- `scripts/migraciones-ventas-comprobantes.test.mjs:17` — el `assert.equal` del conteo exacto de
  migraciones de la épica.
- `supabase/tests/database/perfil_usuario.test.sql:76` — el `insert into storage.objects … on
  conflict (bucket_id, name) do update` del test 11.

## Root Cause Hypothesis

Dos tests desactualizados, con la misma forma: afirma un detalle del entorno que cambió.

- Conteo de migraciones: el test fija un número exacto (12) que era el de la época en que se
  escribió; las migraciones legítimas posteriores de la épica (hoy 17) lo rompen sin que haya
  un defecto de código. Confianza: alta.
- `storage.objects`: el test usa `on conflict (bucket_id, name)`, que exige un índice único sobre
  esas dos columnas. Ese índice (`bucketid_objname`) fue DROPEADO por el propio Storage en su
  migración `0072-drop-bucketid-objname-index.sql` (migraciones `tenant/` de `supabase/storage`),
  porque el objeto pasó a admitir varias versiones por nombre
  (`0062-object-versioning-core.sql`, `0074-unlock-object-versioning.sql`). En un Storage actual
  ya no existe, y `ON CONFLICT (bucket_id, name)` falla con `42P10`. El CI no lo detectaba porque
  su `storage-api` (la que trae el Supabase CLI 2.116.0) todavía está en la era de versión única;
  el repo, en cambio, ata su test a un índice que el proveedor ya no garantiza. Confianza: alta
  (verificada contra el código upstream de `supabase/storage`).

## Proposed Remediation

**Preferred**:

1. `scripts/migraciones-ventas-comprobantes.test.mjs`: reemplazar el conteo exacto por un piso
   (`>= 12`), de modo que una migración nueva con esos prefijos no vuelva a romper el test. El
   resto de las aserciones del archivo (versión de 14 dígitos, unicidad de versiones, doc que
   cita migraciones existentes) siguen fijando lo que importa.
2. `supabase/tests/database/perfil_usuario.test.sql`: que el test 11 no dependa de ningún índice
   único. La carga de la foto va con `on conflict do nothing` (sin destino de conflicto: no exige
   índice) y el reemplazo se prueba con un `update` de la fila propia, que es válido en las dos
   eras de Storage. El `update` además cubre `fotos_perfil_update_titular`, que hasta ahora sólo
   se ejercía de rebote por el `do update` del upsert.

**Alternatives** (opcional):

- Agregar en el repo una migración que recree el índice único sobre `storage.objects`: se puede
  hacer, pero compite con Storage (que lo dropeó a propósito para permitir versionado) y agrega
  una dependencia de migración por cada despliegue. Descartado.
- Usar `merge` (PG 15+) en lugar de `on conflict do nothing` + `update`: más expresivo, pero
  agrega una dependencia de versión de Postgres y no aporta cobertura que el par no dé.

**Files likely to change**:

- `scripts/migraciones-ventas-comprobantes.test.mjs`
- `supabase/tests/database/perfil_usuario.test.sql`
- `.specify/bugs/msf-631/assessment.md`, `.specify/bugs/msf-631/fix.md`,
  `.specify/bugs/msf-631/test.md`

**Tests to add or update**:

- `scripts/migraciones-ventas-comprobantes.test.mjs` — el conteo pasa de exacto a piso.
- `supabase/tests/database/perfil_usuario.test.sql` — el test 11 se reescribe sin `on conflict
  (bucket_id, name)`; el `plan()` pasa de 26 a 27 aserciones (se separa "cargar" de "reemplazar").

## Risks & Considerations

- La suite pgTAP sólo corre en el CI cuando el diff toca `supabase/` (job `database` de
  `.github/workflows/validate.yml`); este diff la toca, así que el CI va a ejercitar el cambio.
- El test se ejecuta como `authenticated` contra las policies del repo
  (`fotos_perfil_insert_titular`, `fotos_perfil_update_titular`), no contra el API de Storage.
- No se tocan migraciones, RLS, esquemas ni secretos: sólo tests.
- `storage.protect_delete` (Storage `0055`) impide `delete` directos sobre `storage.objects`, por
  lo que el "reemplazo" no puede expresarse con `delete` + `insert`: de ahí la pareja
  `insert`/`update`.

## Open Questions

- Ninguna bloqueante. Queda pendiente decidir, en otra historia, si el CI debe fijar la versión de
  `storage-api` del stack para que las diferencias de esquema no vuelva a aparecer.
