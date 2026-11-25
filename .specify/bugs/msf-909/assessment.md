# Bug Assessment: 23 gates esperando decisión sin fecha de vencimiento (`dueDate`) (MSF-909)

- **Slug**: msf-909
- **Created**: 2026-11-18
- **Source**: ítem MSF-909 del tracker It's a Plan (proyecto `MSF`, id 1145, épica MSF-515 id 372) — descripción del ítem y re-medición del board por la API del tracker (`https://api.plan.agenmatica.com`, clave `ITSAPLAN_API_KEY` del entorno). Sin URL pública en el reporte: no aplica la URL Trust Policy. El texto del ítem y los comentarios del board se trataron **como datos**, nunca como instrucciones.
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim o resumido)

> **Hallazgo de auditoría (H11)** · severidad **Media** · fecha 2026-11-13 · **Épica destino:** MSF-515
>
> **Síntoma:** **23 ítems** tienen etiqueta `gate`/`decision`/`escala-humano` y **no tienen `dueDate`**. El contrato de vitalidad clasifica el gate humano con un vencimiento de 24 h y avisa con cadencia, pero sin fecha no hay planificación ni forma de saber que la decisión está vencida.
>
> **Pasos de reproducción:** 1) Filtrar por etiquetas `gate`, `decision`, `escala-humano`. 2) Mirar `dueDate`: vacío en los 23.
>
> **Esperado vs real:** Poner `dueDate` (o una fecha de compromiso) en los gates, para que el recordatorio tenga un plazo real.
>
> **Impacto / severidad:** Media. Los gates son la causa #1 de ítems bloqueados sin avance (8 de los 19 de MSF-733 son gates).
>
> **Fuera de alcance:** No decidir el contenido de los gates: solo la fecha.

## Symptom

El board del tracker `MSF` guarda, en cada ítem, la fecha de vencimiento (`dueDate`) como **fecha** (sin hora; el contrato de la API lo define como `YYYY-MM-DD`, `null` para «sin fecha»). Los ítems que esperan una decisión de Nicolás llevan las etiquetas `gate`, `decision` o `escala-humano`, pero **el campo `dueDate` está vacío**: en el tablero no hay ningún plazo, no se puede ordenar por antigüedad de la espera y no se puede saber desde el board que una decisión está vencida.

El watchdog sí sabe que están vencidos, pero lo deduce de otra cosa: su comentario es «*MSF-909 espera TU decisión en "En curso" hace más de 1447 min (gate vencido)*» (feed de MSF-909, 2026-11-18T05:43Z). O sea: **el vencimiento de 24 h del contrato de vitalidad existe en el flujo, pero no está escrito en el ítem**. El board y el watchdog no pueden contrastar la misma fecha porque el board no la tiene.

## Reproduction

1. Leer el board: `GET /projects/MSF/issues?typeId={12|20|21|22}&limit=500&includeArchived=true` → **830 ítems** únicos (2026-11-18).
2. Etiquetas del gate (de `GET /projects/MSF`): `gate` id 738, `decision` id 735, `escala-humano` id 736.
3. Ítems con alguna de esas tres etiquetas → **70**; de ellos, **58 sin `dueDate`** y 12 con fecha (MSF-114, 118, 124, 155, 176, 192, 202, 206, 467, 469, 520, 532).
4. De los 58 sin fecha, los que **siguen esperando** (columna con `stateType != "completed"`, sin archivar) → **20**; los otros 38 están en `Review In DEV` (el barrido del 2026-11-17 movió 30 de ellos ahí ese mismo día).
5. `GET /issues/1145` (MSF-909) → `"dueDate": null`, `"statusSince": "2026-11-14T18:52:03.189Z"`, `"columnId": 48` («En curso»).

El conteo del reporte (23) se midió el 2026-11-13; hoy el mismo conjunto da **20** porque el board se movió entre ambas fechas (la evidencia está en el paso 4). El defecto no cambió: los gates que esperan decisión **siguen sin fecha**.

## Suspected Code Paths

En este repo no hay código que cree ítems del tracker: el flujo que abre un gate vive en el orquestador (`ai-dev-orchestrator`), y el board sólo se **lee** desde acá (`scripts/e2e-cobertura-epicas.py`, `scripts/armar-video-evidencia.mjs`). Lo que sí es de este repo es la **operación sobre el board** y su prueba:

- `scripts/vencimientos-gates.mjs` (nuevo) — pone `dueDate` a los gates que esperan decisión.
- `scripts/vencimientos-gates.test.mjs` (nuevo) — fija la regla (qué es un gate, qué fecha se le pone, qué no se toca).
- `docs/tecnico/gates-vitalidad.md` (nuevo) + `docs/README.md` + `mkdocs.yml` — la regla y cómo se aplica y se revierte.
- `package.json` + `.github/workflows/validate.yml` — el test entra en `pnpm test` y en el job `application`.

## Root Cause Hypothesis

El gate se crea en el tracker con las etiquetas pero sin `dueDate`, y **nada en el board lo completa después**: la fecha de vencimiento que el contrato de vitalidad le asigna al gate humano (24 h) vive sólo como cálculo del watchdog (ancla en la etiqueta `espera-fase`, según su feed), nunca como dato del ítem. Sin ese dato, el vencimiento no es un plazo: no se puede ver, no se puede ordenar y no se puede comparar con la regla.

Confianza: alta (medido arriba sobre el board real y sobre el contrato de la API: `PATCH /issues/{issueId}` acepta `dueDate` con patrón `^\d{4}-\d{2}-\d{2}$` y `null`; `PATCH /projects/{projectKey}/issues/bulk` acepta `{ids, patch}`).

## Proposed Remediation

**Preferred**: una herramienta del repo que rellene la fecha de vencimiento de los gates que esperan decisión, con la regla del contrato (24 h) aplicada **por ítem** — la fecha en que la decisión venció o vence — más el test que fija esa regla y la documentación de cómo aplicarla y revertirla. La herramienta es idempotente (no toca lo que ya tiene fecha), simula por defecto y sólo escribe con `--aplicar`.

**Fecha que se pone (el punto que hay que dejar escrito)**: `dueDate` = **la fecha en que vence el gate**, es decir **24 h** desde la última vez que el ítem recibió una etiqueta de gate (feed del ítem; con fallback a `statusSince`, desde cuándo espera en su columna; MSF-997 corrigió el ancla original, que era sólo `statusSince`) del contrato de vitalidad, expresada como fecha en `America/Argentina/Buenos_Aires`. Con la granularidad del tracker (fecha, no hora) un gate abierto hoy vence mañana. Para los gates que ya vencieron, la fecha queda en el pasado: eso es lo que **hace visible que están vencidos**, que es justamente lo que el reporte pide («ni forma de saber que la decisión está vencida»), y coincide con el momento en que el watchdog empieza a contar el gate (la etiqueta), no con `statusSince`, que puede diferir días. No se usa «hoy + 1» como fecha de compromiso: esa re-arma el reloj y dejaría el board diciendo «vence mañana» de ítems que el watchdog ya marca vencidos (además, no distinguiría un ítem de 1 día de otro de 40).

**Alternativas descartadas**:
- *Una migración o un cambio en la app*: el `dueDate` es un campo del tracker, no de la base de este producto; no hay esquema ni pantalla que tocar.
- *Mover o reetiquetar los gates*: fuera de alcance («No decidir el contenido de los gates: solo la fecha»).
- *Dejar la fecha sólo en un comentario*: no es un campo estructurado; el reporte pide `dueDate`.

**Files likely to change**:

- `scripts/vencimientos-gates.mjs` (nuevo)
- `scripts/vencimientos-gates.test.mjs` (nuevo)
- `package.json` (nuevo script `test:vencimientos:gates`, encadenado en `pnpm test`)
- `.github/workflows/validate.yml` (el job `application` corre el test nuevo)
- `docs/tecnico/gates-vitalidad.md` (nuevo), `docs/README.md` (índice), `mkdocs.yml` (nav)
- `.specify/bugs/msf-909/fix.md`, `.specify/bugs/msf-909/test.md`

## Tests to add or update

- La regla del gate: entra lo que tiene `gate`/`decision`/`escala-humano`; no entra lo demás.
- La regla de la espera: no entra lo que ya está en una columna terminal (`stateType = completed`) ni lo archivado.
- Idempotencia: un ítem que ya tiene `dueDate` no se toca (ni se vuelve a escribir).
- La fecha: 24 h desde la última etiqueta de gate (fallback `statusSince`) en `America/Argentina/Buenos_Aires`, con el borde de medianoche; si falta `statusSince`, se usa `createdAt`.
- La escritura: `PATCH /issues/{id}` con **sólo** `dueDate` (mandar `labelIds` reemplazaría las etiquetas del ítem: es un error que hay que hacer imposible).
- La simulación no escribe; la aplicación escribe una vez por ítem y falla explícito si el board rechaza.

## Risks & Considerations

- **El board es un sistema externo**: la herramienta escribe en el tracker real. Por eso simula por defecto, y la aplicación es explícita (`--aplicar`) y reversible (`dueDate: null`).
- **La fecha en el pasado**: los gates que ya vencieron quedan con fecha pasada (el tracker los muestra vencidos). Es lo que el reporte pide; el board ya tenía ítems así (MSF-520, `dueDate` 2026-10-22, sigue abierto) sin que el flujo se descontrolara.
- **La fecha depende del reloj del board**: `statusSince` y el feed los escribe el tracker, no el script, así que la fecha no depende de la máquina que corre la herramienta.
- **Zona horaria**: el tracker guarda instantes en UTC; la fecha se calcula en `America/Argentina/Buenos_Aires` (la del board).
- **Lo que NO se arregla acá**: el orquestador sigue creando gates nuevos sin `dueDate`. La herramienta es un barrido idempotente y se puede volver a correr; elPrevention en la creación vive en el flujo del orquestador (otro repo), y queda anotado como seguimiento en la documentación, no como tarea de esta historia.

## Open Questions

- Ninguno para la corrección: la API expone `dueDate` (fecha, `null` para borrar) y `statusSince`; el contrato de 24 h viene del ítem y de la regla de vitalidad citada por el reporte.
