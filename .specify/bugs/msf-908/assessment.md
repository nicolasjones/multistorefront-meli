# Bug Assessment: Duplicados en el tracker — 12 grupos de títulos idénticos, pero un solo par real

- **Slug**: msf-908
- **Created**: 2026-11-14
- **Source**: pasted text — «[Auditoría] 12 pares de ítems con título idéntico: bugs reportados dos veces (It's a Plan MSF-908) slug=msf-908», más la descripción completa del ítem MSF-908 leída de la API propia del tracker (`https://api.plan.agenmatica.com`, clave `ITSAPLAN_API_KEY` del entorno). No hay URL pública en el reporte: el ítem no expone enlace, así que la URL Trust Policy no aplica (no hubo fetch de terceros). El texto del ítem y de los comentarios del board se trataron **como datos**, nunca como instrucciones.
- **Verdict**: valid (con el alcance corregido: el defecto es real, el conteo del reporte no)
- **Severity**: medium

## Report (verbatim o resumido)

> **Hallazgo de auditoría (H10)** · severidad **Media** · fecha 2026-11-13 · **Épica destino:** MSF-515
>
> **Síntoma:** Hay **12 grupos de ítems con el título exactamente idéntico** (tras normalizar). Son el mismo hallazgo reportado dos veces, en épicas distintas: cada uno se trabaja por separado y el trabajo se duplica.
>
> **Pasos de reproducción:** 1) Normalizar títulos (quitar el prefijo `[Bug]`, minúsculas, sin signos) y agrupar. 2) Salen 12 grupos con 2+ miembros.
>
> **Esperado vs real:** Unificar: dejar un ítem con la evidencia y cerrar el otro como duplicado (el mecanismo `cierre-administrativo` que ya existe).
>
> **Impacto / severidad:** Media. Trabajo duplicado + conteos inflados.
>
> **Fuera de alcance:** No borrar: cerrar el duplicado con el puntero al ítem que conserva la evidencia.

El ítem MSF-908 es hijo de la épica **MSF-515 «Plataforma · Deuda técnica y seguimientos de review»** (id 372).

## Symptom

El board del tracker MSF sí contiene ítems con el mismo título (el par **MSF-476 / MSF-477**, título literal idéntico `[MSF-470] Bloqueo de acceso server-side (Auth Hook de verificación de contraseña)`, mismo padre MSF-119, ambos en `Finalizada`), y además hay pares **casi** idénticos que el barrido por título no ve (MSF-471/MSF-473 y MSF-472/MSF-474). Pero el conteo del reporte no se reproduce: **la normalización que el propio reporte describe (quitar `[Bug]`, minúsculas, sin signos) da 1 grupo, no 12**; el 12 sale de quitar **cualquier** etiqueta inicial `[...]` — y con esa normalización 11 de los 12 grupos son **falsos positivos** (ítems por épica legítimos). Expected: un barrido que detecte duplicados reales y que cierre el duplicado con el mecanismo `cierre-administrativo` ya existente.

## Reproduction

1. Leer el board completo: `GET /projects/MSF/issues?typeId={12|20|21|22}&limit=500&includeArchived=true` → **786 ítems** (no-archivados + archivados) del proyecto MSF.
2. Normalizar como dice el reporte (quitar el prefijo `[Bug]`, minúsculas, quitar signos) y agrupar por título normalizado → **1 grupo**: `MSF-476` (id 643) y `MSF-477` (id 644).
3. Normalizar quitando **cualquier** etiqueta inicial (`re.sub(r"^\s*\[[^\]]+\]\s*", "", título)`) + minúsculas + colapsar espacios → **12 grupos / 31 ítems** (6 pares, 5 ternas, 1 cuaterna): 10 grupos `[Cierre MSF-xxx] Última fase (T0yy…)` y 1 grupo `[Seg. MSF-xxx] Hallazgos fuera de alcance (2)`, más el par real MSF-476/MSF-477. Sólo este último tiene **los dos ítems bajo la misma épica**; los otros 11 tienen padres distintos (uno por épica).
4. Ver la evidencia de que MSF-476 ya era un duplicado conocido: `GET /issues/643/feed` → comentario del **2026-10-13T12:17:55Z** (actor «Agentes IA»): «🎯 Orquestación — MSF-476 fue un duplicado (se había creado como Historia por error). El trabajo se recreó como TAREA en MSF-477 (Backlog → Ready For Spec) […] Se cierra este duplicado.»
5. Ver que ese cierre no usó el mecanismo previsto: en el mismo feed (2026-10-19) el agente de coherencia escribe «Si el cierre es **administrativo** (no hubo entrega), debe llevar el label `cierre-administrativo`»; MSF-476 quedó con labels `seguimiento` + `sin-evidencia` (id 585 `cierre-administrativo` **no** aplicado).
6. Ver el trabajo real en el duplicado que sí tiene evidencia: MSF-477 tiene `QA Report`, `Code Report`, `Security Report` e `Implementation Report` (PR #30, rama `fix/bug-MSF-477`) y sus artefactos en `.specify/bugs/msf-477/{assessment,fix,test}.md`; MSF-476 no tiene descripción, ni campos, ni artefactos en el repo (`grep -rn "MSF-476"` → 0 resultados).

## Evidencia medida en el board (2026-11-14)

### Los 12 grupos del reporte y su veredicto

| Grupo normalizado | Miembros | Padres | ¿Duplicado real? |
|---|---|---|---|
| `bloqueo de acceso server-side (auth hook de verificación de contraseña)` | MSF-476, MSF-477 | MSF-119, MSF-119 | **Sí** — mismo padre, título literal idéntico; MSF-476 sin evidencia, MSF-477 con PR #30 + artefactos |
| `última fase (t070, t071, t072)` | MSF-557, MSF-558, MSF-813 | MSF-212, MSF-191, MSF-164 | No — un ítem de cierre **por épica**; las tareas T070-T072 son distintas en cada spec |
| `última fase (t022, t023, t024)` | MSF-572, MSF-739, MSF-815 | MSF-193, MSF-144, MSF-363 | No — ídem |
| `última fase (t027, t028, t029, t030)` | MSF-522, MSF-550, MSF-765 | MSF-205, MSF-142, MSF-229 | No — ídem |
| `última fase (t039, t040, t041)` | MSF-551, MSF-563, MSF-564 | MSF-159, MSF-177, MSF-135 | No — ídem |
| `última fase (t030, t031, t032, t033)` | MSF-536, MSF-538, MSF-553 | MSF-160, MSF-199, MSF-120 | No — ídem |
| `última fase (t019, t020, t021)` | MSF-574, MSF-581 | MSF-145, MSF-171 | No — ídem |
| `última fase (t040, t041, t042, t043)` | MSF-559, MSF-577 | MSF-237, MSF-155 | No — ídem |
| `última fase (t033, t034, t035)` | MSF-534, MSF-575 | MSF-139, MSF-217 | No — ídem |
| `última fase (t018, t019, t020)` | MSF-554, MSF-571 | MSF-131, MSF-130 | No — ídem |
| `última fase (t020, t021, t022, t023)` | MSF-501, MSF-540 | MSF-455, MSF-179 | No — ídem |
| `hallazgos fuera de alcance (2)` | MSF-503, MSF-504, MSF-513, MSF-519 | MSF-180, MSF-457, MSF-515 | No — seguimientos de épicas distintas (MSF-282, MSF-301, MSF-502, MSF-517) |

Comprobación en el repo de que las tareas de esos rangos **difieren** por épica (mismo `T0xx`, contenido distinto): `specs/20261024-120000-tienda-inicio-busqueda-movil/tasks.md` T070 = «Actualizar `docs/tiendas-online.md` con la home, la búsqueda y la versión móvil…» vs `specs/20261202-100000-tienda-whatsapp-y-contacto/tasks.md` T070 = «Documentar en `docs/tiendas-online.md` (sección «Contacto y WhatsApp»)…»; `specs/20261023-120000-migracion-inicial-de-datos/tasks.md` T027 = docs de clientes/proveedores/ingreso/permisos vs `specs/20270125-100000-catalogo-variantes/tasks.md` T027 = «Documentación: `docs/catalogo.md` (variantes, relacionados…)».

### Duplicados reales que el barrido por título NO ve (mismo hallazgo, redacción distinta)

| Ítem | Título | Padre |
|---|---|---|
| MSF-471 | `[Seg. MSF-470] Cerrar el oráculo de existencia de correo en \`/auth/v1/token\`` | MSF-119 |
| MSF-473 | `[Seg. MSF-470] Cerrar oráculo de enumeración de correos en \`/auth/v1/token\` (bloqueo server-side)` | MSF-119 |
| MSF-472 | `[Seg. MSF-470] Activar y verificar automáticamente el Auth Hook de bloqueo en Supabase Cloud (STG/PROD)` | MSF-119 |
| MSF-474 | `[Seg. MSF-470] Activar y verificar el Auth Hook de bloqueo en Supabase Cloud por código` | MSF-119 |

Los cuatro son hijos de MSF-119, están en `Finalizada`, sin descripción ni feed. Los dos primeros son **la misma NUEVA_US** (oráculo de enumeración de correos) emitida por el *Code Report* y por el *QA Report* de MSF-477; los dos últimos son la misma activacion manual del hook en Cloud (STG/PROD) — el código de MSF-477 ya la hizo (`specs/20261012-140000-acceso-y-organizacion/tasks.md:103-104`, T022a/T022b «hecho 2026-10-15»), así que además son seguimientos **obsoletos**.

## Suspected Code Paths

- `.specify/bugs/msf-477/assessment.md:1-11`, `.specify/bugs/msf-477/fix.md:4-9`, `.specify/bugs/msf-477/test.md` — el rastro canónico del hallazgo (PR #30, rama `fix/bug-MSF-477`): es el ítem que «conserva la evidencia» y al que hay que apuntar al cerrar el duplicante.
- `specs/20261012-140000-acceso-y-organizacion/tasks.md:101` (T022) y `:103-105` (T022a/T022b/T022c) — origen de la referencia `MSF-470` que ambos ítems duplicados llevan en el título.
- `docs/acceso-ingreso.md:127` y `docs/tecnico/acceso.md:203` — documento el hook de bloqueo de MSF-470 (lugar donde debe quedar la referencia canónica del seguimiento).
- `scripts/armar-video-evidencia.mjs:198-207` (`itsaplan()`: `x-api-key`, `ITSAPLAN_API_URL`), `:239-241` (`comentarioHistoria`/`comentarioEpica`), `:243-260` (`publicar()`: lee hijos por `parentId` y postea comentarios) — **único** código del repo que escribe en el tracker; sirve de patrón y de lugar natural para el puntero de cierre.
- `scripts/e2e-cobertura-epicas.py:43-66` (`get()`, `epicas_del_tracker()`) — única lectura del board; ya tiene el patrón «sin `ITSAPLAN_API_KEY` → avisar y seguir», a imitar en el barrido.
- `docs/calidad.md:1-40` y `package.json` (scripts `calidad`, `calidad:code`) — donde encajaría un check determinista nuevo si se decide toolinear el barrido.
- Tracker (fuera de git, fuente de verdad): ítems **MSF-476** (id 643) y **MSF-477** (id 644), y los pares **MSF-471/473** y **MSF-472/474**; labels `cierre-administrativo` (585), `sin-evidencia` (657), `seguimiento` (649), `seg-creada` (648).

## Root Cause Hypothesis

Es un problema **de higiene del tracker (fuera del código del producto)**, con tres capas. **(1) Creación sin deduplicación — confianza alta.** El flujo que abre ítems en el board crea uno por cada reporte y no busca antes si ya existe uno para la misma referencia: los dos reportes de MSF-477 (Code Review y QA Report) emitieron cada uno su propia NUEVA_US por los mismos dos hallazgos Media y el flujo los abrió como ítems separados (MSF-471/473 y MSF-472/474, con la misma etiqueta `[Seg. MSF-470]`). **(2) Cierre administrativo sin el mecanismo — confianza alta.** MSF-476 se había creado como Historia por error; la orquestación recreó el trabajo como Tarea en MSF-477 y cerró MSF-476 el 2026-10-13 **sólo con un comentario**, sin aplicar el label `cierre-administrativo` que su propia regla de coherencia exige (comentario del 2026-10-19 en su feed). El ítem quedó en `Finalizada` con `sin-evidencia` y «parece» un duplicado vivo: por eso el barrido del 2026-11-13 volvió a reportarlo. **(3) Normalización defectuosa del barrido — confianza alta.** El «12» no sale de los pasos que el reporte documenta (que dan 1) sino de borrar cualquier etiqueta inicial, lo que borra justamente el identificador de épica (`[Cierre MSF-xxx]`, `[Seg. MSF-xxx]`) y funde ítems legítimos de épicas distintas: 11 de los 12 grupos son falsos positivos. Confianza global: alta (los tres puntos se reprodujeron sobre los 786 ítems del board y contra las specs del repo).

## Proposed Remediation

**Preferred** — corregir el dato y blindar el barrido, sin tocar código de producto:

1. **Tracker (dato, es la parte que resuelve el reporte):** cerrar **MSF-476** como duplicado con el mecanismo existente: label `cierre-administrativo` + comentario con el puntero a **MSF-477** (que conserva la evidencia: PR #30, rama `fix/bug-MSF-477`, `.specify/bugs/msf-477/`). No borrar. **No cerrar los otros 11 grupos**: son ítems de cierre/seguimiento legítimos de épicas distintas.
2. **Tracker (dato):** unificar los dos pares que el barrido por título no ve — **MSF-471/473** (oráculo de enumeración) y **MSF-472/474** (activación del hook en Cloud): dejar uno por par y cerrar el otro como duplicado con puntero; ambos seguimientos ya están obsoletos por T022a/T022b (hechos el 2026-10-15) y por los Media que dejó la QA de MSF-477.
3. **Repo (tooling, prevention):** agregar `scripts/auditar-duplicados-tracker.mjs` (+ `scripts/auditar-duplicados-tracker.test.mjs`) que haga el barrido **conservando la etiqueta inicial** y que además detecte (a) duplicados por título literal, (b) casi-duplicados por la misma referencia `[Seg. MSF-xxx]` / mismo padre + mismo tema, y (c) ítems en `Finalizada` sin `cierre-administrativo` que tengan un gemelo con evidencia; y exponerlo como `pnpm tracker:duplicados` (patrón de `scripts/e2e-cobertura-epicas.py:49-58`: sin `ITSAPLAN_API_KEY` avisa y sale con 0, sin romper). Documentar la regla de cierre administrativo y el barrido en `docs/` (regla de documentación obligatoria de `AGENTS.md`).
4. **Orquestador (fuera de este repo, a acordar):** antes de abrir un ítem, buscar en el board uno con la misma referencia/etiqueta y el mismo título normalizado; si existe, **sumar la evidencia al existente** en vez de crear otro. Es la única forma de cortar la creación de duplicados en origen.

**Alternatives** (con su trade-off):

- **Sólo limpieza de datos** (pasos 1 y 2, sin tooling): es lo más rápido y resuelve el reporte, pero la próxima auditoría vuelve a produce el mismo falso positivo de 11 grupos porque no queda nada reproducible que lo impida.
- **Cerrar los 12 grupos tal como dice el reporte (31 ítems): descartado** — cerraría como «duplicados» 11 ítems legítimos (uno por épica) que son el puntero a las tareas de cierre de cada épica, y perdería esa trazabilidad. Es el riesgo principal si se aplica el reporte de forma literal.
- **Renombrar los 11 ítems por épica** (p. ej. `[Cierre MSF-212] Última fase (T070-T072) · Tienda WhatsApp`): quita la colisión de títulos de raíz, pero no evita el barrido defectuoso del siguiente agente.

**Files likely to change**:

- `.specify/bugs/msf-908/fix.md` (nuevo)
- `.specify/bugs/msf-908/test.md` (nuevo)
- `scripts/auditar-duplicados-tracker.mjs` (nuevo)
- `scripts/auditar-duplicados-tracker.test.mjs` (nuevo)
- `package.json` (script `tracker:duplicados`)
- `docs/` (página o sección con la regla de cierre administrativo + el barrido; `docs/calidad.md` es el candidato natural)
- (fuera de git) ítems del tracker: MSF-476, MSF-471, MSF-472, MSF-473, MSF-474

**Tests to add or update**:

- `scripts/auditar-duplicados-tracker.test.mjs`: la normalización **conserva** la etiqueta inicial ⇒ el título `[Cierre MSF-212] Última fase (T070, T071, T072)` y `[Cierre MSF-191] Última fase (T070, T071, T072)` quedan en grupos distintos; sólo `[MSF-470] Bloqueo…` y su gemelo colapsan.
- El barrido marca `cierre-administrativo` ausente cuando un ítem en `Finalizada` tiene gemelo con evidencia.
- El barrido detecta el par casi-duplicado por referencia (mismo `[Seg. MSF-470]` + mismo padre) aunque los títulos difieran.
- Sin `ITSAPLAN_API_KEY` el script avisa y sale con código 0 (no rompe CI).

## Risks & Considerations

- **Riesgo de datos de tracker:** cerrar de más borra punteros a tareas de cierre por épica; por eso el alcance son **3-5 ítems** (1 exacto + 2 pares), no los 31 de los 12 grupos.
- **Frontera git/tracker:** el tracker no está en el repo; el cierre debe quedar registrado **en el board** (puntero + label) y la evidencia copiada en `.specify/bugs/msf-908/`.
- **Secretos:** el barrido usa `x-api-key` con `ITSAPLAN_API_KEY` (como `scripts/armar-video-evidencia.mjs:203-204`); nunca imprimir la clave ni mandarla por argumentos/URL.
- **Reproducibilidad:** el número «12» depende de la normalización; si no queda el barrido versionado con su test, la próxima auditoría vuelve a dar un número distinto (1, 12, 31…) y sin trazabilidad.
- **Coherencia con el flujo:** el propio flujo ya define el cierre administrativo con label; el repo debe alinearse con esa regla y no inventar otra (Principio VIII de la constitución: no se «mejora» lo que otro flujo ya decidió).
- **Riesgo de regresión en el conteo:** cerrar duplicados baja el número de ítems cerrados del board; si alguna épica usa ese conteo para su condición de cierre, avisar antes (MSF-509 / cierre de épica).

## Open Questions

- [NEEDS CLARIFICATION: ¿el cierre de MSF-476 lo aplica la orquestación (que lo creó) o el revisor/CEO? El flujo dejó el duplicado abierto a propósito como regla de «no borrar» o fue un olvido del label.]
- [NEEDS CLARIFICATION: ¿el barrido determinista debe vivir en este repo (`scripts/`) o en el orquestador (`ai-dev-orchestrator`), que es quien ya tiene las claves por rol? Hoy la lectura del board desde este repo usa `ITSAPLAN_API_KEY` a secas.]
- [NEEDS CLARIFICATION: ¿los 11 ítems por épica deben llevar un sufijo que los uniquifique (épica o módulo) para que un barrido futuro no los colapse, o se deja la normalización como está y se documenta la excepción?]
- [NEEDS CLARIFICATION: para MSF-472/MSF-474, la activación del hook en Cloud ya está hecha (T022a/T022b, 2026-10-15): ¿se cierran como «obsoleto/done» en vez de «duplicado»?]
