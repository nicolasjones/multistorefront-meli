# Bug Verification: Retención y supresión de consultas, ítems y presupuestos de la tienda (MSF-944)

- **Slug**: msf-944
- **Tested**: 2026-11-20 (segunda vuelta, tras la devolución del Revisor)
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

El pgTAP nuevo corrió **verde en el CI** (job `database`, 72/72 aserciones de
`consultas_retencion.test.sql` y 15 171 pruebas del conjunto de la base sin un solo `not ok`), y los
tres mutantes de la regla los mata: cada cambio deliberado de la regla dejó caer la aserción que la
vigila. El bug (consultas, ítems y notas de presupuestos de la tienda guardados para siempre, sin
plazo ni supresión) queda cerrado: la purga por retención y la supresión por titular existen, están
probadas y están documentadas.

En la **segunda vuelta** (devolución de QA y de seguridad) se corrigió el aislamiento por
organización de la limpieza de la cola de avisos y se pasó a vigilar la regla D-25 sobre la emisión
real de los avisos; el pgTAP pasó a 79 aserciones (ver «Segunda vuelta»).

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | Inspección de la migración `20270507200101` | pass | existen `private.purgar_consultas_tienda`, `private.suprimir_titular_tienda`, `consulta_id` con FK en cascada y `suprimido_en`; ya no hay camino sin purga ni supresión |
| New / updated tests | job `database` del CI (corrida `44442683123`, `b59408ece`) | pass | `supabase/tests/database/consultas_retencion.test.sql ... ok`; el resto de los 410 archivos de la base, sin `not ok` |
| Mutantes (FEAT-236 / T005) | corrida `44444255109` (`ccef18a1e`): tres mutaciones del SQL | pass (muertos) | 7 de 72 aserciones caer: M1 → 16, 18 y 38; M2 → 25, 40 y 44; M3 → 62 |
| Flow contract test | `pnpm test:kestra:purgar-consultas-tienda` | pass | 4/4 |
| Regression suite | `pnpm lint` | pass | solo warnings preexistentes de React |
| Build | `pnpm build` | pass | bundle OK |
| Docs / migraciones | `pnpm docs:check` | pass | 1 migración nueva contra `origin/dokploy` |
| Migraciones (guard) | `node scripts/verificar-migraciones.mjs --base origin/dokploy` | pass | 754 archivo(s), 1 nuevo(s), ninguna reutilizada |
| DER | `pnpm der:check` | pass | `specs/…-retencion-y-supresion-consultas-tienda/spec.md: DER OK` |
| Calidad | `pnpm calidad:code` | pass | oxlint, knip, jscpd, dependency-cruiser y syncpack OK (gitleaks saltado: sin Docker) |

## Output Excerpts

Corrida verde (`44442683123`, job `database`):

```
supabase/tests/database/consultas_retencion.test.sql ............................. ok
supabase/tests/database/tienda_presupuesto_cliente.test.sql ...................... ok
Files=410, Tests=15171, 195 wallclock secs
Result: PASS
```

Mutantes (corrida `44444255109`, job `database`): el commit `ccef18a1e` cambió el SQL a propósito y
el commit siguiente lo revierte; el pgTAP cazó las tres reglas.

```
supabase/tests/database/consultas_retencion.test.sql (Wstat: 0 Tests: 72 Failed: 7)
# Failed test 16: "la purga borra las tres consultas vencidas (dos de la organización uno y una de la dos)"
#         have: 4
#         want: 3
# Failed test 18: "una consulta en curso no se borra sola (es un compromiso comercial vivo)"
#         have: 0
#         want: 1
# Failed test 25: "la copia atada a la consulta borrada no queda en la cola"
#         have: 1
#         want: 0
# Failed test 38: "el evento de purga informa cuántas consultas se borraron"
# Failed test 40: "y no suma eventos de purga"
#         have: 3
#         want: 2
# Failed test 44: "solo las copias anteriores a la columna quedan sin atar"
#         have: 6
#         want: 2
# Failed test 62: "el evento de la supresión no lleva datos personales"
Looks like you failed 7 tests of 72
```

Qué mutante mató qué aserción:

| Mutante | Cambio en el SQL | Aserciones que cayeron |
|---|---|---|
| **M1** | `estado <> 'en_curso'` → `estado is not null` (la purga borra también las consultas en curso) | 16 (borra 4 en vez de 3), 18 (la consulta en curso desaparece) y 38 (el evento informa 3 consultas y no 2) |
| **M2** | FK de `avisos_pendientes.consulta_id`: `on delete cascade` → `on delete set null` (la copia del aviso sobrevive a la consulta) | 25 (la copia atada queda en la cola), 44 (sobran copias sin atar) y 40 (la segunda pasada ahora borra esa copia y suma un evento: la purga deja de ser idempotente) |
| **M3** | el evento `tienda.titular_suprimido` copia el contacto del titular | 62 (el evento de la supresión lleva datos personales) |

Las 65 aserciones restantes y los otros 409 archivos de la base (15 171 pruebas) siguieron verdes
con el SQL mutado: los mutantes no rompieron nada fuera de la regla que vigilan.

```
✔ purgar-consultas-tienda tiene un trigger Schedule diario
✔ la purga llama a la función de retención con el rol de servicio
✔ un fallo de la purga avisa y no se traga el error
✔ la variable de retención se declara en el Compose y en .env.example
ℹ pass 4  ℹ fail 0
```

```
Migraciones OK: 754 archivo(s), 1 nuevo(s) contra origin/dokploy.
DER OK (1 spec/s).
```

## Segunda vuelta (revisión de QA y de seguridad del PR #1132)

La revisión devolvió el PR con cinco hallazgos. Los cinco tienen prueba y arreglo:

| Hallazgo | Qué se hizo | Qué lo vigila |
|---|---|---|
| La supresión tocaba la cola de avisos de otra organización (`20270507200101…sql`, «copia suelta» sin filtro por organización) | Las dos sentencias que limpian `public.avisos_pendientes` filtran por `a.organizacion_id = p_organizacion` | pgTAP: dos avisos de la organización dos con el **mismo contacto** de la titular (`titular@example.com`), uno `pendiente` y uno `enviado`: el primero no se borra y el segundo no pierde `Contacto` |
| La regla D-25/FR-005 no la vigilaba ningún test (las filas se insertaban a mano) | El pgTAP llama a `private.emitir_aviso_consulta` y mira el aviso **realmente emitido** | pgTAP: el aviso emitido queda atado a su consulta, su payload no lleva la clave interna `ConsultaId` y los avisos de otros tipos no quedan atados |
| Las nueve tareas seguían con `[ ]` | Marcas de T001 a T009 en `specs/…/tasks/MSF-944.md` (las de `tasks.md` las escribe el runner: es la spec compartida de la épica) | — |
| `docs/tecnico/consultas.md` decía que no hay política de retención y no listaba el pgTAP ni el flow | §Retención, §Verificación y §Reversión actualizados | `pnpm docs:check` |
| `docs/consultas.md` («Riesgos aceptados» 3) contradecía su propia §Retención | Corregido | `pnpm docs:check` |

### Mutantes de la segunda vuelta (FEAT-236)

Cada regla nueva tiene una aserción que cae si la regla se cambia (mutación deliberada y revertida):

| Mutante | Cambio en el SQL | Aserción que cae |
|---|---|---|
| **M4** | Sacar `and a.organizacion_id = p_organizacion` del `delete` de la cola | «la copia pendiente de la titular en la otra organización no se borra» (la fila de la organización dos se borra) |
| **M5** | Sacar `and a.organizacion_id = p_organizacion` del `update` de la cola | «la copia ya enviada de la titular en la otra organización no pierde sus datos» (le sacan `Nombre`, `Contacto` y `Mensaje`) |
| **M6** | Sacar `'ConsultaId', v_c.id` del payload de `private.emitir_aviso_consulta` | «el aviso que emite la función queda atado a su consulta» (el aviso emitido queda sin atar) |
| **M7** | Sacar `- 'ConsultaId'` del `insert` de `private.emitir_aviso` | «el aviso emitido no lleva la clave interna en el correo» (la clave viaja al correo) |

### Checks de la segunda vuelta

| Check | Comando / Acción | Resultado |
|-------|------------------|-----------|
| Aislamiento de la cola | job `database` del CI (corrida `44674523588`, `98eaa75b`) | pass — `consultas_retencion.test.sql ... ok` (79/79) y `Files=410, Tests=15178 … Result: PASS` (los 7 tests nuevos del archivo) |
| D-25 sobre la emisión real | el mismo pgTAP | pass (mismo archivo) |
| Flow (sin cambios) | `pnpm test:kestra:purgar-consultas-tienda` | pass (4/4) |
| Lint / build | `pnpm lint`, `pnpm build` | pass (solo warnings preexistentes de React) |
| Docs / migraciones | `pnpm docs:check` | pass (1 migración nueva contra `origin/dokploy`) |
| DER de la spec | `node scripts/verificar-der.mjs specs/…-retencion-y-supresion-consultas-tienda/spec.md` | pass (`DER OK (1 spec/s)`) |
| Calidad | `pnpm calidad:code` | pass (oxlint, knip, jscpd, dependency-cruiser, syncpack; gitleaks saltado: sin Docker) |
| Rama al día con la base | `git merge origin/dokploy` (conflicto único en `docs/tecnico/consultas.md`, resuelto a favor de la base y reaplicando los cambios de MSF-944) | pass — el PR volvió a `MERGEABLE` (estaba `CONFLICTING`, 133 commits atrás) |

## Residual Risks

- **La primera corrida real borra** todo lo que ya venció desde que existe la tienda: los datos
  personales borrados no se recuperan salvo desde un backup. Está declarado en la migración, en la
  spec y en `docs/consultas.md`.
- **El plazo de 180 días es el valor inicial**, no el plazo legal definitivo (D-21): lo define el
  negocio y se cambia por variable de entorno (`TIENDA_CONSULTAS_RETENCION_DIAS`).
- El pgTAP no se pudo correr **localmente** en este entorno (sin Docker ni CLI de Supabase): la
  evidencia de base es la del CI (job `database`).

## Recommendation

Cerrar el bug: el job `database` del CI (corrida `44674523588`) dio verde con el pgTAP de 79
aserciones, los mutantes de la regla mueren, los guards locales están en verde y la rama volvió a
estar al día con `origin/dokploy` (el PR está `MERGEABLE`). Queda en manos del negocio el plazo legal
definitivo (D-21) y la exportación previa a la primera corrida de la purga, si quiere conservar el
histórico.
