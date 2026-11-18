# Bug Fix: el simulacro de restauración deja la base sin permisos del app

- **Slug**: msf-520
- **Fixed**: 2026-11-18 (segunda pasada; la primera, mergeada en el PR #1054, está más abajo)
- **Assessment**: ./assessment.md
- **Status**: applied (el simulacro **no** se ejecutó: queda bajo el gate de autorización del propietario)

## Summary

La primera pasada dejó el simulacro ejecutable y arregló el agujero de seguridad del restore (las
nueve funciones `security definer` del historial de copias quedaban ejecutables por `PUBLIC` con
`pg_restore --no-privileges`). Al releer el procedimiento **como lo ejecutaría el simulacro**, esta
pasada encontró el resto del mismo problema: **el restore documentado deja la base restaurada sin
los permisos que el app necesita para leer**.

Los permisos del app son explícitos por tabla (los `grant` de las migraciones, no un permiso por
defecto: lo dice la migración fundacional). Esos `GRANT` viajan en el dump como ACL, y
`--no-privileges` es justamente la opción que no los aplica; como `--clean` recrea cada objeto, la
tabla que vuelve a nace con los permisos por defecto. La evidencia ya estaba en el repo: el pgTAP de
MSF-520 simula ese estado y comprueba que «tras el restore simulado el historial queda sin lectura
para `authenticated`» — el mismo mecanismo alcanza a todas las tablas del app. Con la base así,
`authenticated` no lee y, sin `USAGE` sobre el esquema `private`, fallan hasta las políticas de RLS:
el paso 7 del simulacro («el panel inicia sesión, una organización conocida lista sus datos») falla y
FR-011/SC-002 no cierran.

Este cambio deja el restore **aplicando los permisos del dump** (y atómico), cierra la diferencia de
esquema entre la copia y el panel de hoy, y hace que la verificación del simulacro mire **lo que el
app necesita para servir datos** y no sólo el historial de copias. **El simulacro en staging no se
ejecutó ni se firmó**: eso sigue bajo el gate de autorización del propietario (Nicolás), y el
registro de `docs/simulacro-restauracion.md` sigue vacío (no se inventa ningún resultado).

## Changes (esta pasada)

| File | Change | Notes |
|------|--------|-------|
| `docs/copias-y-restauracion.md` | modified | Sección A: el restore saca `--no-privileges` (aplica los `GRANT`/`REVOKE` del dump) y agrega `--exit-on-error` (`--single-transaction` sólo es válido con él). Nuevo paso: aplicar las migraciones pendientes sobre la base restaurada (`supabase db push --db-url "$DATABASE_URL"`). Nuevo paso 6: comprobar que el app quedó con sus permisos (`has_schema_privilege` sobre `private`, `has_table_privilege` sobre `public.organizaciones` y `dominio.empresas`) y que `anon` no lee. |
| `docs/simulacro-restauracion.md` | modified | Protocolo: el paso 4 dice que el restore aplica los permisos del dump; el paso 5 cierra la diferencia de esquema y verifica los roles/grants del app y del historial. El registro sigue **sin firmar**. |
| `docs/tecnico/runbooks/db-restore.md` | modified | Runbook alineado: el restore aplica los permisos del dump, las migraciones pendientes son obligatorias y la verificación mira que `authenticated` lea y `anon` no. |
| `scripts/tests/simulacro-restauracion.test.mjs` | added tests | Fijan el contrato del procedimiento: el restore aplica los permisos y es atómico, se aplican las migraciones pendientes y la verificación comprueba los permisos del app. 10 tests (`pnpm test:docs:simulacro`). |
| `supabase/tests/database/copias_restauracion_privilegios_msf520.test.sql` | modified | El pgTAP deja fijado el estado que el simulacro comprueba después del restore: `authenticated` conserva `USAGE` sobre `private` y la lectura de las tablas, los permisos son explícitos por tabla y `anon` no lee. 22 aserciones. |

Sin migración: el cambio es de procedimiento (documentación) y de tests. La función
`private.reaplicar_privilegios_copias()` de la primera pasada se mantiene (es la red de seguridad
del historial cuando la copia es más vieja que la migración que cambió esos permisos).

## Changes (primera pasada, mergeada en el PR #1054)

| File | Change | Notes |
|------|--------|-------|
| `supabase/migrations/20270418000301_reaplica_privilegios_copias.sql` | added | `private.reaplicar_privilegios_copias()`: reaplica los ACL del historial de copias. Aditiva, idempotente y sin tablas. |
| `supabase/tests/database/copias_restauracion_privilegios_msf520.test.sql` | added test | Simula el restore sin permisos y comprueba que la reparación deja el invariante de `copias_imagenes_verificaciones.test.sql`. |
| `scripts/tests/simulacro-restauracion.test.mjs` | added test | Fija el protocolo (caída simulada, privilegios, correo, cierre) y la coherencia del estado entre documentos. |
| `docs/simulacro-restauracion.md`, `docs/copias-y-restauracion.md`, `docs/tecnico/runbooks/db-restore.md` | modified | Cierre de los huecos del protocolo. |
| `package.json`, `.github/workflows/validate.yml` | modified | `pnpm test:docs:simulacro` en la suite y en el CI. |

## Diff Highlights

```bash
# docs/copias-y-restauracion.md — sección A, paso 4 (antes: --no-privileges y sin --exit-on-error)
pg_restore --dbname="$DATABASE_URL" --clean --if-exists --no-owner --exit-on-error \
  --single-transaction respaldo.dump
```

```sql
-- docs/copias-y-restauracion.md — sección A, paso 6 (nuevo)
select has_schema_privilege('authenticated', 'private', 'USAGE') as uso_private,
       has_table_privilege('authenticated', 'public.organizaciones', 'SELECT') as lee_organizaciones,
       has_table_privilege('authenticated', 'dominio.empresas', 'SELECT') as lee_dominio,
       has_table_privilege('anon', 'dominio.empresas', 'SELECT') as anon_dominio;
```

```js
// scripts/tests/simulacro-restauracion.test.mjs
assert.ok(!bloqueRestore.includes('--no-privileges'), 'el restore tiene que aplicar los GRANT/REVOKE del dump: con --no-privileges la base restaurada queda sin los permisos del app y el panel no muestra datos')
```

## Tests Added or Updated

- `scripts/tests/simulacro-restauracion.test.mjs` — 4 tests nuevos: el restore aplica los permisos del
  dump y es atómico, el procedimiento aplica las migraciones pendientes y la verificación comprueba
  que el app puede leer. Corre en el job `application` del CI (`pnpm test:docs:simulacro`), sin base
  ni Docker.
- `supabase/tests/database/copias_restauracion_privilegios_msf520.test.sql` — 3 aserciones nuevas
  (de 19 a 22): el estado que el simulacro comprueba después del restore. Corre en el job `database`
  del CI (`pnpm test:db:ci`, `pg_prove` sobre `supabase/tests/database/*.sql`).

## Local Verification

- `pnpm test:docs:simulacro` → 10/10 en verde.
- `pnpm docs:check` → OK («Documentación de cambios: OK (4251 archivos…)», «Migraciones OK: 771
  archivo(s), 0 nuevo(s) contra origin/dokploy», «Trampas conocidas: OK»).
- `pnpm test:docs:check`, `pnpm test:docs:manifest`, `pnpm test:docs:importaciones`,
  `pnpm test:docs:pasos-manuales` → en verde.
- `pnpm lint` → exit 0; `pnpm build` → exit 0.
- Mutaciones (FEAT-236): cuatro cambios deliberados sobre los documentos (volver a
  `--no-privileges`, sacar `--exit-on-error`, sacar el paso de migraciones pendientes y sacar la
  verificación del app), cada uno deja el test correspondiente en rojo. Ver `./test.md`.
- pgTAP: **no corrido localmente** (este entorno no tiene Docker ni Postgres de desarrollo; el CI
  corre la suite pgTAP completa sobre una base limpia en el job `database`).

## Deviations from Assessment

- **El simulacro no se ejecutó.** La remediación preferida sigue siendo ejecutarlo con autorización
  del propietario; el gate sigue abierto, así que el entregable es el procedimiento corregido y los
  tests que lo fijan, no la corrida. El registro de `docs/simulacro-restauracion.md` sigue vacío y
  sin firma (no se inventan resultados).
- **La corrección es del procedimiento, no de una función de base.** Podría haber agregado una
  función que re-aplicara *todos* los permisos del app; son ~1.500 `GRANT` de las migraciones y no
  es reproducible a mano. Lo correcto es que el restore aplique los que ya viajan en el dump.
- **La diferencia de esquema se cierra con `supabase db push`, no con `supabase migration up`.** Es el
  mecanismo de aplicación de migraciones que usa el deploy del repo (`scripts/migrar-supabase-cloud.mjs`
  usa `supabase db push --db-url`), así que no se inventó uno nuevo.
- **No se tocó `docs/README.md`, `docs/roadmap-template.md`, `docs/operar-sistema.md` ni
  `docs/entregar-sistema.md`.** Su texto («documentado pero no ejecutado») sigue siendo cierto: la
  ejecución y la firma siguen pendientes. El test de coherencia obliga a actualizarlos juntos cuando
  se firme.
- **No se cambió el flow `verificar-restauracion`.** Su contrato es comprobar que el restore
  termina y que las tablas esperadas tienen datos, en un Postgres aislado sin los roles del app: los
  permisos no son parte de ese contrato (y los errores esperados del restore ya contemplan los roles
  que no existen).

## Follow-ups

- **Gate de autorización (dueño: propietario del producto).** Autorizar por escrito la corrida del
  simulacro en staging (ventana de downtime, quién ejecuta, quién firma) y ejecutarlo: la guía ya
  tiene el protocolo completo y la tabla de resultados para llenar con valores medidos. Al firmarlo,
  el test `pnpm test:docs:simulacro` obliga a actualizar en el mismo cambio los documentos que
  declaran el estado.
- **SMTP de staging.** Si `KESTRA_SMTP_*` / `SOPORTE_CORREO` siguen con los valores de ejemplo
  (`smtp.example.com` / `example.com`), el paso 6 del simulacro no se puede cerrar: el aviso se pierde
  en silencio (`transmitFailed: false`). Relacionado con MSF-532.
- **Copias fuera del servidor.** El riesgo asumido (copias en el mismo servidor) sigue abierto: es un
  seguimiento aparte, no lo tapa MSF-520.
