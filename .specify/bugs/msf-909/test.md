# Bug Verification: fecha de vencimiento de los gates del tracker

- **Slug**: msf-909
- **Tested**: 2026-11-19 (re-verificado el 2026-11-20 y el 2026-11-21; barrido re-aplicado y re-verificado el 2026-11-24)
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

En la 4.ª ronda (hallazgos sobre el SHA `c68634bcf`) se corrigieron los dos hallazgos
**Media** de la revisión de seguridad (la lectura vacía no se detectaba y la guarda
«el proyecto no tiene ninguna etiqueta de gate» no tenía test) y se cubrió con test la
salida que usa la reversión (el id numérico de cada ítem aplicado y el denominador del
resumen).

En la 5.ª ronda (2026-11-24) el board volvió a tener gates esperando decisión sin
`dueDate` (los que nacieron después del barrido del 2026-11-21): el barrido se volvió a
correr, puso la fecha en los 2 y la simulación volvió a dar 0. Además, esta verificación
deja anotado el cambio de la validación de la clave del proyecto (`f19fe4589`), que se
había aprobado en la revisión pero no había quedado registrado en los artefactos, y agrega
el test de la escritura única por ítem para la forma real del board (ítems con dos
etiquetas de gate).

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
| New / updated tests | `pnpm test:vencimientos:gates` | pass | 20 tests, 20 pass, 0 fail (antes: 19; 15 en la 4.ª ronda). Incluye el caso del revisor (lectura truncada), el del `PATCH` que falla a mitad, los dos de la 4.ª ronda (lectura vacía y proyecto sin etiquetas de gate), el del formato de la salida, el de la validación de la clave del proyecto y el de la escritura única por ítem. |
| Lectura vacía (4.ª ronda) | `pnpm test:vencimientos:gates` → `…::una lectura vacía corta el barrido` | pass | Con las dos lecturas vacías el barrido corta con error antes de calcular el plan: sin la guarda terminaba con «0 de 0 gates esperando decisión» y salida 0. |
| Proyecto sin etiquetas de gate (4.ª ronda) | `pnpm test:vencimientos:gates` → `…::un proyecto sin etiquetas de gate corta el barrido` | pass | La guarda que ya existía ahora está cubierta por un test (por mutación, quitarla dejaba la suite en verde). |
| Formato de la salida (4.ª ronda) | `pnpm test:vencimientos:gates` → `…::la salida deja el id numérico de cada ítem aplicado y el denominador del barrido` | pass | La línea de aplicado conserva el id (lo usa la reversión `PATCH /issues/<id>`) y el resumen usa «de N gates esperando decisión». |
| Mutaciones (tests que vigilan la regla) | quitar `contrastarBoard` / quitar el registro por ítem / tope `>=` → `>` | pass | 2, 1 y 2 tests fallan respectivamente; las mutaciones se revirtieron. |
| Mutaciones (4.ª ronda) | quitar la guarda de lectura vacía / quitar la guarda de etiquetas / cambiar el denominador / sacar el id de la línea de aplicado | pass | 1 test falla en cada mutación; las mutaciones se revirtieron. |
| Escritura única por ítem (5.ª ronda) | `pnpm test:vencimientos:gates` → `…::un gate con dos etiquetas de gate se fecha una sola vez` | pass | Un ítem con dos de las tres etiquetas de gate (forma real: 12 ítems del board la tienen) aparece en dos lecturas por etiqueta y se plana **una** vez: un `PATCH`. Por mutación, cambiar la clave del `Map` de gates (`gates.set(item.id, item)` → `gates.set(`${item.id}:${etiqueta.id}`, item)`) rompe 3 tests, entre éste; la mutación se revirtió. |
| Barrido re-aplicado (2026-11-24) | `node scripts/vencimientos-gates.mjs` → `--aplicar` → simulación | pass | El board había vuelto a tener gates esperando decisión sin fecha: 2 de 14 (MSF-999 id 1236, `escala-humano` en *Backlog*; MSF-720 id 954, `gate` en *Needs Info*). `--aplicar` → `Fecha puesta en 2 ítem(s).`; simulación → **0 de 14 gates esperando decisión** (72 gates del board, 785 ítems leídos para el contraste). `GET /issues/1236` → `dueDate: "2026-11-23"`; `GET /issues/954` → `dueDate: "2026-11-24"`. |
| Conteo del board (2026-11-24) | `GET /projects/MSF/issues?typeId={12,20,21,22}&limit=500` y `?columnId=…` | pass | 100 + 303 + 259 + 123 ítems sin archivar por tipo: ninguna lectura del barrido llega al tope de 500, así que el contraste no puede dar un «0 gates» falso. Por columna, *Review In DEV* tiene exactamente 500 (el tope de la API): el barrido no lee por columna. |
| Clave del proyecto (2026-11-24) | `pnpm test:vencimientos:gates` → `…::el proyecto se valida (^[A-Za-z0-9_-]+$) antes de armar la ruta de la API` | pass | La clave del proyecto va interpolada en `/projects/${proyecto}`: `../otro`, `MSF/issues`, `MSF?x=1`, vacío y `undefined` cortan antes de cualquier llamada de red (0 llamadas a `fetch`). El cambio venía de `f19fe4589` y faltaba en este artefacto: quedó anotado en `fix.md`. |
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
ℹ tests 20
ℹ pass 20
ℹ fail 0
```

```
Leyendo el board de MSF...
  aplicado MSF-999 (id 1236)  vence 2026-11-23  [seguimiento] El guardián de rondas de revisión re-escala "n
  aplicado MSF-720 (id 954)  vence 2026-11-24  [Bug] El precio final con IVA (al peso entero) no coincide c
Gates sin fecha de vencimiento en MSF: 2 de 14 gates esperando decisión (72 gates del board, 785 ítems leídos para el contraste).
Fecha puesta en 2 ítem(s).
```

```
Leyendo el board de MSF...
Gates sin fecha de vencimiento en MSF: 0 de 14 gates esperando decisión (72 gates del board, 785 ítems leídos para el contraste).
Simulación: no se escribió nada. Repetí con --aplicar para poner la fecha.
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
- Los gates **sin tipo** no se pueden contrastar (no hay lectura por tipo que los
  contenga): se fechan igual, pero una lectura por etiqueta truncada por debajo del tope
  no se detectaría para ellos. Riesgo bajo y aceptado por decisión del CTO (herramienta
  interna de bajo riesgo); queda documentado en `docs/tecnico/gates-vitalidad.md`.
- El ancla de la fecha (`statusSince` vs. cuándo el watchdog marca vencido) se acepta tal
  cual por decisión del CTO y quedó trazada como seguimiento real **MSF-997**.
- El board crece: al 2026-11-24 los tipos sin archivar estaban en 100/303/259/123 (el
  tope de la API es 500 por consulta y no pagina) y la columna *Review In DEV* ya tiene
  500 ítems. El barrido lee por tipo y por etiqueta, no por columna: si un tipo llega al
  tope, corta con error en vez de dar un «0 gates» falso, y la salida documentada dice
  cómo destrabarlo (archivar los ítems viejos del tipo).

## Recommendation

Cerrar el bug: verificado sobre el board real (19 → 0 el 2026-11-19, el gate que
entró después MSF-988 → 0 el 2026-11-21, los dos que entraron después MSF-999 y
MSF-720 → 0 el 2026-11-24) y con tests que fijan la regla, incluidas las tres
correcciones de la revisión del 2026-11-21, las dos de la 4.ª ronda, la validación de
la clave del proyecto y la escritura única por ítem.
