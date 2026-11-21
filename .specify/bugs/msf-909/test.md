# Bug Verification: fecha de vencimiento de los gates del tracker

- **Slug**: msf-909
- **Tested**: 2026-11-19 (re-verificado el 2026-11-20 y el 2026-11-21)
- **Corregido (revisión del 2026-11-21)**: 2026-11-21
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

El síntoma ya no se reproduce: el barrido detecta los gates que esperan decisión,
les pone la fecha de vencimiento del contrato (24 h desde `statusSince` en
`America/Argentina/Buenos_Aires`) y una segunda simulación da **0** gates sin fecha.
La regla queda fijada por tests y la documentación explica cómo aplicarla y revertirla.

En la revisión del 2026-11-21 se corrigieron los tres hallazgos del revisor sobre el
SHA `3eedc89aa`: el registro de lo que escribe la corrida, el falso verde por lectura
truncada y la salida documentada cuando la guarda dispara. Esta verificación cubre
también las correcciones.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproducción (antes) | `node scripts/vencimientos-gates.mjs` | pass (síntoma reproducido) | 19 gates sin fecha de 830 ítems del board; el reporte hablaba de 23 medidos el 2026-11-13. |
| Corrección (aplicar) | `node scripts/vencimientos-gates.mjs --aplicar` | pass | `Fecha puesta en 19 ítem(s).` |
| Reproducción (después) | `node scripts/vencimientos-gates.mjs` | pass (0) | `Gates sin fecha de vencimiento en MSF: 0 de 830 ítems del board.` |
| Ítem puntual | `GET /issues/1145` | pass | MSF-909: `dueDate: "2026-11-15"`, `statusSince: "2026-11-14T18:52:03.189Z"`. |
| Re-verificación (2026-11-20) | `node scripts/vencimientos-gates.mjs` | pass (0) | 0 gates sin fecha de 830 ítems; MSF-909 sigue con `dueDate: "2026-11-15"`. |
| Gate nuevo (2026-11-21) | `node scripts/vencimientos-gates.mjs` → `--aplicar` → simulación | pass | 1 gate sin fecha de 831 ítems (MSF-988, escalado a humano después del barrido); `Fecha puesta en 1 ítem(s).`; la simulación vuelve a dar 0. `GET /issues/1224` → `dueDate: "2026-11-18"`. |
| Simulación con la lectura doble (2026-11-21, después de las correcciones) | `node scripts/vencimientos-gates.mjs` | pass (0) | `Gates sin fecha de vencimiento en MSF: 0 de 20 gates esperando decisión (71 gates del board, 781 ítems leídos para el contraste).` Las dos lecturas (por etiqueta y por tipo) ven los mismos 71 gates: el contraste pasa. El «0» es sobre los gates que esperan decisión: los que ya se entregaron no cuentan. |
| Lecturas de la API (2026-11-21) | `GET /projects/MSF/issues?labelIds={735,736,738}&limit=500` y `?typeId={12,20,21,22}&limit=500` | pass | 10 + 25 + 50 = 71 gates por etiqueta; 100 + 302 + 259 + 120 = 781 ítems por tipo; los mismos 71 gates en las dos lecturas. La lectura sin filtro de tipo devuelve exactamente 500: el tope real de la API. |
| New / updated tests | `pnpm test:vencimientos:gates` | pass | 15 tests, 15 pass, 0 fail (antes: 9). Incluye el caso del revisor (lectura truncada) y el del `PATCH` que falla a mitad. |
| Mutaciones (tests que vigilan la regla) | quitar `contrastarBoard` / quitar el registro por ítem / tope `>=` → `>` | pass | 2, 1 y 2 tests fallan respectivamente; las mutaciones se revirtieron. |
| Documentación | `node scripts/docs-check.mjs` y `pnpm docs:check` | pass | `Documentación OK.`; cambios, migraciones y trampas OK. |
| package.json | `node -e "JSON.parse(...)"` | pass | `package.json OK`. |
| Regression suite | `pnpm test` (suite completo) | not-run | Se corre en el PR/CI; local sólo las suites del área (Node puro, sin base). |
| Lint / type-check | `pnpm lint` / build | pass | 0 errores (los warnings de `apps/web` son preexistentes) y build OK. |

## Output Excerpts

```
Gates sin fecha de vencimiento en MSF: 19 de 830 ítems del board.
  MSF-909 (id 1145)  En curso  vence 2026-11-15  [Auditoría] 23 gates esperando decisión sin fecha de vencimi
...
Fecha puesta en 19 ítem(s).
```

```
Gates sin fecha de vencimiento en MSF: 0 de 830 ítems del board.
```

```
Gates sin fecha de vencimiento en MSF: 1 de 831 ítems del board.
  MSF-988 (id 1224)  En curso  vence 2026-11-18  [seguimiento MSF-176] PR #965 con hallazgos de la revisión d
Fecha puesta en 1 ítem(s).

Gates sin fecha de vencimiento en MSF: 0 de 831 ítems del board.
```

```
Leyendo el board de MSF...
Gates sin fecha de vencimiento en MSF: 0 de 20 gates esperando decisión (71 gates del board, 781 ítems leídos para el contraste).
Simulación: no se escribió nada. Repetí con --aplicar para poner la fecha.
```

```
ℹ tests 15
ℹ pass 15
ℹ fail 0
```

## Residual Risks

- Los gates que nacen después siguen sin fecha: la prevención en la creación vive en
  el orquestador (otro repo), y quedó trazado como **MSF-995** (Tarea `seguimiento`, en
  `Backlog`, con `dueDate` 2026-12-04). La herramienta es idempotente y se puede re-correr.
- La fecha que se escribe es la de vencimiento del contrato (puede quedar en el pasado
  para gates ya vencidos): es lo que el reporte pide para que el board muestre que la
  decisión está vencida.
- La aplicación se hizo con la clave del entorno; la reversión documentada es
  `PATCH /issues/{id}` con `{"dueDate": null}`. Desde la corrección del 2026-11-21 cada
  ítem aplicado se anota apenas se escribe, así que la reversión se puede aplicar
  aunque la corrida falle a mitad.
- La API del tracker no pagina (ignora `offset`/`page`, tope de 500 por consulta): si un
  tipo o una etiqueta de gate llegan al tope, el barrido corta con error **antes de
  escribir** (y el contraste entre las dos lecturas detecta un tope menor que 500). La
  salida documentada está en `docs/tecnico/gates-vitalidad.md`.
- El contraste necesita que la API honre `labelIds`: está en el contrato de la API
  (`GET /docs/json`) y se verificó contra el board real (71 gates por etiqueta, los
  mismos que el board). Si la API cambiara, el barrido corta con error en vez de dar un
  «0 gates» falso.

## Recommendation

Cerrar el bug: verificado sobre el board real (19 → 0 el 2026-11-19, el gate que
entró después MSF-988 → 0 el 2026-11-21) y con tests que fijan la regla, incluidas
las tres correcciones de la revisión del 2026-11-21.
