# Research: Mapeo de identificadores externos de clientes

No quedaron `NEEDS CLARIFICATION` en `plan.md` — el Technical Context se
resolvió directamente contra las convenciones ya existentes en este
repositorio. Este documento registra las decisiones de diseño que sí
requerían elegir entre alternativas.

## Decisión 1: patrón de escritura — RLS directo vs. funciones `SECURITY DEFINER`

**Decision**: la creación y eliminación de vínculos se hacen exclusivamente
a través de dos funciones `SECURITY DEFINER` en `public`
(`vincular_identificador_externo`, `desvincular_identificador_externo`). No
se otorga `insert`/`update`/`delete` a `authenticated` sobre la tabla. Las
policies de insert/delete quedan igual definidas (cinturón de seguridad),
como ya hace `conexiones` (spec 013), pero sin `grant` de tabla.

**Rationale**: en este template conviven dos patrones reales:
- `clientes` (spec 003, fundación): `insert`/`update` directos, con policy
  `with check (organizacion_id = private.organizacion_id() and
  private.puede_escribir())`. Funciona porque `clientes` tiene su propio
  `organizacion_id` y la única regla de negocio es "quién puede escribir",
  sin invariantes cross-fila.
- `conexiones` / `servidores_organizacion` (spec 013): sin `grant` de
  escritura directa, todo pasa por funciones (`crear_conexion`,
  `actualizar_credencial_conexion`, `aprovisionar_servidor_organizacion`).
  Se usa cuando la operación tiene una invariante o efecto colateral que
  una policy de RLS no puede expresar por sí sola (unicidad entre filas,
  normalización, un mensaje de error legible en vez de un código de
  constraint desnudo).

  Esta spec cae en el segundo caso: la invariante central (FR-002, un
  identificador no puede pertenecer a dos clientes) es un `unique` de
  base, pero además hace falta (a) resolver la organización dueña a partir
  de `cliente_id` — la tabla no tiene `organizacion_id` propio (ver
  Decisión 2) — antes de poder evaluarla en una policy, y (b) el
  comportamiento idempotente de FR-004 (re-vincular el mismo par al mismo
  cliente no es un error), que un `insert` con `on conflict` ya resuelve
  mejor dentro de una función que repetido en un `with check` de policy. Una
  función también deja el error de "identificador ya usado por otro
  cliente" (FR-010) con un mensaje explícito en vez de depender de que el
  cliente interprete el código `23505` crudo del `unique`.

**Alternatives considered**:
- *RLS directo (como `clientes`)*: se descartó porque la policy de insert
  necesitaría un subquery a `clientes` para resolver `organizacion_id` en
  cada fila de todos modos (no hay forma de evitarlo, dado que la tabla no
  duplica esa columna — ver Decisión 2), y el comportamiento idempotente de
  FR-004 quedaría repartido entre la policy y un `on conflict` en el
  `insert` del cliente que la llama, en vez de vivir en un solo lugar.
- *Duplicar `organizacion_id` en la tabla nueva*: permitiría una policy de
  insert simple, pero introduce una columna que puede desincronizarse del
  `organizacion_id` real del cliente si este alguna vez cambiara de
  organización (no ocurre hoy, pero es una invariante extra a mantener sin
  necesidad) — se descartó, ver Decisión 2.

## Decisión 2: `organizacion_id` propio vs. resuelto vía `clientes`

**Decision**: la tabla nueva NO tiene columna `organizacion_id` propia. La
organización se resuelve siempre haciendo join/subquery a
`clientes.organizacion_id` a partir de `cliente_id`.

**Rationale**: `organizacion_id` en `clientes` es la fuente de verdad única
de a qué organización pertenece un cliente. Duplicarlo en cada tabla que
cuelga de `clientes` (como hace `conexiones`, que sí tiene su propio
`organizacion_id` porque no cuelga de `clientes` sino directamente de
`organizaciones`) sería redundante y abriría la posibilidad de que una fila
de esta tabla apunte a una organización distinta a la del cliente al que
está vinculada. Resolver siempre vía `cliente_id` hace esa inconsistencia
imposible por construcción.

**Alternatives considered**: agregar `organizacion_id` como columna
denormalizada con un trigger que la mantenga sincronizada — rechazado por
complejidad innecesaria (Principio V) para un caso que no lo requiere: no
existe hoy ninguna operación que cambie la organización de un cliente ya
creado.

## Decisión 3: catálogo de `sistema`

**Decision**: `sistema` es `text` libre con un `check` de no-vacío
(`btrim(sistema) <> ''`), sin catálogo ni enum.

**Rationale**: no existe hoy en este repositorio un catálogo de sistemas
externos (se verificó la rama `nicolasjones/catalogo-sistemas-externos`:
sin commits propios al momento de este plan). La spec y la constitución
piden no bloquear esta pieza esperando esa otra spec, y no nombrar ningún
sistema puntual. Si el catálogo llega a existir, migrar `sistema` de `text`
a una FK es un cambio aditivo compatible (agregar la FK con la constraint
`not valid` + `validate constraint`, o una migración de reemplazo en una
spec futura) — no bloquea el valor de esta spec hoy.

**Alternatives considered**: `check (sistema in (...))` con una lista fija
— rechazado explícitamente por el pedido original (evita codificar un
catálogo cerrado en esta pieza genérica).
