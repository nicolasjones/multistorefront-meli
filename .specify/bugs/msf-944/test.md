# Bug Verification: Retención y supresión de consultas, ítems y presupuestos de la tienda (MSF-944)

- **Slug**: msf-944
- **Tested**: 2026-11-19
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

## Residual Risks

- **La primera corrida real borra** todo lo que ya venció desde que existe la tienda: los datos
  personales borrados no se recuperan salvo desde un backup. Está declarado en la migración, en la
  spec y en `docs/consultas.md`.
- **El plazo de 180 días es el valor inicial**, no el plazo legal definitivo (D-21): lo define el
  negocio y se cambia por variable de entorno (`TIENDA_CONSULTAS_RETENCION_DIAS`).
- El pgTAP no se pudo correr **localmente** en este entorno (sin Docker ni CLI de Supabase): la
  evidencia de base es la del CI (job `database`).

## Recommendation

Cerrar el bug: los jobs `database` y `validacion` están verdes, el pgTAP de la historia corre y los
mutantes de la regla mueren. Queda en manos del negocio el plazo legal definitivo (D-21) y la
exportación previa a la primera corrida de la purga, si quiere conservar el histórico.
