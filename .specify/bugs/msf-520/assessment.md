# Bug Assessment: Simulacro de restauración en staging sin ejecutar ni firmar (cierre MSF-457)

- **Slug**: msf-520 (provisto por el usuario)
- **Created**: 2026-11-14
- **Source**: pasted text — Jira MSF-520 «[seguimiento] Ejecutar y firmar el simulacro de restauración en staging (cierre MSF-457)» (sin URL; no se consultó Jira)
- **Verdict**: valid (deuda operativa trazada; no es una regresión de código)
- **Severity**: medium (riesgo latente de DR sin medir; hay mitigaciones parciales —copia diaria y verificación semanal automática de la base—; sube a **high** si el simulacro revela que la restauración sobre el Postgres real no funciona o deja privileges abiertos)

## Report (verbatim or summarized)

Tarea `seguimiento` de la spec `specs/20261018-120000-operacion-copias-y-documentacion` (épica MSF-457,
FR-011 / SC-002): ejecutar el simulacro de restauración en staging con tiempo medido (≤ 4 h) y pérdida
≤ 24 h, y dejar el resultado firmado por el propietario en `docs/simulacro-restauracion.md`. La tarea
T018 se cerró con `[x]` + `Desvío:` («no hay autorización para tocar staging»), sin simulacro, sin
tiempos y sin firma; el seguimiento quedó trazado como MSF-520 (Tarea `seguimiento` en el tracker).

## Symptom

El simulacro de restauración **nunca se ejecutó**: el registro de `docs/simulacro-restauracion.md`
tiene sus nueve campos en `_pendiente_` (incluida «Firma del propietario») y el documento, el índice
de docs, el roadmap y la guía de entrega lo declaran pendiente. Lo esperado (FR-011 / SC-002) es un
simulacro **medido** contra los objetivos (RTO ≤ 4 h, pérdida ≤ 24 h) y **firmado** por el
propietario. Hoy no existe ningún resultado medido: la copia diaria y la verificación semanal
automática **no lo sustituyen** (`verificar-restauracion` restaura sólo la base en un Postgres
efímero y aislado, no toca el entorno real, no restaura imágenes y no mide el tiempo de punta a
punta), y el propio contrato estático lo dice: «No reemplaza el simulacro de restauración en un
Kestra real» (`infra/kestra/validar-copias-flows.test.mjs:1-5`).

## Reproduction

1. Abrir `docs/simulacro-restauracion.md`: sección «Estado» = «**Pendiente de ejecución en
   staging**» (`:12-23`) y tabla «Registro del simulacro» con los nueve campos en `_pendiente_`
   (`:42-54`).
2. Seguir la deuda en la documentación: `docs/README.md:71` («documentado pero **no ejecutado**…
   Seguimiento: **MSF-520**»), `docs/roadmap-template.md:54` («Parcial: simulacro pendiente»),
   `docs/operar-sistema.md:64-65` («pendiente de ejecución en staging»),
   `docs/entregar-sistema.md:26-27` (casilla `- [ ]` sin marcar), `docs/producto/operacion-copias-y-documentacion.md:15-16,35`
   y `docs/tecnico/operacion-copias-y-documentacion.md:53`.
3. En la spec: `specs/20261018-120000-operacion-copias-y-documentacion/tasks.md:52` → T018 `[x]`
   con `Desvío:`; FR-011 y SC-002 (`:101,106`) siguen sin verificación real.
4. En el entorno: no hay corrida de simulacro. `public.verificaciones_restauracion` sólo registra la
   verificación automática semanal (base, Postgres efímero). La medición de RTO/RPO no existe en
   ninguna parte.

[NEEDS CLARIFICATION: quién autoriza, quién ejecuta y quién firma; no hay autorización sobre
staging en el repo ni ventana de downtime acordada.]

## Suspected Code Paths

- `docs/simulacro-restauracion.md:12-54` — el registro a completar y firmar (todo `_pendiente_`) y el
  protocolo (`:32-40`, pasos 1–5) que hay que ejecutar; es el artefacto que FR-011/SC-002 miden.
- `docs/copias-y-restauracion.md:126-173` — «Procedimiento guiado de restauración» (sección A base,
  sección B imágenes) que el simulacro debe ejecutar; `:142-149` es el comando de restauración
  (`pg_restore … --no-owner --no-privileges --single-transaction`); `:170-173` «Tiempos a registrar»
  (el dato del simulacro); `:44-47` el objetivo 24 h/4 h marcado como *propuesta a confirmar con el
  cliente*.
- `docs/copias-y-restauracion.md:49-52` y `:88-92` — el simulacro **debe** incluir el envío de
  prueba del aviso por correo («repetirlo en cada simulacro»), pero el protocolo del simulacro
  (5 pasos) no lo incluye: hueco entre lo exigido y lo ejecutado.
- `docs/copias-y-restauracion.md:49-50` — texto desactualizado: dice que la guía
  `docs/simulacro-restauracion.md` «aún no existe en esta rama» (ya existe) → corregir antes de
  ejecutar y signed el simulacro.
- `docs/tecnico/runbooks/db-restore.md:16-20` — runbook genérico de restauración: paso 1 «Detener
  escrituras», paso 3 «restaurar en una base **temporal** primero», paso 5 «**Verificar RLS/roles/grants**
  y volver a habilitar escrituras» → el simulacro debe alinearse con él (y el paso 5 es el control
  que hoy el simulacro no tiene).
- `supabase/migrations/20261018120000_copias_imagenes_y_verificaciones.sql:120-121,146-147,165-166,217-218,241-242,260-261`
  — `revoke execute … from public, authenticated, anon` + `grant execute … to kestra_backups` sobre
  funciones `security definer` que escriben el historial de copias. Con el `--no-privileges` del
  `pg_restore` documentado, esos ACL **no se reaplican** al restaurar: las funciones quedan
  ejecutables por `PUBLIC` y, al ser `security definer`, cualquiera (incluido `anon` vía PostgREST)
  podría escribir el historial de copias → auditoría falsificable justo después de restaurar.
- `supabase/migrations/20260913140000_backups_postgres.sql:112-113,136-137,155-156` — lo mismo para
  `public.iniciar_respaldo`, `public.finalizar_respaldo_completado`, `public.finalizar_respaldo_error`.
- `supabase/tests/database/copias_imagenes_verificaciones.test.sql:29-50` — el invariante «sólo
  `kestra_backups` ejecuta las funciones» ya está testeado: sirve como comprobación post-simulacro
  sobre la base restaurada (si el restore lo rompe, el pgTAP queda rojo).
- `infra/kestra/flows/verificar-restauracion.yml:64-90,146-156` — verificación automática semanal
  (Postgres efímero `networkMode: none`, `pg_restore --no-owner --no-privileges`, cron `0 5 * * 1`):
  es el pre-flight (que haya una verificación `completado` reciente), **no** el simulacro.
- `infra/kestra/flows/respaldo-postgres.yml:74-83` — `pg_dump --format=custom` (el dump **sí**
  incluye los ACL) y `infra/kestra/flows/respaldo-imagenes.yml:80,141-143` (copia de Storage,
  03:15 diario): el origen de las copias a restaurar.
- `infra/kestra/flows/aviso-fallo-copias.yml:31-45` — el aviso por correo que hay que probar en
  cada simulacro; depende de `KESTRA_SMTP_*`/`SOPORTE_CORREO`, cuyos valores por defecto en
  `infra/kestra/.env.example:41-47` son `smtp.example.com` / `example.com` (con
  `transmitFailed: false`, un SMTP sin configurar pierde el aviso en silencio).
- `infra/kestra/validar-copias-flows.test.mjs:1-5` — el propio contrato estático declara que no
  reemplaza el simulacro: la deuda es real y conocida.
- Cierre documental a actualizar al ejecutar: `docs/README.md:71`, `docs/roadmap-template.md:54`,
  `docs/operar-sistema.md:64-65`, `docs/entregar-sistema.md:26-27`,
  `specs/20261018-120000-operacion-copias-y-documentacion/tasks.md:52`,
  `docs/producto/operacion-copias-y-documentacion.md:15-16,35` y
  `docs/tecnico/operacion-copias-y-documentacion.md:53` (afirman que la épica «no tiene spec ni
  código propio en el repo»: desactualizado desde que la spec existe).

## Root Cause Hypothesis

No es un defecto de código: el simulacro se cerró como `Desvío:` en T018 por falta de autorización
sobre staging y quedó trazado como MSF-520; el documento lo declara con honestidad («No se inventa
ningún resultado»), que es el comportamiento correcto mientras no se ejecute. La causa del bug es
**operativa y de proceso**: nadie ejecutó el procedimiento ni firmó el registro, y el procedimiento
documentado todavía **no es ejecutable de punta a punta tal como está** — le faltan (a) el envío de
prueba del aviso por correo que la guía exige en cada simulacro, (b) la definición de la «caída
simulada» que hace falta para medir la pérdida de datos como número, (c) la verificación de
roles/grants y la comprobación de que la copia es restaurable sobre el Postgres **real** (no el
efímero), y (d) el paso de dejar staging sano tras la restauración. Además hay un hallazgo técnico
que el simulacro probablemente va a exponer: el `pg_restore` documentado usa `--no-privileges`, de
modo que al restaurar en el Postgres de staging las funciones `security definer` del historial de
copias quedan sin sus `revoke`/`grant` y recuperan `EXECUTE` para `PUBLIC` — es decir, el
procedimiento de restauración, tal como está escrito, deshace el invariante que el pgTAP verifica.
Confianza: **alta** en que el simulacro no se ejecutó y en los huecos del protocolo (verificables en
el repo); **media** en el alcance exacto del hallazgo de privilegios (no se ejecutó Postgres ni el
drill en esta evaluación; hay que confirmarlo en el entorno con
`has_function_privilege('anon', 'public.iniciar_respaldo_imagenes(text)', 'EXECUTE')`).

## Proposed Remediation

**Preferred**: ejecutar el simulacro en staging con autorización explícita del propietario, después
de cerrar los huecos del procedimiento y con el registro documentado paso a paso.

0. **Autorización y ventana** (prerrequisito, no ejecutable por el agente): autorización explícita
   del propietario sobre staging, ventana de downtime, quién ejecuta y quién firma.
1. **Cerrar los huecos del runbook antes de correr** (en `docs/simulacro-restauracion.md` y
   `docs/copias-y-restauracion.md`):
   a. agregar al protocolo el **envío de prueba del aviso por correo** (`docs/copias-y-restauracion.md:49-52,88-92`)
      y la **verificación de roles/grants** (`docs/tecnico/runbooks/db-restore.md:20`);
   b. definir cómo se mide la «caída simulada» (p. ej. una fila con `timestamp` en una tabla de
      staging antes de la foto, o la última escritura registrada) para que la pérdida ≤ 24 h sea un
      número medido y no una interpretación;
   c. corregir el texto desactualizado de `docs/copias-y-restauracion.md:49-50` («aún no existe en
      esta rama»);
   d. agregar al final del protocolo el **cierre**: copia fresca post-restauración
      (`respaldo-postgres` manual), relanzar web/workers/Kestra (paso 6 de la sección A) y
      confirmación de que el panel responde.
2. **Pre-flight en staging** (sólo lectura): que exista una verificación semanal `completado` en
   `public.verificaciones_restauracion`; filas `completado` en `public.respaldos` y
   `public.respaldos_imagenes`; `RESPALDOS_DIR_HOST` existente con permisos 700; `KESTRA_SMTP_*` y
   `SOPORTE_CORREO` con valores reales (no los de ejemplo).
3. **Ejecutar**: secciones A y B de `docs/copias-y-restauracion.md` sobre la última copia
   `completado`, con el panel y los workers detenidos mientras se restaura, anotando hora de inicio y
   fin de cada paso; comprobar login del panel, una organización conocida listando sus datos y una
   imagen del catálogo visible; enviar el aviso de prueba y confirmar que llega.
4. **Registrar y cerrar**: llenar la tabla de `docs/simulacro-restauracion.md` con los valores reales
   (nunca inventados) y la firma del propietario; actualizar `docs/README.md:71` (borrar la deuda
   trazada), `docs/roadmap-template.md:54` («Parcial: simulacro pendiente» → «Implementado»),
   `docs/operar-sistema.md:64-65`, `docs/entregar-sistema.md:26` (marcar la casilla),
   `specs/20261018-120000-operacion-copias-y-documentacion/tasks.md:52` (evidencia de T018) y
   `docs/producto/…` + `docs/tecnico/…` (estado real). Cerrar MSF-520 con la evidencia (registro
   firmado + evidencia de la ejecución).
5. **Si el simulacro confirma el hallazgo de privilegios**: agregar al procedimiento (sección A) y al
   runbook `db-restore.md` un paso «re-aplicar privilegios tras restaurar» — un script SQL
   versionado (p. ej. `scripts/reparar-privilegios-tras-restauracion.sql` con los `revoke`/`grant`
   de las funciones de `respaldos`, `respaldos_imagenes` y `verificaciones_restauracion`) ejecutado
   justo después del `pg_restore` y antes de volver a levantar la app, con su comprobación por
   `has_function_privilege` (el mismo criterio que el pgTAP). Es un cambio aditivo y con
   reversión trivial (volver a ejecutar el `revoke`/`grant`).

**Alternatives**:
- Quitar `--no-privileges` del `pg_restore` documentado: más simple, pero el destino puede no tener
  los roles/extensiones de Supabase y los `GRANT` a `kestra_backups` fallarían, dejando el restore
  a medias. El paso explícito de re-aplicar es controlable y auditable → **preferido**.
- Restaurar sobre una instancia temporal en lugar del Postgres de staging: no cumple el objetivo
  (el simulacro existe para probar el camino real y medir el tiempo de recuperación en el entorno
  real); sirve sólo como pre-check, no como simulacro → **descartada**.

**Files likely to change**:
- `docs/simulacro-restauracion.md` (estado, protocolo y registro firmado)
- `docs/copias-y-restauracion.md` (sección A: paso de privilegios y de correo; texto desactualizado)
- `docs/tecnico/runbooks/db-restore.md` (alinear con el procedimiento real: dump en formato custom,
  no `gzip -t`; paso 5 de verificación de grants)
- `docs/README.md`, `docs/roadmap-template.md`, `docs/operar-sistema.md`, `docs/entregar-sistema.md`
- `docs/producto/operacion-copias-y-documentacion.md`, `docs/tecnico/operacion-copias-y-documentacion.md`
- `specs/20261018-120000-operacion-copias-y-documentacion/tasks.md` (evidencia de T018)
- (condicional) `scripts/reparar-privilegios-tras-restauracion.sql` + su test

**Tests to add or update**:
- Chequeo de coherencia documental: que el estado del simulacro en `docs/simulacro-restauracion.md`,
  `docs/README.md` y `docs/roadmap-template.md` no se contradigan (hoy los tres dicen «pendiente»;
  al cerrar deben decir lo mismo). Debe tolerar el estado «pendiente» mientras la deuda siga abierta:
  es un control de coherencia, no una puerta que exija un simulacro firmado.
- Test estático del runbook: que la sección A incluya el paso de re-aplicar privilegios y el de
  verificación del correo (evita que el procedimento vuelva a perderlos en el próximo restore).
- pgTAP ya existente como comprobación post-simulacro: correr
  `supabase/tests/database/copias_imagenes_verificaciones.test.sql` (o las consultas
  `has_function_privilege`) contra la base restaurada de staging y dejar constancia del resultado.

## Risks & Considerations

- **El simulacro sobrescribe staging**: se pierden los datos escritos después de la copia
  restaurada. Exige autorización y aviso previo; nunca en producción (protocolo paso 1 y la
  Constitución: en producción, restaurar exige aprobación manual).
- `pg_restore --clean --if-exists` borra los objetos antes de recrearlos: si el restore falla,
  staging puede quedar sin base (con `--single-transaction` no deja la base a medias, pero el
  borrado previo sí ocurre) → tener a mano el dump, el procedimiento de reversión y una ventana
  suficiente.
- **Permisos tras restaurar**: si se confirma el hallazgo, queda una ventana en la que `anon`/
  `authenticated` podría escribir el historial de copias (`security definer` con `EXECUTE` para
  `PUBLIC`). Mitigación: aplicar el paso de privilegios **antes** de volver a levantar la app y
  verificar con `has_function_privilege`.
- **SMTP por defecto** (`smtp.example.com`/`example.com`, `infra/kestra/.env.example:41-47`): con
  `transmitFailed: false`, el aviso se pierde sin que nadie lo note. Si staging conserva esos
  valores, el paso de correo del simulacro no se puede cerrar y queda otro pendiente (relacionado
  con MSF-532, correo).
- **Copias en el mismo servidor** que la aplicación (`docs/copias-y-restauracion.md:54-61`):
  comprobar que el `RESPALDOS_DIR_HOST` de staging es distinto del de producción, para que un
  simulacro mal ejecutado no pise las copias del otro ambiente.
- El simulacro **no** cubre el riesgo asumido de perder el servidor completo (las copias están en
  el mismo servidor): eso es un seguimiento aparte y no lo tapa MSF-520.
- `docs:check` acepta `.specify/bugs/` como documentación válida, pero cualquier cambio en
  `infra/`, `supabase/` o `scripts/` exige además actualizar `docs/` o `specs/` en el mismo cambio.
- Si no se obtiene autorización, el resultado honesto es el estado actual (documento «pendiente»,
  deuda trazada): **no completar el registro con valores inventados**.

## Segunda evaluación (2026-11-19)

La primera pasada (PR #1054, mergeada) arregló el privilegio del historial de copias y completó el
protocolo, pero **el procedimiento de restauración que el simulacro usa tenía dos defectos que lo
harían fallar aun con autorización** (revisión sobre la base actual, `origin/dokploy`):

1. **El restore perdía los permisos del dump.** El procedimiento usaba `pg_restore --no-privileges`,
   que es justamente la opción que NO aplica los ACL del dump; como `--clean` recrea cada objeto, la
   base restaurada quedaba con los permisos por defecto. En este proyecto los permisos son
   explícitos por tabla (`auto_expose_new_tables = false`, `supabase/config.toml:26`), así que
   `authenticated` no leía y el paso 7 del simulacro («el panel inicia sesión, una organización
   conocida lista sus datos») fallaba. El dump sí los lleva: `pg_dump --format=custom` los incluye
   salvo `--no-acl`, y así se hace en `infra/kestra/flows/respaldo-postgres.yml:86`.
2. **El restore es atómico y no dejaba rastro si abortaba.** `--single-transaction` implica
   `--exit-on-error` (PostgreSQL 17, `src/bin/pg_dump/pg_restore.c:274-277`): ante el primer error
   `pg_restore` aborta y **la base queda como estaba**. El simulacro, tal como estaba, no comprobaba
   que la base restaurada fuera la de la copia: con un restore abortado el panel seguiría
   respondiendo con los datos vivos, la «pérdida» medida daría 0 y el simulacro se podía firmar
   como un verde mentiroso.
3. La guía decía «revisar los errores que muestre `pg_restore`», lo que sugiere que el restore
   sigue adelante; con `--single-transaction` no es así: el primer error aborta todo.

Remediación de esta pasada (sin migración: es procedimiento y tests):

- el restore aplica los permisos del dump (saca `--no-privileges`) y la guía dice por qué;
- la guía dice que el restore es atómico y qué hacer si aborta;
- paso nuevo: aplicar las migraciones pendientes sobre la base restaurada (la copia es de un día
  anterior y el panel de hoy puede usar columnas o RPC que la base restaurada no tiene);
- la verificación mira lo que el panel necesita para servir datos (`USAGE` de `authenticated` sobre
  `private`, lectura de `public.organizaciones` y `dominio.empresas`, `anon` sin lectura), no sólo el
  historial de copias;
- el simulacro comprueba, antes de medir, que la base restaurada es la de la copia (el último dato
  de la tabla testigo tiene que ser anterior al `iniciado_en` de la copia): si no, se detiene sin
  medir ni firmar.

Por qué se quitó `--no-privileges` (el assessment original lo descartaba): su motivo era que «el
destino puede no tener los roles/extensiones de Supabase» y que los `GRANT` fallarían «a medias». En
el simulacro el destino es la **misma** base de la que salió la copia (los roles y las extensiones ya
existen) y el riesgo real era el contrario: perder los `grant` explícitos del app y dejar el panel sin
poder leer la base restaurada. La guía exige que el destino tenga los roles del dump; si faltara
alguno, el restore aborta (es atómico) y no deja nada restaurado.

Lo que **no** se puede hacer desde el agente sigue igual: correr el simulacro sobre staging y
firmarlo (falta la autorización del propietario del producto).

## Open Questions

- [NEEDS CLARIFICATION: ¿quién autoriza, quién ejecuta y quién firma? El documento dice «dueño:
  propietario del producto»; falta nombre, fecha y ventana de downtime en staging.]
- [NEEDS CLARIFICATION: ¿staging tiene historial sano (filas `completado` en `public.respaldos` y
  `public.respaldos_imagenes`, y una verificación semanal `completado`)? No es verificable desde el
  repo.]
- [NEEDS CLARIFICATION: ¿staging tiene SMTP real configurado (`KESTRA_SMTP_*`, `SOPORTE_CORREO`)? Si
  no, el paso de correo queda pendiente y SC-002 no se puede cerrar por completo.]
- [NEEDS CLARIFICATION: ¿los objetivos 24 h/4 h se confirman con el cliente antes de firmar, o el
  simulacro sólo deja la medición? `docs/copias-y-restauracion.md:44-47` los deja como «propuesta a
  confirmar».]
- [NEEDS CLARIFICATION: ¿el simulacro es puntual (cierre de MSF-457) o debe repetirse con
  periodicidad? Si es periódico, hace falta responsable y recordatorio, no sólo el registro.]
- [NEEDS CLARIFICATION: ¿la restauración del simulacro se hace sobre el Postgres de staging (camino
  real) o primero sobre una base temporal, como sugiere `docs/tecnico/runbooks/db-restore.md:18`?]
- [NEEDS CLARIFICATION: el protocolo de esta pasada asume que el simulacro restaura sobre la **misma**
  base de staging (los roles y extensiones del dump ya existen y el restore no aborta). Si el
  propietario quiere restaurar sobre una base nueva, hay que garantizar antes los roles del dump o
  el restore aborta sin dejar nada restaurado.]
