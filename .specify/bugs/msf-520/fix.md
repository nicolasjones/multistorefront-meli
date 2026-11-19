# Bug Fix: el simulacro de restauración es ejecutable y su restore deja la base como la copia

- **Slug**: msf-520
- **Fixed**: 2026-11-19 (segunda pasada; la primera, 2026-11-15, es el PR #1054)
- **Assessment**: ./assessment.md
- **Status**: applied (el simulacro **no** se ejecutó: queda bajo el gate de autorización del propietario)

## Summary

El simulacro de restauración en staging no se había ejecutado nunca (T018 se cerró con `Desvío:` por
falta de autorización) y el procedimiento documentado, tal como estaba, **no era ejecutable de punta a
punta**: le faltaban el envío de prueba del aviso por correo, la definición de la «caída simulada» que
hace falta para medir la pérdida como número, la verificación de roles/grants sobre la base restaurada
y el paso de dejar staging sano.

Esta historia se dividió en dos pasadas porque la primera no terminó el trabajo:

- **Primera pasada (PR #1054, mergeada):** el protocolo quedó completo (nueve pasos) y se arregló el
  defecto que el propio procedimiento destapaba: el `pg_restore` documentado usaba `--no-privileges`,
  de modo que las nueve funciones `security definer` del historial de copias quedaban ejecutables por
  `PUBLIC` (un `anon` podía escribir el historial) y las tablas sin lectura para `authenticated`. Se
  agregó `private.reaplicar_privilegios_copias()` con su pgTAP y el test estático del protocolo.
- **Esta pasada:** el procedimiento de restore que el simulacro usa tenía **dos defectos más**, que lo
  harían fallar aun con autorización del propietario:
  1. **Perdía los permisos del dump** (`--no-privileges`): como `--clean` recrea cada objeto, la base
     restaurada quedaba con los permisos por defecto y, en este proyecto (permisos explícitos por
     tabla, `auto_expose_new_tables = false`), `authenticated` no leía: el paso 7 del simulacro («el
     panel inicia sesión, una organización conocida lista sus datos») fallaba.
  2. **Era atómico y no dejaba rastro si abortaba**: `--single-transaction` implica `--exit-on-error`,
     así que un restore abortado deja la base como estaba. El simulacro no comprobaba que la base
     restaurada fuera la de la copia: el panel seguiría respondiendo con los datos vivos, la pérdida
     medida daría 0 y el simulacro se podía firmar como **verde mentiroso**.

**No se ejecutó el simulacro ni se firmó el registro**: eso queda bajo el gate de autorización del
propietario (Nicolás).

## Changes

### Esta pasada

| File | Change | Notes |
|------|--------|-------|
| `docs/copias-y-restauracion.md` | modified | Sección A: el restore saca `--no-privileges` (aplica los permisos del dump) y explica por qué; el restore es atómico y qué hacer si aborta; paso nuevo de migraciones pendientes; la verificación mira lo que el panel necesita para servir datos. |
| `docs/simulacro-restauracion.md` | modified | Protocolo: paso 2 anota el `iniciado_en` de la copia; paso 4 dice que el restore aplica los permisos y es atómico; **paso 5 nuevo**: comprobar que la base restaurada es la de la copia antes de medir. El registro sigue **sin firmar**. |
| `docs/tecnico/runbooks/db-restore.md` | modified | Runbook alineado: aplica los permisos del dump, es atómico, aplica las migraciones pendientes y verifica que la base restaurada tenga los datos de la copia. |
| `scripts/tests/simulacro-restauracion.test.mjs` | modified test | 6 tests nuevos que fijan el contrato del restore (permisos del dump, atomicidad, migraciones pendientes, verificación del panel, chequeo de la copia). 12/12 en verde. |
| `supabase/tests/database/copias_restauracion_privilegios_msf520.test.sql` | modified test | Sólo el encabezado: el test simula ahora una copia **más vieja** que la migración de los permisos (el caso que la reparación cubre), no el `--no-privileges` del procedimiento anterior. Las 19 aserciones no cambian. |

### Primera pasada (PR #1054, ya mergeada)

| File | Change | Notes |
|------|--------|-------|
| `supabase/migrations/20270418000301_reaplica_privilegios_copias.sql` | added | `private.reaplicar_privilegios_copias()`: reaplica los ACL del historial de copias (funciones: sólo `kestra_backups`; tablas: lectura de `authenticated` con RLS). Aditiva, idempotente y sin tablas. |
| `supabase/tests/database/copias_restauracion_privilegios_msf520.test.sql` | added test | Simula el restore sin permisos (RED) y comprueba que la reparación deja el invariante de `copias_imagenes_verificaciones.test.sql:29-50`. 19 aserciones, en transacción con `rollback`. |
| `scripts/tests/simulacro-restauracion.test.mjs` | added test | Fija el protocolo (caída simulada, privilegios, aviso por correo, cierre con staging sano, objetivos 24 h/4 h) y que los documentos que declaran el estado del simulacro no se contradigan. |
| `docs/simulacro-restauracion.md`, `docs/copias-y-restauracion.md`, `docs/tecnico/runbooks/db-restore.md` | modified | Protocolo completo (9 pasos) y paso de reaplicar privilegios. |
| `package.json`, `.github/workflows/validate.yml` | modified | `pnpm test:docs:simulacro` en la suite y en el job `application` del CI. |

## Diff Highlights

```bash
# docs/copias-y-restauracion.md (sección A, paso 4)
pg_restore --dbname="$DATABASE_URL" --clean --if-exists --no-owner \
  --single-transaction respaldo.dump
```

```sql
-- docs/simulacro-restauracion.md (protocolo, paso 5): la base restaurada tiene que
-- ser la de la copia; si no, el simulacro se detiene sin medir ni firmar.
select max(creado_en) as ultimo_dato_restaurado from public.registro_actividad;
```

```js
// scripts/tests/simulacro-restauracion.test.mjs
test('el restore documentado aplica los permisos del dump', () => {
  assert.ok(!comandoRestore.includes('--no-privileges'), '…')
})
```

## Tests Added or Updated

- `scripts/tests/simulacro-restauracion.test.mjs` — el contrato del procedimiento (que falle si
  vuelve `--no-privileges`, si el restore deja de ser atómico, si se saca el paso de migraciones
  pendientes, si se saca la verificación de permisos del panel o si se saca el chequeo de que la base
  restaurada es la de la copia). Corre en el job `application` (`pnpm test:docs:simulacro`), sin base
  ni Docker.
- `supabase/tests/database/copias_restauracion_privilegios_msf520.test.sql` — sigue vigilando el
  invariante de privilegios del historial de copias (19 aserciones, sin cambios). Corre en el job
  `database` del CI (`pnpm test:db:ci`, `pg_prove` sobre `supabase/tests/database/*.sql`).

## Local Verification

- `pnpm test:docs:simulacro` → 12/12 en verde.
- `pnpm docs:check` → OK («Documentación de cambios: OK (4251 archivos comparados…)», «Migraciones OK:
  771 archivo(s), 0 nuevo(s) contra origin/dokploy», «Trampas conocidas: OK»).
- `pnpm test:docs:check` → 171/171 en verde.
- `pnpm lint` → exit 0 (sólo warnings preexistentes de `apps/web`); `pnpm build` → exit 0
  («✓ built in 1.89s»).
- `pnpm calidad:code` → «Todo OK» (oxlint, knip, jscpd, dependency-cruiser, syncpack; gitleaks
  saltado por `--no-docker`).
- Mutaciones (FEAT-236): cinco mutaciones sobre los documentos (restauradas después), cada una deja
  al menos un test en rojo. Ver `./test.md`.
- pgTAP: **no corrido localmente** (este entorno no tiene Docker ni Postgres de desarrollo; el CI
  corre la suite pgTAP completa sobre una base limpia en el job `database`). Ver `./test.md`.

## Deviations from Assessment

- **El simulacro no se ejecutó.** La remediación preferida del assessment era ejecutarlo con
  autorización del propietario; el gate sigue abierto, así que el entregable es el procedimiento
  completo, los defectos que lo bloqueaban y los tests que los fijan, no la corrida. El registro de
  `docs/simulacro-restauracion.md` sigue vacío y sin firma (no se inventan resultados).
- **El restore deja de usar `--no-privileges`.** El assessment proponía «re-aplicar privilegios tras
  restaurar» como red; esa red queda sólo para el historial de copias (copias más viejas que la
  migración que fijó sus permisos). Para el resto del schema, lo correcto es que el restore aplique
  los que ya viajan en el dump: inventar una función que replique ~1.500 `grant` sería peor que
  dejar que los aplique el propio restore.
- **No se editó la migración `20270418000301_reaplica_privilegios_copias.sql`** (ya aplicada; el
  guard de migraciones bloquea editarla): su encabezado sigue describiendo el procedimiento
  anterior. La guía lo aclara en una nota junto al paso que la usa.
- **No se tocó el flow `verificar-restauracion`**: su contrato es comprobar que el restore termina y
  que las tablas esperadas tienen datos, en un Postgres aislado sin los roles del app; los permisos
  no son parte de ese contrato.
- **No se tocaron `docs/README.md`, `docs/roadmap-template.md`, `docs/operar-sistema.md` ni
  `docs/entregar-sistema.md`**: su texto («documentado pero no ejecutado») sigue siendo cierto hasta
  que haya corrida y firma; el test de coherencia obliga a actualizarlos juntos cuando se firme.

## Follow-ups

- **Gate de autorización (dueño: propietario del producto).** Autorizar por escrito la corrida del
  simulacro en staging (ventana de downtime, quién ejecuta, quién firma) y ejecutarlo: la guía ya
  tiene el protocolo completo y la tabla de resultados para llenar con valores medidos. Al firmarlo,
  el test `pnpm test:docs:simulacro` obliga a actualizar en el mismo cambio los documentos que
  declaran el estado.
- **SMTP de staging.** Si `KESTRA_SMTP_*` / `SOPORTE_CORREO` siguen con los valores de ejemplo
  (`smtp.example.com` / `example.com`), el paso 7 del simulacro no se puede cerrar: el aviso se pierde
  en silencio (`transmitFailed: false`). Relacionado con MSF-532.
- **Copias fuera del servidor.** El riesgo asumido (copias en el mismo servidor) sigue abierto: es un
  seguimiento aparte, no lo tapa MSF-520.
