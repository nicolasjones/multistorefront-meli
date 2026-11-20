# Bug Fix: gate objetivo del simulacro de restauración (MSF-520)

- **Slug**: msf-520
- **Fixed**: 2026-11-20
- **Assessment**: ./assessment.md
- **Status**: partial (el simulacro **no** se ejecutó: queda bajo el gate de autorización del propietario)

## Pases anteriores de esta historia

La primera pasada (PR #1054, mergeada en `dokploy`) ya había dejado el protocolo completo y
ejecutable (`docs/simulacro-restauracion.md`: correo de prueba, marcador de la caída simulada,
verificación de roles/grants, cierre de staging sano) y el arreglo del bug de privilegios del
restore (`private.reaplicar_privilegios_copias()` + su pgTAP). **Esta pasada no repite eso**: agrega
el gate que faltaba para que el resultado del simulacro sea objetivo.

## Summary

El simulacro de restauración en staging sigue sin ejecutarse ni firmarse: falta la autorización
escrita del propietario del producto (ventana, ejecutor, firmante) y eso no lo puede hacer el
agente. Lo que sí se puede cerrar en el repositorio es el hueco que hacía que el simulacro
pudiera firmarse **verde y mentiroso**: nada impedía medir un restore que no se había aplicado
(la base viva seguía ahí, la «pérdida» daba 0 h) ni un restore que había dejado la base sin los
permisos que el panel necesita (`pg_restore --no-privileges` no aplica los ACL del dump: el paso 7
del protocolo —«el panel inicia sesión, una organización conocida lista sus datos»— no podía
cumplirse).

Este cambio agrega el **gate posterior al restore**: `private.verificar_restore_simulacro(<id de la
copia>)` devuelve los ocho invariantes que tienen que cumplirse antes de medir (el restore se
aplicó, la app puede leer, `anon` no lee, el historial de copias conserva sus privilegios). Si
alguna comprobación viene con `cumple = false`, el simulacro se detiene: no se mide, no se firma.
El gate está fijo por un pgTAP que lo ejerce sobre estados que arma y desarma él mismo, y el
protocolo, la guía y el runbook están atados a él por un test estático (si el gate se pierde de la
documentación, el test se pone rojo).

## Changes

| File | Change | Notes |
|------|--------|-------|
| `supabase/migrations/20270507200101_verificacion_restore_simulacro.sql` | added | `private.verificar_restore_simulacro(bigint)`: una fila por invariante (`clave`, `cumple`, `detalle`). Aditiva, idempotente, sin tablas; `security definer` + `search_path = ''`; sólo la ejecuta el dueño (`postgres`). |
| `supabase/tests/database/simulacro_verificacion_restore_msf520.test.sql` | added test | 16 aserciones: el gate existe y no lo ejecuta la app; devuelve los ocho invariantes; detecta el restore que no se aplicó, la app sin SELECT/USAGE y el historial con `EXECUTE` para `PUBLIC`; la reparación lo deja en verde. En transacción con `rollback`. |
| `docs/simulacro-restauracion.md` | modified | Protocolo: paso 2 anota el **id** de la copia; paso 5 = reaplicar privilegios + **correr el gate** (si algo falla, el simulacro se detiene sin medir ni firmar); el registro suma la fila «Comprobaciones post-restore (gate)». El registro sigue **sin firmar**. |
| `docs/copias-y-restauracion.md` | modified | Sección A: nuevo paso 6 con el gate y qué hacer si falla (si falla la lectura de la app, hay que restaurar otra vez **sin** `--no-privileges`: el dump `pg_dump --format=custom` lleva los ACL). |
| `docs/tecnico/runbooks/db-restore.md` | modified | Runbook: paso 6 con el gate, entre el reaplicado de privilegios y la verificación final. |
| `scripts/tests/simulacro-restauracion.test.mjs` | modified | El contrato documental exige el gate en el protocolo, en la guía y en el runbook, y que el protocolo diga que un gate en rojo detiene el simulacro sin medir ni firmar (9 tests). |

## Diff Highlights

```sql
-- supabase/migrations/20270507200101_verificacion_restore_simulacro.sql
select exists (select 1 from public.respaldos where id = p_copia_id),
       count(*) filter (where id > p_copia_id)
  into v_existe, v_posteriores
  from public.respaldos;

cumple := v_existe and v_posteriores = 0;   -- restore_aplicado
detalle := case
  when v_posteriores > 0 then format('la base tiene %s respaldo(s) posteriores a la copia %s: el restore no se aplicó', ...)
  ...
```

```sql
-- supabase/tests/database/simulacro_verificacion_restore_msf520.test.sql
grant execute on function public.iniciar_respaldo(text) to public;
select is(
  (select cumple from private.verificar_restore_simulacro((select id from copia_simulacro))
    where clave = 'historial_solo_kestra'),
  false,
  'con EXECUTE para PUBLIC, cualquiera puede escribir el historial de copias'
);
```

## Tests Added or Updated

- `supabase/tests/database/simulacro_verificacion_restore_msf520.test.sql` — 16 aserciones sobre el
  gate (falla antes del arreglo, verde después; y la reparación del historial lo deja en verde).
  Corre en el job `database` del CI (`pnpm test:db:ci`, `pg_prove` sobre
  `supabase/tests/database/*.sql`).
- `scripts/tests/simulacro-restauracion.test.mjs` — 9 tests: el protocolo, la guía y el runbook
  tienen que incluir el gate (y decir que un gate en rojo detiene el simulacro). Corre en el job
  `application` (`pnpm test:docs:simulacro`), sin base ni Docker.

## Local Verification

- `pnpm test:docs:simulacro` → 9/9 en verde.
- Mutaciones (FEAT-236): sin el gate en el protocolo / en la guía / en el runbook, o sin el «no se
  mide, no se firma», el test correspondiente queda en rojo (se revirtieron después).
- `pnpm lint` → exit 0 (warnings preexistentes de `apps/web`); `pnpm build` → exit 0.
- `pnpm docs:check` → OK; `node scripts/verificar-migraciones.mjs --base origin/dokploy` → OK
  (1 migración nueva, versión `20270507200101`, sin reutilizada ni modificada);
  `pnpm db:validar:aditivas` → OK; `pnpm test:db:guard-migraciones` → OK.
- `pnpm calidad:code` → «Todo OK».
- pgTAP: **no corrido localmente** (este entorno no tiene Docker ni Postgres de desarrollo; el CI
  corre la suite pgTAP completa sobre una base limpia en el job `database`). La sintaxis SQL de la
  migración y del test se validó con `pglast` (parser de PostgreSQL): 3 y 30 sentencias, sin
  errores. Ver `./test.md`.

## Deviations from Assessment

- **El simulacro no se ejecutó.** La remediación preferida del assessment era ejecutarlo con
  autorización del propietario; el gate sigue abierto, así que el entregable es el gate, el
  protocolo y los tests que lo fijan, no la corrida. El registro de `docs/simulacro-restauracion.md`
  sigue vacío y sin firma (no se inventan resultados).
- **El paso dePrivilegios del assessment era «re-aplicar privilegios» a mano; el gate lo hace
  comprobable.** La idea del assessment (agregar un paso de privilegios después del restore) ya
  estaba implementada en la primera pasada (`private.reaplicar_privilegios_copias()`); lo que
  faltaba era poder **comprobar** el estado de la base restaurada de forma objetiva, y eso es lo
  que hace el gate (además de los permisos de la app, que la primera pasada no cubría).
- **No se cambió el comando del restore.** El assessment proponía, como alternativa, sacar
  `--no-privileges`; no se hizo en esta pasada: el gate detecta el caso y dice qué hacer
  (restaurar otra vez sin `--no-privileges`), y cambiar el procedimiento queda para cuando haya
  una corrida real que lo valide.

## Follow-ups

- **Gate de autorización (dueño: propietario del producto).** Autorizar por escrito la corrida del
  simulacro en staging (ventana, ejecutor, firmante) y ejecutarlo: la guía ya tiene el protocolo
  completo, el gate y la tabla de resultados para llenar con valores medidos. Al firmarlo, el test
  `pnpm test:docs:simulacro` obliga a actualizar en el mismo cambio los documentos que declaran el
  estado.
- **SMTP de staging.** Si `KESTRA_SMTP_*` / `SOPORTE_CORREO` siguen con los valores de ejemplo
  (`smtp.example.com` / `example.com`), el paso 6 del simulacro no se puede cerrar: el aviso se
  pierde en silencio (`transmitFailed: false`). Relacionado con MSF-532.
- **Copias fuera del servidor.** El riesgo asumido (copias en el mismo servidor) sigue abierto: es
  un seguimiento aparte, no lo tapa MSF-520.
