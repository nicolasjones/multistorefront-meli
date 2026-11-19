# Bug Verification: el simulacro de restauración es ejecutable y su restore deja la base como la copia

- **Slug**: msf-520
- **Tested**: 2026-11-19 (segunda pasada; la primera, 2026-11-15, es el PR #1054)
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

Los dos defectos que bloqueaban la corrida del simulacro están verificados y cerrados: el restore ya
**aplica los permisos del dump** (antes los perdía con `--no-privileges`, y en este proyecto los
permisos son explícitos por tabla, así que el panel no habría podido leer la base restaurada) y el
protocolo **comprueba que la base restaurada sea la de la copia** antes de medir (un restore atómico
que aborta deja la base viva: sin ese chequeo, la pérdida mediría 0 y el simulacro se firmaría como
un verde mentiroso). Los seis tests nuevos fallan si esas reglas se rompen.

**El simulacro en staging no se ejecutó ni se firmó**: eso sigue bajo el gate de autorización del
propietario, así que el síntoma original («no hay simulacro medido ni firmado») permanece por diseño y
el resultado es `partial`, no `verified`.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| El restore aplica los permisos del dump | `pnpm test:docs:simulacro` | pass | 12/12: el comando de restore no usa `--no-privileges` y la guía dice por qué (`auto_expose_new_tables = false`). |
| El restore es atómico y la guía avisa | `pnpm test:docs:simulacro` | pass | `--single-transaction` está en el comando y la guía y el runbook avisan que un restore abortado deja la base como estaba. |
| El simulacro comprueba que la base es la de la copia | `pnpm test:docs:simulacro` | pass | El protocolo compara `ultimo_dato_restaurado` con el `iniciado_en` de la copia y dice que, si no, se detiene sin medir ni firmar. |
| Migraciones pendientes sobre la base restaurada | `pnpm test:docs:simulacro` | pass | La guía tiene el comando `supabase db push --db-url`. |
| La verificación mira lo que el panel necesita | `pnpm test:docs:simulacro` | pass | `has_schema_privilege` sobre `private`, lectura de `public.organizaciones` y `dominio.empresas`, `anon` sin lectura. |
| Coherencia del estado del simulacro | `pnpm test:docs:simulacro` | pass | El registro sigue sin firmar y los documentos que declaran el estado no se contradicen. |
| El test detecta la regla (FEAT-236) | cinco mutaciones sobre los documentos (restauradas después) | pass (como debe) | Ver «Mutaciones» abajo: cada una deja al menos un test en rojo. |
| Documentación del cambio | `pnpm docs:check` | pass | «Documentación de cambios: OK (4251 archivos comparados…)» + «Trampas conocidas: OK». |
| Tests de documentación | `pnpm test:docs:check` | pass | 171/171 en verde. |
| Lint / build | `pnpm lint`, `pnpm build` | pass | lint exit 0 (warnings preexistentes de `apps/web`); build exit 0 («✓ built in 1.89s»). |
| Calidad determinista | `pnpm calidad:code` | pass | «Todo OK» (oxlint, knip, jscpd, dependency-cruiser, syncpack; gitleaks omitido por `--no-docker`). |
| Migraciones | `pnpm docs:check` | pass | «Migraciones OK: 771 archivo(s), 0 nuevo(s) contra origin/dokploy»: esta pasada no crea ni modifica migraciones. |
| pgTAP del repo | `pnpm test:db:ci` | not-run | Este entorno no tiene Docker ni Postgres de desarrollo: la suite pgTAP la corre el CI (job `database`, `pg_prove` sobre `supabase/tests/database/*.sql`) sobre una base limpia. El archivo de MSF-520 no cambió sus aserciones (sólo el encabezado). |
| Simulacro en staging | — | skipped | Sin autorización sobre staging (no es ejecutable por el agente). El registro de resultados sigue vacío y sin firma. |

## Mutaciones (FEAT-236: el test tiene que FALLAR si la regla cambia)

Cada mutación se hizo sobre una copia de los documentos en `/tmp` y se revirtió después:

| # | Mutación | Resultado esperado | Resultado real |
|---|----------|--------------------|----------------|
| M1 | Se vuelve a poner `--no-privileges` en el comando de restore | falla el test de los permisos del dump | ✖ «el restore documentado aplica los permisos del dump» (11/12 en verde) |
| M2 | Se saca `--single-transaction` del comando de restore | falla el test de la atomicidad | ✖ «el restore es atómico y la guía dice qué pasa si aborta» (11/12) |
| M3 | Se borra el paso 5 del protocolo (el chequeo de que la base restaurada es la de la copia) | fallan el test de los pasos y el del chequeo | ✖ «el protocolo del simulacro tiene los pasos que miden los objetivos» + ✖ «el simulacro comprueba que la base restaurada es la de la copia» (10/12) |
| M4 | Se saca el `supabase db push` del bloque de código de la guía | falla el test de las migraciones pendientes | ✖ «el procedimiento aplica las migraciones pendientes sobre la base restaurada» (11/12) |
| M5 | Se sacan `has_schema_privilege` y `dominio.empresas` de la verificación | falla el test de la verificación del panel | ✖ «la verificación comprueba que el panel puede leer, no sólo el historial de copias» (11/12) |

```
# M1
✖ el restore documentado aplica los permisos del dump
# M2
✖ el restore es atómico y la guía dice qué pasa si aborta
# M3
✖ el protocolo del simulacro tiene los pasos que miden los objetivos
✖ el simulacro comprueba que la base restaurada es la de la copia
# M4
✖ el procedimiento aplica las migraciones pendientes sobre la base restaurada
# M5
✖ la verificación comprueba que el panel puede leer, no sólo el historial de copias
```

## Output Excerpts

```
$ pnpm test:docs:simulacro
✔ el protocolo del simulacro tiene los pasos que miden los objetivos
✔ contrato de la guía: el paso 1 manda confirmar el host de staging ANTES de restaurar
✔ el protocolo declara los dos objetivos del criterio (pérdida ≤ 24 h y tiempo ≤ 4 h)
✔ la guía de restauración y el runbook incluyen el paso de reaplicar privilegios
✔ el restore documentado aplica los permisos del dump
✔ el restore es atómico y la guía dice qué pasa si aborta
✔ el simulacro comprueba que la base restaurada es la de la copia
✔ el procedimiento aplica las migraciones pendientes sobre la base restaurada
✔ la verificación comprueba que el panel puede leer, no sólo el historial de copias
✔ el registro del simulacro tiene los campos para medir y para firmar
✔ el estado y la firma del propio documento no se contradicen
✔ los documentos que declaran el estado del simulacro no se contradicen entre sí
ℹ pass 12
ℹ fail 0
```

```
$ pnpm docs:check
Documentación de cambios: OK (4251 archivos comparados contra 54ea7b1bad793d5968ffe2d1f629128c40f3bee3).
Migraciones OK: 771 archivo(s), 0 nuevo(s) contra origin/dokploy.
Trampas conocidas: OK (0 migración(es), 1 prueba(s) pgTAP y 0 E2E revisados contra origin/dokploy).

$ pnpm calidad:code
---- RESUMEN ----
  saltado    gitleaks (secretos)
  ok         oxlint (SAST)
  ok         knip (código muerto)
  ok         jscpd (duplicación)
  ok         dependency-cruiser (arquitectura)
  ok         syncpack (versiones)
Todo OK.
```

## Residual Risks

- **El pgTAP del repo no se corrió localmente** (sin Docker ni Postgres de desarrollo): lo corre el CI
  en el job `database`. Lo que no se probó localmente es el pgTAP sobre la base de la plataforma (roles
  `anon`/`authenticated`/`kestra_backups` reales y las migraciones completas).
- **El simulacro en staging sigue sin ejecutarse**: los objetivos RPO ≤ 24 h y RTO ≤ 4 h (FR-011,
  SC-002) no están medidos ni firmados. Ningún cambio de este PR altera ese estado.
- **El restore ahora aplica los permisos del dump**: exige que el destino tenga los roles que el dump
  menciona (en staging, la misma base: ya están). Si falta alguno, el restore aborta y no deja nada
  restaurado —el paso 5 del protocolo lo detecta, pero la corrida se pierde.
- Si `KESTRA_SMTP_*` / `SOPORTE_CORREO` de staging siguen con los valores de ejemplo, el paso 7 del
  simulacro (aviso por correo) no se puede cerrar: con `transmitFailed: false` el aviso se pierde en
  silencio.
- La base restaurada puede ser **más vieja** que la migración que crea
  `private.reaplicar_privilegios_copias()`: en ese caso hay que aplicar las migraciones pendientes
  (`supabase db push`) antes de ejecutar el paso. La función lo dice con un error explícito y está
  escrito en la guía y en el runbook.
- La migración `20270418000301_reaplica_privilegios_copias.sql` conserva el encabezado de la primera
  pasada (describe el procedimiento con `--no-privileges`): está aplicada y no se edita; la guía lo
  aclara junto al paso que la usa.

## Recommendation

Cerrar la parte técnica de MSF-520 (el procedimiento que el simulacro usa, corregido y con los tests
que lo vigilan) y dejar la historia en «espera de autorización»: el simulacro queda bajo el gate del
propietario del producto. Cuando haya autorización escrita (ventana, ejecutor, firmante), se ejecuta el
protocolo de `docs/simulacro-restauracion.md` tal como está, se completan la tabla de resultados con
valores medidos y la firma, y recién ahí el simulacro cierra FR-011 / SC-002.
