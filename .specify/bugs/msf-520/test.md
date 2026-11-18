# Bug Verification: el simulacro de restauración deja la base sin permisos del app

- **Slug**: msf-520
- **Tested**: 2026-11-18 (segunda pasada)
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

El defecto está cerrado en el procedimiento: el restore documentado **aplica los permisos del dump**
(saca `--no-privileges`), es **atómico** (`--exit-on-error` con `--single-transaction`), **cierra la
diferencia de esquema** con las migraciones pendientes y la verificación del simulacro mira **lo que
el app necesita para servir datos** (`USAGE` sobre `private`, lectura de `public.organizaciones` y
`dominio.empresas`, `anon` sin lectura), no sólo las nueve funciones del historial. Los tests que
vigilan cada una de esas reglas fallan si el procedimiento vuelve atrás (mutaciones abajo).

**El simulacro en staging no se ejecutó ni se firmó**: eso sigue bajo el gate de autorización del
propietario, así que el síntoma original («no hay simulacro medido ni firmado») permanece por diseño
y el resultado es `partial`, no `verified`. La segunda pasada lo que hace es que, cuando haya
autorización, el simulacro no falle en el paso 7 por una base sin permisos.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Contrato del procedimiento | `pnpm test:docs:simulacro` | pass | 10/10 (6 de la primera pasada + 4 nuevos). |
| El test detecta la regla (FEAT-236) | cuatro mutaciones sobre los documentos (revertidas después) | pass (como debe) | Ver «Mutaciones» abajo: cada una deja el test correspondiente en rojo. |
| Documentación del cambio | `pnpm docs:check` | pass | «Documentación de cambios: OK (4251 archivos comparados…)» + «Migraciones OK: 771 archivo(s), 0 nuevo(s) contra origin/dokploy» + «Trampas conocidas: OK». |
| Tests de documentación | `pnpm test:docs:check`, `pnpm test:docs:manifest`, `pnpm test:docs:importaciones`, `pnpm test:docs:pasos-manuales` | pass | Todos en verde. |
| Lint | `pnpm lint` | pass | exit 0 (los warnings son preexistentes de `apps/web` y no tocan este cambio). |
| Build | `pnpm build` | pass | exit 0 («✓ built in 2.96s»). |
| Calidad determinista | `pnpm calidad:code` | pass | «Todo OK» (oxlint, knip, jscpd, dependency-cruiser, syncpack; gitleaks omitido por `--no-docker`). |
| Migraciones | — | n/a | Esta entrega **no crea migración**: el cambio es de procedimiento y de tests. La función `private.reaplicar_privilegios_copias()` de la primera pasada se mantiene. |
| pgTAP del repo | `pnpm test:db:ci` | not-run | Este entorno no tiene Docker ni Postgres de desarrollo: la suite pgTAP la corre el CI (job `database`, `pg_prove` sobre `supabase/tests/database/*.sql`) sobre una base limpia. |
| Simulacro en staging | — | skipped | Sin autorización sobre staging (no es ejecutable por el agente). El registro de resultados sigue vacío y sin firma. |

## Mutaciones (FEAT-236: el test tiene que FALLAR si la regla cambia)

Cada mutación se hizo sobre los documentos reales del repo y se revirtió después (verificado: los
archivos quedaron idénticos a los originales).

| # | Mutación | Resultado esperado | Resultado real |
|---|----------|-------------------|----------------|
| M5 | Vuelve `--no-privileges` al comando de restore | falla el test del restore | ✖ «el restore documentado aplica los permisos del dump y es atómico» |
| M6 | Saca `--exit-on-error` del comando de restore | falla el test del restore | ✖ «el restore documentado aplica los permisos del dump y es atómico» |
| M7 | Saca el paso de migraciones pendientes de la guía | falla el test de la deriva | ✖ «el procedimiento aplica las migraciones pendientes sobre la base restaurada» |
| M8 | Saca la verificación de permisos del app del protocolo | falla el test de la verificación | ✖ «la verificación comprueba que el app puede leer, no sólo el historial de copias» |

```
# M5 y M6
✖ el restore documentado aplica los permisos del dump y es atómico
# M7
✖ el procedimiento aplica las migraciones pendientes sobre la base restaurada
# M8
✖ la verificación comprueba que el app puede leer, no sólo el historial de copias
```

## Output Excerpts

```
$ pnpm test:docs:simulacro
✔ el protocolo del simulacro tiene los pasos que miden los objetivos
✔ contrato de la guía: el paso 1 manda confirmar el host de staging ANTES de restaurar
✔ el protocolo declara los dos objetivos del criterio (pérdida ≤ 24 h y tiempo ≤ 4 h)
✔ la guía de restauración y el runbook incluyen el paso de reaplicar privilegios
✔ el restore documentado aplica los permisos del dump y es atómico
✔ el procedimiento aplica las migraciones pendientes sobre la base restaurada
✔ la verificación comprueba que el app puede leer, no sólo el historial de copias
✔ el registro del simulacro tiene los campos para medir y para firmar
✔ el estado y la firma del propio documento no se contradicen
✔ los documentos que declaran el estado del simulacro no se contradicen entre sí
ℹ pass 10
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
- **El restore con permisos exige que el destino tenga los roles que el dump referencia** (en el
  simulacro es la misma base de la que salió la copia; para restaurar en otro ambiente hay que
  compararlos antes). Con `--exit-on-error --single-transaction`, si falta un rol el restore aborta y
  la base queda como estaba.
- **La diferencia de esquema se cierra con las migraciones pendientes**, no con las ya aplicadas: si
  una migración ya aplicada en la base original cambió permisos o estructuras y la copia es anterior,
  el dump trae el estado viejo. `private.reaplicar_privilegios_copias()` cubre el historial de
  copias; el resto del schema queda como lo dejó el dump.
- Si `KESTRA_SMTP_*` / `SOPORTE_CORREO` de staging siguen con los valores de ejemplo, el paso 6 del
  simulacro (aviso por correo) no se puede cerrar: con `transmitFailed: false` el aviso se pierde en
  silencio.

## Recommendation

Cerrar la parte técnica de MSF-520 (el procedimiento que deja la base restaurada con los permisos
del app y los tests que lo fijan) y dejar la historia en «espera de autorización»: el simulacro queda
bajo el gate del propietario del producto. Cuando haya autorización escrita (ventana, ejecutor,
firmante), se ejecuta el protocolo de `docs/simulacro-restauracion.md` tal como está, se completan la
tabla de resultados con valores medidos y la firma, y recién ahí el simulacro cierra FR-011 / SC-002.
