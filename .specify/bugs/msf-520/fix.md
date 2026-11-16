# Bug Fix: protocolo de simulacro de restauración ejecutable y privilegios del restore

- **Slug**: msf-520
- **Fixed**: 2026-11-15
- **Assessment**: ./assessment.md
- **Status**: applied (el simulacro **no** se ejecutó: queda bajo el gate de autorización del propietario)

## Summary

El simulacro de restauración en staging no se había ejecutado nunca (T018 se cerró con `Desvío:` por
falta de autorización) y el procedimiento documentado, tal como estaba, no era ejecutable de punta a
punta: le faltaban el envío de prueba del aviso por correo, la definición de la «caída simulada» que
hace falta para medir la pérdida como número, la verificación de roles/grants sobre la base restaurada
y el paso de dejar staging sano. Además, el `pg_restore --no-privileges` documentado deshacía el
invariante de privilegios del historial de copias (las nueve funciones `security definer` quedaban
ejecutables por `PUBLIC`): un `anon` podría escribir el historial de copias después de restaurar.

Este cambio cierra los cuatro huecos del protocolo, agrega el paso de reaplicar los privilegios
(`private.reaplicar_privilegios_copias()`) con su comprobación, deja el invariante protegido por un
pgTAP que simula el restore y fija por test que el protocolo no vuelva a perder esos pasos ni que la
documentación se contradiga sobre si el simulacro corrió. **No se ejecutó el simulacro ni se firmó el
registro**: eso queda bajo el gate de autorización del propietario (Nicolás).

## Changes

| File | Change | Notes |
|------|--------|-------|
| `supabase/migrations/20270418000301_reaplica_privilegios_copias.sql` | added | `private.reaplicar_privilegios_copias()`: reaplica los ACL del historial de copias (funciones: sólo `kestra_backups`; tablas: lectura de `authenticated` con RLS). Aditiva, idempotente y sin tablas. Si falta el rol `kestra_backups` (base restaurada más vieja), lo dice con un error explícito en vez de fallar con el error críptico de Postgres. |
| `supabase/tests/database/copias_restauracion_privilegios_msf520.test.sql` | added test | Simula el restore con `--no-privileges` (funciones ejecutables por `PUBLIC`, tablas sin lectura) y comprueba que la reparación deja el invariante de `copias_imagenes_verificaciones.test.sql:29-50`. 19 aserciones, en transacción con `rollback` (las pruebas no dejan el ACL roto). |
| `scripts/tests/simulacro-restauracion.test.mjs` | added test | Fija el protocolo (caída simulada, reaplicación y verificación de privilegios, aviso por correo, cierre con staging sano, objetivos 24 h/4 h, campos del registro) y que los documentos que declaran el estado del simulacro no se contradigan. 6 tests (`pnpm test:docs:simulacro`). |
| `docs/simulacro-restauracion.md` | modified | Protocolo: marcador de la «caída simulada» (paso 3), reaplicación y verificación de roles/grants (paso 5), prueba del aviso por correo (paso 6), cierre de staging sano (paso 8). El registro sigue **sin firmar**. |
| `docs/copias-y-restauracion.md` | modified | Sección A: paso 5 «Reaplicar los privilegios» (comando + comprobación) y texto desactualizado («aún no existe en esta rama») corregido. |
| `docs/tecnico/runbooks/db-restore.md` | modified | Runbook alineado con el procedimiento real: dump en formato custom (no `gzip -t`), paso obligatorio de reaplicar privilegios y verificación con el pgTAP del historial. |
| `package.json`, `.github/workflows/validate.yml` | modified | `pnpm test:docs:simulacro` en la suite y en el job `application` del CI (Node puro, corre siempre). |

## Diff Highlights

```sql
-- supabase/migrations/20270418000301_reaplica_privilegios_copias.sql
if not exists (select 1 from pg_roles where rolname = 'kestra_backups') then
  raise exception 'Falta el rol kestra_backups: aplicá las migraciones pendientes ...' using errcode = '42704';
end if;

foreach f in array array['public.iniciar_respaldo(text)', ...] loop
  if to_regprocedure(f) is not null then
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to kestra_backups', f);
  end if;
end loop;
```

```sql
-- supabase/tests/database/copias_restauracion_privilegios_msf520.test.sql
grant execute on function public.iniciar_respaldo(text) to public;  -- así queda tras `--no-privileges`
revoke all on table public.respaldos from anon, authenticated;
...
select lives_ok($$select private.reaplicar_privilegios_copias();$$, 'la reparación de privilegios no lanza error');
select is(array[has_function_privilege('kestra_backups', ...), ...], array[true, false, false], '...: solo kestra_backups');
```

```js
// scripts/tests/simulacro-restauracion.test.mjs
const pasos = [
  ['caída simulada (mide la pérdida)', 'caida_simulada'],
  ['reaplicación de privilegios tras el restore', 'private.reaplicar_privilegios_copias()'],
  ['verificación de roles/grants', 'has_function_privilege'],
  ['prueba del aviso por correo', 'SOPORTE_CORREO'],
  ['cierre con staging sano (copia fresca)', 'respaldo-postgres'],
];
```

## Tests Added or Updated

- `supabase/tests/database/copias_restauracion_privilegios_msf520.test.sql` — simula el restore con
  `--no-privileges`, comprueba que el estado queda roto (RED), que `private.reaplicar_privilegios_copias()`
  lo deja como las migraciones (GREEN) y que es idempotente. Corre en el job `database` del CI
  (`pnpm test:db:ci`, pg_prove sobre `supabase/tests/database/*.sql`).
- `scripts/tests/simulacro-restauracion.test.mjs` — el protocolo tiene los pasos que miden los
  objetivos y los documentos que declaran el estado del simulacro no se contradicen. Corre en el job
  `application` (`pnpm test:docs:simulacro`), sin base ni Docker.

## Local Verification

- `pnpm docs:check` → OK («Documentación de cambios: OK (3602 archivos…)», «Migraciones OK: 714
  archivo(s), 1 nuevo(s) contra origin/dokploy», «Trampas conocidas: OK»).
- `node scripts/verificar-migraciones.mjs --base origin/dokploy` → OK (versión 20270418000301, sin
  reutilizada ni modificada).
- `pnpm db:validar:aditivas` → OK (714 migraciones, ninguna destructiva sin reversión documentada);
  `pnpm test:db:guard-migraciones` → OK.
- `pnpm lint` → exit 0 (sólo warnings preexistentes de `apps/web`); `pnpm build` → exit 0
  («✓ built in 3.06s»).
- `pnpm calidad:code` → «Todo OK» (oxlint, knip, jscpd, dependency-cruiser, syncpack; gitleaks
  saltado por `--no-docker`).
- `pnpm test:docs:simulacro` → 6/6 en verde; `pnpm test:docs:check`, `pnpm test:docs:importaciones`,
  `pnpm test:docs:pasos-manuales` → en verde.
- pgTAP: **no corrido localmente** (este entorno no tiene Docker ni Postgres de desarrollo; el CI corre
  la suite pgTAP completa sobre una base limpia en el job `database`). Ver `./test.md`.

## Deviations from Assessment

- **El simulacro no se ejecutó.** La remediación preferida del assessment era ejecutarlo con
  autorización del propietario; el gate de autorización sigue abierto, así que el entregable es el
  procedimiento completo, el bug de privilegios y los tests que lo fijan, no la corrida. El registro de
  `docs/simulacro-restauracion.md` sigue vacío y sin firma (no se inventan resultados).
- **El paso de reaplicar privilegios es una función de la base, no un `.sql` suelto.** El assessment
  proponía `scripts/reparar-privilegios-tras-restauracion.sql`; como función en `private` (creada por la
  migración) el pgTAP puede ejercer el artefacto real y el paso de operación es un `select` idempotente
  (`psql "$DATABASE_URL" -c 'select private.reaplicar_privilegios_copias();'`). El archivo suelto no
  habría podido ser verificado por el test sin depender del directorio de trabajo de `psql`.
- **La versión de la migración es `20270418000301`.** El runner la calcula: tiene que ser mayor que la
  máxima de la base real del PR (`20270349000300`, `origin/dokploy`). La rama se reconstruyó sobre esa
  base antes de commitear, así que el guard de migraciones del CI no la marca como reutilizada.
- **Se agregó un test estático del protocolo** (`scripts/tests/simulacro-restauracion.test.mjs`), que el
  assessment proponía como «test estático del runbook» y «chequeo de coherencia documental»: sin él,
  los cambios de documentación de esta historia no tenían ningún test que los vigilara.
- **No se tocaron `docs/README.md`, `docs/roadmap-template.md`, `docs/operar-sistema.md` ni
  `docs/entregar-sistema.md`.** El assessment proponía actualizarlos al cerrar el simulacro; como la
  ejecución y la firma siguen pendientes, su texto («documentado pero no ejecutado») sigue siendo
  cierto y no hay nada que corregir. El test nuevo obliga a actualizarlos juntos cuando se firme.

## Follow-ups

- **Gate de autorización (dueño: propietario del producto).** Autorizar por escrito la corrida del
  simulacro en staging (ventana de downtime, quién ejecuta, quién firma) y ejecutarlo: la guía ya
  tiene el protocolo completo y la tabla de resultados para llenar con valores medidos. Al firmarlo,
  el test `pnpm test:docs:simulacro` obliga a actualizar en el mismo cambio los documentos que declaran
  el estado.
- **SMTP de staging.** Si `KESTRA_SMTP_*` / `SOPORTE_CORREO` siguen con los valores de ejemplo
  (`smtp.example.com` / `example.com`), el paso 6 del simulacro no se puede cerrar: el aviso se pierde
  en silencio (`transmitFailed: false`). Relacionado con MSF-532.
- **Copias fuera del servidor.** El riesgo asumido (copias en el mismo servidor) sigue abierto: es un
  seguimiento aparte, no lo tapa MSF-520.
