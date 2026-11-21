# Bug Fix: fecha de vencimiento de los gates del tracker

- **Slug**: msf-909
- **Fixed**: 2026-11-19
- **Corregido (revisión del 2026-11-21)**: 2026-11-21
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

El board del tracker no tenía escrito el plazo de los gates: los ítems con
`gate`/`decision`/`escala-humano` esperaban decisión con `dueDate` vacío. Se agregó
`scripts/vencimientos-gates.mjs`, un barrido idempotente que les pone la fecha de
vencimiento del contrato de vitalidad (24 h desde que el ítem empezó a esperar, en
`America/Argentina/Buenos_Aires`), con simulación por defecto y escritura sólo
con `--aplicar`.
No se decidió el contenido de ningún gate: sólo la fecha.

**Correcciones de la revisión del 2026-11-21** (PR #1148, hallazgos sobre el SHA
`3eedc89aa`):

1. **Registro de la escritura** — cada ítem se anota **apenas se escribe**, no al final
   de la corrida: si un `PATCH` falla a mitad, la salida dice qué ítems quedaron con
   fecha y la reversión documentada se puede aplicar con precisión.
2. **Falso verde por lectura truncada** — la guarda anterior sólo detectaba el
   truncamiento si la API devolvía *exactamente* `limit` ítems. Ahora el board se lee
   de **dos maneras independientes** (por etiqueta de gate y por tipo de ítem) y se
   contrastan: si no ven los mismos gates, el barrido corta con error antes de
   escribir.
3. **Salida documentada cuando la guarda dispara** — qué pasa, que no se escribió nada
   y cómo destrabarlo.

**Correcciones de la revisión del 2026-11-21 (4.ª ronda)** (PR #1148, hallazgos sobre el
SHA `c68634bcf`):

1. **Falso verde por lectura vacía** — si las dos lecturas del board vienen vacías (la
   API cambió la forma de la respuesta, el filtro dejó de matchear o el board no tiene
   ítems), el barrido ahora corta con error antes de calcular el plan: antes terminaba
   con «0 de 0 gates esperando decisión» y salida 0.
2. **Test de la guarda «el proyecto no tiene ninguna etiqueta de gate»** — la guarda
   existía pero ningún test la ejercitaba (por mutación, quitarla dejaba la suite en
   verde): ahora hay un test con un proyecto sin etiquetas de gate.
3. **Test de la salida** — la línea que registra cada ítem aplicado (de donde sale el id
   numérico que usa la reversión documentada) y el denominador «gates esperando
   decisión» se imprimían en `main()`, que ningún test ejercitaba: el formato de las dos
   líneas quedó en funciones puras (`lineaAplicado`, `lineaResumen`) con su test.
4. **Precisión de la documentación** — la doc decía que el contraste corta siempre que
   las dos lecturas no vean los mismos gates; ahora aclara que los gates **sin tipo** no
   se pueden contrastar (no hay lectura por tipo que los contenga) y que sí se fechan.

Hallazgos que **no** se tocaron en esta ronda, por decisión del CTO (herramienta interna
de bajo riesgo; los Baja pasan a merge sin escalada):

- El ancla de la fecha (`statusSince` vs. cuándo el watchdog marca vencido): aceptado
  tal cual y trazado como seguimiento real **MSF-997**.
- Los gates sin tipo no se contrastan: es correcto —no hay lectura por tipo con la que
  contrastarlos— y no los deja fuera del barrido (se fechan igual).
- Los demás Baja (mensajes ambiguos, `r.json()` sobre un `PATCH` con 204, `title`
  indefinido, `encodeURIComponent`): cosméticos de una herramienta interna.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `scripts/vencimientos-gates.mjs` | added | Selecciona gates sin fecha que esperan decisión, calcula `statusSince + 24 h` en `America/Argentina/Buenos_Aires` y, con `--aplicar`, hace `PATCH /issues/{id}` con **sólo** `dueDate`. Lee el board por etiqueta de gate **y** por tipo de ítem y los contrasta (`contrastarBoard`): si las dos lecturas no ven los mismos gates, si una lectura llega al tope de 500 ítems (la API no pagina) o si las dos lecturas vienen vacías, el barrido corta con error antes de escribir. Anota cada ítem aplicado apenas lo escribe; el formato de esa línea y el del resumen viven en `lineaAplicado` y `lineaResumen`. |
| `scripts/vencimientos-gates.test.mjs` | added | Fija la regla: qué es un gate, qué es esperar, el cálculo con borde de medianoche, idempotencia, PATCH sólo con `dueDate`, simulación sin escritura, topes de lectura, contraste entre las dos lecturas, lectura vacía, proyecto sin etiquetas de gate, registro de lo aplicado ante un fallo parcial y formato de la salida. |
| `package.json` | modified | Nuevo `test:vencimientos:gates`, encadenado en `pnpm test`. |
| `.github/workflows/validate.yml` | modified | El job `chequeos` corre `test:vencimientos:gates` (Node puro, sin base ni red). |
| `docs/tecnico/gates-vitalidad.md` | added | La regla, cómo se aplica, cómo se verifica, cómo se revierte y qué hacer si el barrido corta. |
| `docs/README.md` | modified | Índice de documentación técnica. |
| `mkdocs.yml` | modified | Nav del sitio. |

## Diff Highlights

```js
export function fechaVencimiento(desde, horas = HORAS_PLAZO, zona = ZONA) {
  const instante = new Date(desde)
  if (Number.isNaN(instante.getTime())) throw new Error(`Fecha inválida: ${desde}`)
  return fechaEnZona(new Date(instante.getTime() + horas * 3600 * 1000), zona)
}

/**
 * Contrasta las dos lecturas del board: cada gate tiene que aparecer en la lectura de
 * su tipo y ningún gate de la lectura por tipo puede faltar en la lectura por etiqueta.
 */
export function contrastarBoard(gates, porTipo, { etiquetas }) { /* ... */ }
```

```js
if (aplicar) {
  for (const p of plan) {
    await api.patch(`/issues/${p.id}`, { dueDate: p.dueDate })
    // Se anota cada ítem apenas se escribe: si un PATCH posterior falla, la salida
    // dice qué quedó puesto y la reversión se puede aplicar con precisión.
    alAplicar?.(p)
  }
}
```

El cliente PATCH manda sólo el campo `dueDate`; el test lo verifica porque mandar
`labelIds` en el mismo PATCH reemplazaría las etiquetas del ítem.

### Por qué dos lecturas

La API del tracker **no pagina** (`offset`/`page` se ignoran) y corta en 500 ítems por
consulta. Con una sola lectura, un tope real de página por debajo del `limit` pedido
truncaba el tipo en silencio y el barrido declaraba «0 gates sin fecha» con gates sin
fecha. Las dos lecturas son de tamaños distintos (por etiqueta: sólo los gates; por
tipo: todo el tipo), así que una lectura truncada deja gates fuera de la otra y el
contraste la delata.

Los **archivados ya no se leen** (`includeArchived` no se pide): la regla los descarta
igual y sólo consumían el tope de la lectura.

## Tests Added or Updated

- `scripts/vencimientos-gates.test.mjs::la fecha de vencimiento es el plazo del contrato contado desde que el ítem espera` — `statusSince + 24 h` en la zona del board, bordes de medianoche y fecha inválida.
- `…::un ítem es gate si lleva gate, decision o escala-humano` — la etiqueta `espera-dependencia` no es gate.
- `…::un ítem espera decisión mientras no está archivado ni en una columna terminal` — columnas `completed` y archivados quedan fuera.
- `…::se seleccionan los gates sin fecha que esperan decisión` — idempotencia (`dueDate` ya puesto no se toca).
- `…::el plan usa desde cuándo espera el ítem y, si falta, cuándo se creó` — fallback a `createdAt`.
- `…::el PATCH manda sólo la fecha: mandar etiquetas las reemplazaría` — cuerpo del PATCH.
- `…::el barrido simula sin escribir y aplica con un PATCH por ítem` — simulación vs `--aplicar`.
- `…::un gate sin tipo también entra en el barrido` — un gate que no tiene tipo asignado no queda fuera (antes sólo se leían los tipos).
- `…::una lectura por tipo truncada corta el barrido antes de escribir` — **el falso verde del revisor**: 450 ítems en el tipo, la API devuelve 400 y 20 gates quedan fuera; el barrido corta y no escribe nada.
- `…::una lectura por etiqueta truncada corta el barrido antes de escribir` — el otro sentido del contraste.
- `…::un tipo con el tope de ítems corta el barrido: la API no pagina y el resultado sería incompleto` — con 500 ítems en un tipo el barrido se corta en vez de reportar un "0 gates" falso.
- `…::una etiqueta de gate en el tope corta el barrido: no se puede saber si faltan gates` — el mismo tope en la lectura por etiqueta.
- `…::un PATCH que falla deja registrado qué ítems escribió la corrida` — **el registro del revisor**: el `PATCH` del segundo ítem falla y la salida registra sólo el primero (el que quedó escrito).
- `…::el contraste corta si un gate de una lectura no está en la otra` — el contraste en sí, aislado.
- `…::una lectura vacía corta el barrido: no se puede afirmar que no quedan gates sin fecha` — **el falso verde de la 4.ª ronda**: las dos lecturas vacías cortan antes de calcular el plan, en vez de terminar con «0 de 0 gates esperando decisión».
- `…::un proyecto sin etiquetas de gate corta el barrido: sin ellas no se puede leer el board` — la guarda que ya existía, ahora con test (por mutación, quitarla dejaba la suite en verde).
- `…::la salida deja el id numérico de cada ítem aplicado y el denominador del barrido` — el formato de `lineaAplicado` (de donde sale el id que usa la reversión) y de `lineaResumen` (denominador: gates que esperan decisión, no ítems del board).
- `…::un error del board no se silencia` — el fallo se propaga con contexto.

## Local Verification

- Commands run: `pnpm test:vencimientos:gates` → 18 tests, 18 pass, 0 fail (4.ª ronda: 15 → 18).
- Commands run: `node scripts/docs-check.mjs` → `Documentación OK.` (220 páginas, 2003 links, JSON de inventario y 15 diagramas).
- Commands run: `node -e "JSON.parse(...package.json...)"` → `package.json OK`.
- Commands run: `pnpm docs:check` → OK (documentación de cambios, migraciones y trampas conocidas).
- Commands run: `pnpm lint` → 0 errores (warnings preexistentes de `apps/web`); `pnpm build` → OK.
- Commands run: `pnpm calidad` → oxlint, knip, jscpd, dependency-cruiser y syncpack OK (gitleaks no corrió: el entorno no tiene permisos de Docker, que es como corre ese check).
- Board (sólo lectura, simulación, 2026-11-21): `node scripts/vencimientos-gates.mjs` → `Gates sin fecha de vencimiento en MSF: 0 de 20 gates esperando decisión (71 gates del board, 781 ítems leídos para el contraste).`
- Board (medición de la API para el diseño del contraste, 2026-11-21): `GET /projects/MSF/issues?labelIds={735,736,738}&limit=500` → 10 + 25 + 50 = **71** gates, los mismos ids que el board; `?typeId={12,20,21,22}&limit=500` → 100 + 302 + 259 + 120 = **781** ítems; los mismos 71 gates. La lectura global sin filtro de tipo (`?limit=5000`) devuelve **exactamente 500**: el tope real de la API.
- Board (aplicación, 2026-11-19): `node scripts/vencimientos-gates.mjs --aplicar` → `Fecha puesta en 19 ítem(s).`
- Board (verificación): `node scripts/vencimientos-gates.mjs` → **0 gates sin fecha**; `GET /issues/1145` (MSF-909) → `dueDate: "2026-11-15"`, `statusSince: "2026-11-14T18:52:03.189Z"` (24 h en `America/Argentina/Buenos_Aires`, 2026-11-15).
- Re-verificación (2026-11-20): `node scripts/vencimientos-gates.mjs` → **0 gates sin fecha** de 830 ítems; `GET /issues/1145` → `dueDate: "2026-11-15"`.
- Re-verificación (2026-11-21): `node scripts/vencimientos-gates.mjs` → **1 gate sin fecha** de 831 ítems (MSF-988, escalado a humano después del barrido del 2026-11-19); `--aplicar` → `Fecha puesta en 1 ítem(s).`; simulación → **0 gates sin fecha** de 831 ítems; `GET /issues/1224` (MSF-988) → `dueDate: "2026-11-18"`.
- Tope por tipo (2026-11-21): la API del tracker honra `limit` pero **ignora** `offset`/`page`/`skip` (medido: `limit=10` → 10 ítems, `limit=500` → los 350 que hay). El tope de 500 está documentado en el contrato de la API (`GET /docs/json`: `limit`, «Max results (1-500)»).
- Mutación (revertida) para ver que los tests vigilan las reglas: quitar el `contrastarBoard` rompe 2 tests; sacar el `alAplicar` rompe 1; el tope de ítems `>=` → `>` rompe 2.
- Mutación (revertida, 4.ª ronda): quitar la guarda de lectura vacía rompe 1 test (el de la lectura vacía); quitar la guarda «el proyecto no tiene ninguna etiqueta de gate» rompe 1 test (el del proyecto sin etiquetas); cambiar el denominador del resumen por «de N ítems del board» rompe 1 test (el de la salida); sacar el id numérico de la línea de aplicado rompe 1 test (el de la salida).

## Deviations from Assessment

Ninguna en el alcance: el assessment pedía una herramienta + test + documentación +
CI, y eso es lo que se hizo.

Cuatro precisiones:

- El step del workflow quedó en el job `chequeos` (la CI de la base ya separó ahí las
  suites de Node puro), no en `application`.
- La zona del cálculo es `America/Argentina/Buenos_Aires` (la que ya usa el repo), no
  `America/Argentina` como dice el assessment: ese nombre no es una zona IANA válida y
  `Intl.DateTimeFormat` lo rechaza. La fecha calculada es la misma.
- La lectura del board es **doble** (por etiqueta y por tipo) y los archivados no se
  leen: el assessment preveía una lectura por tipo con `includeArchived=true`, pero esa
  lectura puede truncarse en silencio (el falso verde que reportó la revisión) y los
  archivados sólo consumían el tope. La regla aplicada a cada gate es la misma.
- La salida de `--aplicar` anota cada ítem **apenas lo escribe** (no al final): con un
  `PATCH` que falla a mitad, la corrida deja fechas puestas y la salida tiene que
  decirlas para que la reversión sea precisa.

## Follow-ups

- Que el gate **nazca** con `dueDate` es un cambio del flujo del orquestador
  (`ai-dev-orchestrator`, otro repo): esta herramienta es un barrido idempotente que se
  puede volver a correr. Quedó trazado como **MSF-995** (Tarea `seguimiento`, en
  `Backlog`, bajo MSF-515) y anotado en `docs/tecnico/gates-vitalidad.md`.
- Barrido aplicado el 2026-11-19 (`--aplicar`: 19 ítems) y verificado el 2026-11-20: la
  simulación da 0 gates sin fecha. El 2026-11-21 entró un gate nuevo (MSF-988, escalado a
  humano después del barrido) y se completó con otra corrida (`--aplicar`: 1 ítem): la
  simulación vuelve a dar 0. Se corre cada vez que entren gates nuevos.
- La API del tracker no pagina: si un tipo (o una etiqueta de gate) llega a 500 ítems, el
  barrido corta a propósito. La salida documentada está en
  `docs/tecnico/gates-vitalidad.md` («Si el barrido corta con error»).
