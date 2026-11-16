# Bug Verification: protocolo de simulacro de restauración ejecutable y privilegios del restore

- **Slug**: msf-520
- **Tested**: 2026-11-15
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

El bug de privilegios del restore está verificado y cerrado: con `pg_restore --no-privileges` las nueve
funciones `security definer` del historial de copias quedan ejecutables por `PUBLIC` (cualquiera,
incluido `anon` vía PostgREST, podría escribir el historial) y las tres tablas del historial quedan sin
lectura para `authenticated`; `private.reaplicar_privilegios_copias()` deja el estado tal como lo
dejaron las migraciones, y el pgTAP lo vigila. Los cuatro huecos del protocolo (correo de prueba,
marcador de la caída simulada, verificación de roles/grants y cierre de staging sano) están escritos y
fijados por un test que falla si se pierden. **El simulacro en staging no se ejecutó ni se firmó**:
eso sigue bajo el gate de autorización del propietario, así que el síntoma original («no hay simulacro
medido ni firmado») permanece por diseño y el resultado es `partial`, no `verified`.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Migración válida y versionada | `node scripts/verificar-migraciones.mjs --base origin/dokploy` | pass | Versión `20270418000301`: mayor que la máxima de la base real del PR (`20270349000300`), sin reutilizada ni modificada. «Migraciones OK: 714 archivo(s), 1 nuevo(s)». |
| Migración aditiva | `pnpm db:validar:aditivas` | pass | 714 migraciones verificadas: ninguna destructiva sin camino de reversión documentado. |
| Guard de DDL con idempotencia | `pnpm test:db:guard-migraciones` | pass | La migración nueva (`create or replace function`) no dispara el detector. |
| Documentación del cambio | `pnpm docs:check` | pass | «Documentación de cambios: OK (3602 archivos…)» + «Trampas conocidas: OK». |
| Protocolo del simulacro completo | `pnpm test:docs:simulacro` | pass | 6/6: pasos que miden los objetivos, objetivos 24 h/4 h, paso de privilegios en la guía y el runbook, campos del registro, coherencia del estado. |
| El test detecta la regla (FEAT-236) | cuatro mutaciones sobre los documentos (restauradas después) | pass (como debe) | Ver «Mutaciones» abajo: cada una deja al menos un test en rojo. |
| Lint / build | `pnpm lint`, `pnpm build` | pass | lint exit 0 (warnings preexistentes de `apps/web`); build exit 0 («✓ built in 3.06s»). |
| Calidad determinista | `pnpm calidad:code` | pass | «Todo OK» (oxlint, knip, jscpd, dependency-cruiser, syncpack; gitleaks omitido por `--no-docker`). |
| Tests de documentación | `pnpm test:docs:check`, `pnpm test:docs:importaciones`, `pnpm test:docs:pasos-manuales` | pass | Todos en verde. |
| pgTAP del repo | `pnpm test:db:ci` | not-run | Este entorno no tiene Docker ni Postgres de desarrollo: la suite pgTAP la corre el CI (job `database`, `pg_prove` sobre `supabase/tests/database/*.sql`) sobre una base limpia. |
| Simulacro en staging | — | skipped | Sin autorización sobre staging (no es ejecutable por el agente). El registro de resultados sigue vacío y sin firma. |

## Mutaciones (FEAT-236: el test tiene que FALLAR si la regla cambia)

Cada mutación se hizo sobre una copia de los documentos en `/tmp` y se revirtió después:

| # | Mutación | Resultado esperado | Resultado real |
|---|----------|--------------------|----------------|
| M1 | Se borra el paso de la «caída simulada» (`caida_simulada`) del protocolo | falla el test de los pasos | ✖ «el protocolo del simulacro tiene los pasos que miden los objetivos» (5/6 en verde) |
| M2 | Se borra `private.reaplicar_privilegios_copias()` de la guía de copias | falla el test de la guía y el runbook | ✖ «la guía de restauración y el runbook incluyen el paso de reaplicar privilegios» (5/6) |
| M3 | Se carga la firma del propietario sin cambiar el estado del documento | fallan los dos tests de coherencia | ✖ «el estado y la firma del propio documento no se contradicen» + «los documentos que declaran el estado del simulacro no se contradicen entre sí» (4/6) |
| M4 | `docs/README.md` dice que el simulacro ya se ejecutó (sigue pendiente) | falla la coherencia entre documentos | ✖ «los documentos que declaran el estado del simulacro no se contradicen entre sí» (5/6) |

```
# M1
✖ el protocolo del simulacro tiene los pasos que miden los objetivos
# M3
✖ el estado y la firma del propio documento no se contradicen
✖ los documentos que declaran el estado del simulacro no se contradicen entre sí
# M4
✖ los documentos que declaran el estado del simulacro no se contradicen entre sí
```

## Output Excerpts

```
$ pnpm test:docs:simulacro
✔ el protocolo del simulacro tiene los pasos que miden los objetivos
✔ el protocolo declara los dos objetivos del criterio (pérdida ≤ 24 h y tiempo ≤ 4 h)
✔ la guía de restauración y el runbook incluyen el paso de reaplicar privilegios
✔ el registro del simulacro tiene los campos para medir y para firmar
✔ el estado y la firma del propio documento no se contradicen
✔ los documentos que declaran el estado del simulacro no se contradicen entre sí
ℹ pass 6
ℹ fail 0
```

```
$ pnpm docs:check
Documentación de cambios: OK (3602 archivos comparados contra 54ea7b1bad793d5968ffe2d1f629128c40f3bee3).
Migraciones OK: 714 archivo(s), 1 nuevo(s) contra origin/dokploy.
Trampas conocidas: OK (1 migración(es), 1 prueba(s) pgTAP y 0 E2E revisados contra origin/dokploy).

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
- Si `KESTRA_SMTP_*` / `SOPORTE_CORREO` de staging siguen con los valores de ejemplo, el paso 6 del
  simulacro (aviso por correo) no se puede cerrar: con `transmitFailed: false` el aviso se pierde en
  silencio.
- La base restaurada puede ser **más vieja** que la migración que crea
  `private.reaplicar_privilegios_copias()`: en ese caso hay que aplicar las migraciones pendientes
  (`supabase migration up`) antes de ejecutar el paso. La función lo dice con un error explícito y está
  escrito en la guía y en el runbook.
- `pg_restore --no-privileges` tampoco restaura los ACL de **otras** tablas del sistema: la
  reparación cubre sólo el historial de copias (el alcance de MSF-520). Para el resto del schema, los
  ACL se dejan aplicando `supabase migration up` sobre la base restaurada.

## Recommendation

Cerrar la parte técnica de MSF-520 (el bug de privilegios, el protocolo completo y los tests que lo
fijan) y dejar la historia en «espera de autorización»: el simulacro queda bajo el gate del
propietario del producto. Cuando haya autorización escrita (ventana, ejecutor, firmante), se ejecuta el
protocolo de `docs/simulacro-restauracion.md` tal como está, se completan la tabla de resultados con
valores medidos y la firma, y recién ahí el simulacro cierra FR-011 / SC-002.
