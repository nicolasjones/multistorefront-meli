# Bug Verification: gate objetivo del simulacro de restauración (MSF-520)

- **Slug**: msf-520
- **Tested**: 2026-11-20
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

El gate posterior al restore está verificado y cerrado: `private.verificar_restore_simulacro()` existe,
no la puede ejecutar la app, devuelve los ocho invariantes del simulacro y **detecta** los dos fallos
que hacían posible firmar un simulacro verde mentiroso (un restore que no se aplicó —la base viva
sigue ahí, la pérdida mediría 0 h— y una base restaurada sin los permisos que el panel necesita). El
protocolo, la guía de restauración y el runbook están atados al gate por un test estático que se
pone rojo si el gate se pierde de la documentación.

**El simulacro en staging no se ejecutó ni se firmó**: eso sigue bajo el gate de autorización del
propietario del producto, así que el síntoma original («no hay simulacro medido ni firmado»)
permanece por diseño y el resultado es `partial`, no `verified`.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Gate: existe y es de operación | pgTAP `simulacro_verificacion_restore_msf520.test.sql` | not-run | Este entorno no tiene Docker ni Postgres de desarrollo: lo corre el CI (job `database`, `pg_prove` sobre `supabase/tests/database/*.sql`). El SQL de la migración y del test se validó con `pglast` (parser de PostgreSQL): 3 y 30 sentencias, sin errores de sintaxis. |
| Gate: contrato documental | `pnpm test:docs:simulacro` | pass | 9/9: el protocolo, la guía y el runbook tienen el gate; el protocolo dice que un gate en rojo detiene el simulacro sin medir ni firmar; los objetivos, los campos del registro y la coherencia entre documentos siguen en verde. |
| El test detecta la regla (FEAT-236) | cuatro mutaciones sobre los documentos (revertidas después) | pass (como debe) | Ver «Mutaciones» abajo: cada una deja al menos un test en rojo. |
| Migración válida y versionada | `node scripts/verificar-migraciones.mjs --base origin/dokploy` | pass | Versión `20270507200101`: mayor que la máxima de la base real del PR (`20270507200100`), sin reutilizada ni modificada. |
| Migración aditiva | `pnpm db:validar:aditivas` | pass | 772 migraciones verificadas: ninguna destructiva sin camino de reversión documentado. |
| Guard de DDL con idempotencia | `pnpm test:db:guard-migraciones` | pass | 49/49 en verde: la migración nueva (`create or replace function`) no dispara el detector. |
| Documentación del cambio | `pnpm docs:check` | pass | «Documentación de cambios: OK (4251 archivos…)» + «Trampas conocidas: OK». |
| Lint / build | `pnpm lint`, `pnpm build` | pass | lint exit 0 (warnings preexistentes de `apps/web`); build exit 0 («✓ built in 3.26s»). |
| Calidad determinista | `pnpm calidad:code` | pass | «Todo OK». |
| DER de las specs | `pnpm der:check` | fail (línea base) | 141 specs sin DER válido, entre ellas `specs/20271117-100000-lote-34-interfaz-textos-y-roles/spec.md`. **No lo causa este cambio**: no se tocó ninguna spec (el gate no crea ni altera tablas). Es deuda de la línea base. |
| Simulacro en staging | — | skipped | Sin autorización sobre staging (no es ejecutable por el agente). El registro de resultados sigue vacío y sin firma. |

## Mutaciones (FEAT-236: el test tiene que FALLAR si la regla cambia)

Cada mutación se hizo sobre una copia de los documentos y se revirtió después:

| # | Mutación | Resultado esperado | Resultado real |
|---|----------|--------------------|----------------|
| M1 | Se borra el gate del protocolo (`private.verificar_restore_simulacro(`) | falla el test de los pasos | ✖ «el protocolo del simulacro tiene los pasos que miden los objetivos» (8/9 en verde) |
| M2 | Se borra el gate de la guía de restauración | falla el test de la guía y el runbook | ✖ «la guía de restauración y el runbook incluyen el gate posterior al restore» (8/9) |
| M3 | Se borra el gate del runbook | falla el test de la guía y el runbook | ✖ «la guía de restauración y el runbook incluyen el gate posterior al restore» (8/9) |
| M4 | El protocolo deja de decir «no se mide, no se firma» | falla el test del gate en rojo | ✖ «el protocolo dice que si el gate falla el simulacro se detiene sin medir ni firmar» (8/9) |

```
# M1
✖ el protocolo del simulacro tiene los pasos que miden los objetivos
# M2
✖ la guía de restauración y el runbook incluyen el gate posterior al restore
# M3
✖ la guía de restauración y el runbook incluyen el gate posterior al restore
# M4
✖ el protocolo dice que si el gate falla el simulacro se detiene sin medir ni firmar
```

## Output Excerpts

```
$ pnpm test:docs:simulacro
✔ el protocolo del simulacro tiene los pasos que miden los objetivos
✔ el protocolo dice que si el gate falla el simulacro se detiene sin medir ni firmar
✔ contrato de la guía: el paso 1 manda confirmar el host de staging ANTES de restaurar
✔ el protocolo declara los dos objetivos del criterio (pérdida ≤ 24 h y tiempo ≤ 4 h)
✔ la guía de restauración y el runbook incluyen el paso de reaplicar privilegios
✔ la guía de restauración y el runbook incluyen el gate posterior al restore
✔ el registro del simulacro tiene los campos para medir y para firmar
✔ el estado y la firma del propio documento no se contradicen
✔ los documentos que declaran el estado del simulacro no se contradicen entre sí
ℹ pass 9
ℹ fail 0
```

```
$ pnpm docs:check
Documentación de cambios: OK (4251 archivos comparados contra 54ea7b1bad793d5968ffe2d1f629128c40f3bee3).
Migraciones OK: 772 archivo(s), 1 nuevo(s) contra origin/dokploy.
Trampas conocidas: OK (0 migración(es), 1 prueba(s) pgTAP y 0 E2E revisados contra origin/dokploy).
```

```
$ pnpm db:validar:aditivas
772 migraciones verificadas en supabase/migrations: ninguna destructiva sin camino de reversión documentado.
```

## Residual Risks

- **El pgTAP del repo no se corrió localmente** (sin Docker ni Postgres de desarrollo): lo corre el CI
  en el job `database`. Lo que no se probó localmente es el comportamiento de la función y del pgTAP
  sobre la base real (roles `anon`/`authenticated`/`kestra_backups` y las migraciones completas). La
  sintaxis SQL se validó con `pglast`.
- **El simulacro en staging sigue sin ejecutarse**: los objetivos RPO ≤ 24 h y RTO ≤ 4 h (FR-011,
  SC-002) no están medidos ni firmados. Ningún cambio de este PR altera ese estado.
- Si `KESTRA_SMTP_*` / `SOPORTE_CORREO` de staging siguen con los valores de ejemplo, el paso 6 del
  simulacro (aviso por correo) no se puede cerrar: con `transmitFailed: false` el aviso se pierde en
  silencio.
- La base restaurada puede ser **más vieja** que la migración que crea
  `private.verificar_restore_simulacro()`: en ese caso hay que aplicar las migraciones pendientes
  (`supabase migration up`) antes de correr el gate; el gate lo dice en el detalle de las
  comprobaciones del historial.
- El gate no mide la pérdida ni el tiempo (los mide el operador con el reloj y la tabla testigo del
  protocolo): es el control que hace confiable la medición, no la medición.

## Recommendation

Cerrar la parte técnica de MSF-520 (el gate, el protocolo atado a él y los tests que lo fijan) y
dejar la historia en «espera de autorización»: el simulacro queda bajo el gate del propietario del
producto. Cuando haya autorización escrita (ventana, ejecutor, firmante), se ejecuta el protocolo de
`docs/simulacro-restauracion.md` tal como está, se llenan la tabla de resultados con valores
medidos y la firma, y recién ahí el simulacro cierra FR-011 / SC-002.
