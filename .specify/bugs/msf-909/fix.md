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

## Changes

| File | Change | Notes |
|------|--------|-------|
| `scripts/vencimientos-gates.mjs` | added | Selecciona gates sin fecha que esperan decisión, calcula `statusSince + 24 h` en `America/Argentina/Buenos_Aires` y, con `--aplicar`, hace `PATCH /issues/{id}` con **sólo** `dueDate`. Lee el board por etiqueta de gate **y** por tipo de ítem y los contrasta (`contrastarBoard`): si las dos lecturas no ven los mismos gates, o si una lectura llega al tope de 500 ítems (la API no pagina), el barrido corta con error antes de escribir. Anota cada ítem aplicado apenas lo escribe. |
| `scripts/vencimientos-gates.test.mjs` | added | Fija la regla: qué es un gate, qué es esperar, el cálculo con borde de medianoche, idempotencia, PATCH sólo con `dueDate`, simulación sin escritura, topes de lectura, contraste entre las dos lecturas y el registro de lo aplicado ante un fallo parcial. |
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
- `…::un error del board no se silencia` — el fallo se propaga con contexto.

## Local Verification

- Commands run: `pnpm test:vencimientos:gates` → 15 tests, 15 pass, 0 fail.
- Commands run: `node scripts/docs-check.mjs` → `Documentación OK.` (220 páginas, 2003 links, JSON de inventario y 15 diagramas).
- Commands run: `node -e "JSON.parse(...package.json...)"` → `package.json OK`.
- Commands run: `pnpm docs:check` → OK (documentación de cambios, migraciones y trampas conocidas).
- Commands run: `pnpm lint` → 0 errores (warnings preexistentes de `apps/web`); `pnpm build` → OK.
- Commands run: `pnpm calidad` → oxlint, knip, jscpd, dependency-cruiser y syncpack OK (gitleaks no corrió: el entorno no tiene permisos de Docker, que es como corre ese check).
- Board (sólo lectura, simulación, 2026-11-21): `node scripts/vencimientos-gates.mjs` → `Gates sin fecha de vencimiento en MSF: 0 de 71 gates del board (781 ítems leídos para el contraste).`
- Board (medición de la API para el diseño del contraste, 2026-11-21): `GET /projects/MSF/issues?labelIds={735,736,738}&limit=500` → 10 + 25 + 50 = **71** gates, los mismos ids que el board; `?typeId={12,20,21,22}&limit=500` → 100 + 302 + 259 + 120 = **781** ítems; los mismos 71 gates. La lectura global sin filtro de tipo (`?limit=5000`) devuelve **exactamente 500**: el tope real de la API.
- Board (aplicación, 2026-11-19): `node scripts/vencimientos-gates.mjs --aplicar` → `Fecha puesta en 19 ítem(s).`
- Board (verificación): `node scripts/vencimientos-gates.mjs` → **0 gates sin fecha**; `GET /issues/1145` (MSF-909) → `dueDate: "2026-11-15"`, `statusSince: "2026-11-14T18:52:03.189Z"` (24 h en `America/Argentina/Buenos_Aires`, 2026-11-15).
- Re-verificación (2026-11-20): `node scripts/vencimientos-gates.mjs` → **0 gates sin fecha** de 830 ítems; `GET /issues/1145` → `dueDate: "2026-11-15"`.
- Re-verificación (2026-11-21): `node scripts/vencimientos-gates.mjs` → **1 gate sin fecha** de 831 ítems (MSF-988, escalado a humano después del barrido del 2026-11-19); `--aplicar` → `Fecha puesta en 1 ítem(s).`; simulación → **0 gates sin fecha** de 831 ítems; `GET /issues/1224` (MSF-988) → `dueDate: "2026-11-18"`.
- Tope por tipo (2026-11-21): la API del tracker honra `limit` pero **ignora** `offset`/`page`/`skip` (medido: `limit=10` → 10 ítems, `limit=500` → los 350 que hay). El tope de 500 está documentado en el contrato de la API (`GET /docs/json`: `limit`, «Max results (1-500)»).
- Mutación (revertida) para ver que los tests vigilan las reglas: quitar el `contrastarBoard` rompe 2 tests; sacar el `alAplicar` rompe 1; el tope de ítems `>=` → `>` rompe 2.

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
