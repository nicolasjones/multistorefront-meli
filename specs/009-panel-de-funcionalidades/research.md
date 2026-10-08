# Research: Panel de funcionalidades por organización

## 1. Forma del identificador del catálogo

**Decisión**: `features.id` es `text` (un slug legible, ej.
`'analitica-avanzada'`), con `check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$')` —
no `uuid`.

**Rationale**: a diferencia de `reportes.id` (uuid, porque un reporte lo
crea el superadmin en runtime desde una pantalla), una `feature` la crea
un desarrollador dentro de una migración (FR-001) — necesita un
identificador legible y predecible que el código pueda referenciar
directamente (`private.tiene_feature('mi-feature')`), sin un round-trip
para descubrir un uuid generado. El `check` de formato evita que
funcionalidades registradas por specs distintas terminen con estilos de
slug mezclados (`analiticaAvanzada` conviviendo con `reporte-pdf`).

**Alternativas consideradas**: `uuid` con `default gen_random_uuid()`
(rechazado — obligaría a cada feature futura a hardcodear un uuid opaco en
su propio código, o a resolverlo en runtime; ninguna ventaja real sobre un
slug legible acá).

## 2. Alta del catálogo: RPC llamada desde una migración, no una pantalla

**Decisión**: `registrar_feature` existe como RPC `security definer`
(mismo patrón que el resto de las mutaciones — nunca un `insert` directo,
ni siquiera desde una migración), pero no hay ningún formulario en la UI
que la invoque. Se llama exclusivamente desde la migración de la spec que
construye esa funcionalidad real.

**Rationale**: (FR-001, Clarifications) una funcionalidad de producto
siempre nace de un despliegue de código — a diferencia de un `reporte`
(autoría en Superset, fuera de este repo), no hay ningún escenario donde
alguien "tipeé" una funcionalidad nueva sin que exista código real
detrás. Dar de alta por UI invita a un slug que no coincide exactamente
con el que el código chequea (`private.tiene_feature('typo')`) — un
desacople silencioso que solo se detecta en producción.

**Alternativas consideradas**: pantalla de alta manual para el superadmin
(rechazada — ver Rationale); `insert` directo en la migración sin pasar
por la RPC (rechazado — rompe el patrón ya establecido de "toda mutación
dejaría auditoría vía RPC", y esta migración necesita `eventos_features`
igual que cualquier otra alta).

## 3. Sin capa de "planes" (bundles de funcionalidades)

**Decisión**: solo habilitación directa organización↔funcionalidad
(`organizaciones_features`). Sin `organizaciones.plan_id` ni
`planes_features` en esta spec.

**Rationale** (Clarifications, Principio V): un plan es, en esencia, un
conjunto de habilitaciones con nombre — modelarlo hoy sin un caso de
negocio real de precios o paquetes sería complejidad especulativa.
Agregar la capa de planes después es aditivo (una tabla nueva + una
función que resuelva "habilitaciones efectivas = directas ∪ las del
plan") sin tocar el esquema que esta spec entrega — no hay costo real por
diferirlo.

**Alternativas consideradas**: construir `planes`/`planes_features` ya
(rechazado explícitamente en la sesión de diseño — ver Clarifications).

## 4. Visibilidad del catálogo: no abierto a cualquier autenticado

**Decisión**: `features` tiene `select` restringido a
`is_superadmin() or private.tiene_feature(id)` — una organización sin
una funcionalidad habilitada no ve esa fila del catálogo en absoluto.

**Rationale** (FR-008, Clarifications): una primera versión de este
diseño dejaba `features` con `select` abierto a cualquier `authenticated`
("total, no tiene datos sensibles, solo nombre/descripción"). Revisando
el diseño contra el precedente de 007 (`reportes_select` restringido a
`puede_ver_reporte`, nunca el catálogo completo) se identificó que dejarlo
abierto filtraría a cualquier organización qué funcionalidades existen en
el sistema aunque no las tenga — información de producto (y, a futuro, de
paquetes comerciales) que no le corresponde ver. Se corrige reusando
`private.tiene_feature`, sin agregar ninguna tabla ni función nueva.

**Alternativas consideradas**: `select` abierto a cualquier
`authenticated` (rechazado, ver arriba); una función separada solo para
esta policy (rechazado — `tiene_feature` ya resuelve exactamente esta
pregunta, agregar otra sería duplicar lógica sin necesidad).

## 5. Integrar una herramienta externa de feature flags

**Decisión**: no se integra LaunchDarkly, Split, Unleash, Flagsmith, ni
similares. Se construye el mecanismo propio descrito acá.

**Rationale** (Clarifications): esas herramientas resuelven un problema
más grande (targeting por usuario individual, activaciones graduales,
experimentación A/B) del que hace falta para "organización tiene o no
tiene una funcionalidad, decidido por el superadmin". Además, la
autorización real de este producto vive en RLS de Postgres (Principio
I) — una policy no puede llamar a un SDK externo en tiempo real dentro de
una consulta SQL, así que de todas formas haría falta sincronizar el
resultado de esa herramienta hacia una tabla propia para que RLS pueda
usarlo, terminando por construir igual las tablas que esta spec ya
entrega, más un servicio adicional, más el mecanismo de sincronización.

**Alternativas consideradas**: Unleash self-hosteado (Apache 2.0,
coherente con la política de licencias del proyecto) — rechazado por el
motivo de arriba, no por la licencia; queda como opción real a evaluar si
el producto crece hacia targeting por usuario individual o
experimentación, no para el alcance de esta spec.

## 6. `puede_ver_feature_organizacion` como función separada de `tiene_feature`

**Decisión**: la policy de `select` de `organizaciones_features` usa
`private.puede_ver_feature_organizacion(feature_id, organizacion_id)`
(compara el `organizacion_id` de la fila evaluada), nunca
`private.tiene_feature(feature_id)` (resuelve "mi organización activa",
sin comparar contra una fila puntual).

**Rationale**: réplica deliberada de una lección ya aprendida en 007
(`data-model.md` de esa spec, "Corrección post-quickstart") — reusar ahí
una función pensada para "¿tengo acceso a esto en general?" para
autorizar una fila puntual de una tabla con una fila *por organización*
fue un bug de aislamiento multi-tenant real (una organización veía la
fila de otra). Se define la función separada desde el diseño, con el
comentario explícito en el SQL, para que ningún desarrollador futuro la
reemplace por `tiene_feature()` "por comodidad".

**Alternativas consideradas**: una sola función que reciba
`p_organizacion_id` como parámetro opcional y decida internamente
(rechazado — dos preguntas distintas ("¿tengo acceso en general?" vs.
"¿puedo ver ESTA fila?") merecen dos funciones con nombres que dejen clara
la diferencia, no una sola con comportamiento condicional oculto).

## 7. Sin tabla de roles-por-funcionalidad

**Decisión**: a diferencia de `reportes_roles_default`/
`reportes_organizaciones_roles`, no hay ninguna tabla de granularidad por
rol en este mecanismo. La habilitación es binaria a nivel organización.

**Rationale**: el alcance de esta spec (FR-002) es "el superadmin
habilita/deshabilita por organización" — no hay ningún requisito de "qué
roles internos de la organización ven la funcionalidad". Si una
funcionalidad futura concreta necesita esa granularidad, es
responsabilidad de sus propias tablas (mismo patrón que ya usa Analítica:
"asignada" y "visible por rol" son conceptos separados en dos tablas
distintas) — agregar una tabla de roles genérica acá sería modelar un
requisito que no existe todavía.

**Alternativas consideradas**: replicar `reportes_roles_default`/
`reportes_organizaciones_roles` de forma genérica (rechazado, ver
Rationale).

## 8. Alcance de testing

**Decisión**: pgTAP nuevo y obligatorio
(`supabase/tests/database/panel_de_funcionalidades.test.sql`) para RLS y
permisos de las RPCs — exigido por la constitución al tratarse de
aislamiento multi-tenant. Un test de Vitest para
`GrillaFeaturesPorOrganizacion.tsx` (la interacción de togglear una celda
dispara la RPC correcta) y para el estado vacío del catálogo (FR-013).
Sin test de Edge Function (no hay ninguna en esta spec).

**Rationale**: mismo criterio que 007 — el aislamiento real vive en
Postgres, así que ahí es donde el testing es obligatorio y de mayor
señal; los componentes de Refine con lógica propia (no solo mostrar
datos) llevan su test puntual de Vitest, igual que la grilla de permisos
de reportes.

## Referencia directa (patrón ya validado, no reinventado)

Toda decisión de esquema/RLS/RPC de este documento generaliza, sin
reinventar, el patrón ya implementado y probado en
`supabase/migrations/20260909140000_analitica_embebida.sql` — mismo
endurecimiento (`search_path = ''`, referencias completamente
calificadas, `revoke ... from public/anon/authenticated` + `grant`
puntual, idempotencia con `get diagnostics`).
