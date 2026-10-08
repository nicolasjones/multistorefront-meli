# Research: Contexto de organización activa del superadmin

## Ocultar del menú vs. solo redirigir al llegar

- **Decision**: ocultar el recurso del menú (`accessControlProvider`) y,
  además, redirigir si igual se llega por URL directa.
- **Rationale**: la spec (FR-001, US1) pide explícitamente que la pantalla
  no aparezca listada, no solo que rechace el acceso al entrar — mismo
  criterio que ya se usó en la spec 003 (T030) para ocultar
  "Organizaciones" a quien no es superadmin. El redirect es una defensa
  adicional para quien llega por bookmark o URL escrita a mano, no
  reemplaza el ocultamiento.
- **Alternatives considered**: solo redirect, sin tocar el menú —
  descartado, no resolvería el problema reportado (el ítem "Clientes"
  seguiría apareciéndole a un superadmin sin organización activa).

## Cómo marcar qué recursos "dependen de organización", sin hardcodear cada uno

- **Decision**: una lista simple de nombres de recurso (por ejemplo,
  `RECURSOS_DEPENDIENTES_DE_ORGANIZACION = ['clientes']`) exportada junto
  al `accessControlProvider`, consultada por su lógica de `can`. Sumar un
  recurso nuevo a esta categoría (la futura pantalla de miembros) es
  agregar un string a esa lista, sin tocar la lógica del provider.
- **Rationale**: mantiene la solución genérica (así lo pide la Assumption
  de la spec) sin depender de que la versión de `@refinedev/core` en uso
  exponga metadata del recurso de forma confiable dentro de
  `accessControlProvider.can` — una lista explícita es más simple de leer
  y de testear que depender de esa metadata.
- **Alternatives considered**: marcar el recurso vía `meta` en el array
  `resources` de `App.tsx` (ej. `meta: { requiereOrganizacionActiva: true }`)
  y leerlo desde `can` — más "declarativo", pero depende de que Refine
  pase el resource completo (no solo el nombre) al provider; se descarta
  por ahora para no atar el diseño a un detalle de la versión instalada.

## Extender `entrar_a_organizacion` para auditar la salida automática

- **Decision**: la misma función audita, en una sola transacción, la
  salida de la organización previa (si había una) y la entrada a la
  nueva — no un trigger separado sobre `superadmin_organizacion_activa`.
- **Rationale**: la función ya hace el upsert de la fila activa; agregar
  ahí mismo el registro de auditoría evita una condición de carrera entre
  dos mecanismos independientes y mantiene toda la lógica de "cambio de
  contexto" en un solo lugar legible (mismo lugar que ya audita la
  entrada desde la spec 003, FR-013).
- **Alternatives considered**: un trigger `AFTER UPDATE` sobre
  `superadmin_organizacion_activa` que detecte el cambio de
  `organizacion_id` y loguee la salida — descartado, agrega una capa de
  indirección (trigger) para algo que la función ya puede hacer de forma
  explícita, y dificulta leer en un solo lugar todo lo que hace "entrar a
  una organización".

## Una columna `accion` en `superadmin_entradas`, no una tabla paralela

- **Decision**: `ALTER TABLE superadmin_entradas ADD COLUMN accion text
  CHECK (accion IN ('entrada', 'salida'))`, en vez de una tabla
  `superadmin_salidas` separada.
- **Rationale**: ya resuelto explícitamente en la spec (FR-006: "no en
  una tabla separada") — permite reconstruir la línea de tiempo completa
  de un superadmin con una sola consulta ordenada por fecha, sin joins.
  Es una migración aditiva (columna nueva con default), consistente con
  la regla de migraciones reversibles de la constitución.
- **Alternatives considered**: tabla separada — descartada por la propia
  spec.

## Guard de redirect como componente reutilizable, no repetido por página

- **Decision**: un único componente/hook (`useOrganizacionActiva` +
  wrapper de ruta) que envuelve cualquier ruta dependiente de
  organización, en vez de repetir el chequeo dentro de cada página
  (`clientes/list.tsx`, y mañana `miembros/list.tsx`).
- **Rationale**: mismo criterio que la lista de recursos del
  `accessControlProvider` — la solución tiene que escalar a la próxima
  pantalla dependiente de organización sin duplicar lógica.
- **Alternatives considered**: chequear dentro de cada página — descartado,
  no escala y contradice el objetivo explícito de la Assumption de la
  spec (que sumar `miembros` no requiera repetir esta lógica desde cero).

## `clock_timestamp()`, no `now()`, para los dos inserts de auditoría al cambiar de organización

- **Decision**: los dos `insert` que agrega esta spec en
  `entrar_a_organizacion` (salida de la organización anterior, entrada a
  la nueva) usan `clock_timestamp()` para `entrado_en`, no `now()`.
- **Rationale**: `now()` en Postgres devuelve el inicio de la transacción
  actual, no el reloj real — dentro de una misma función (una sola
  transacción implícita), dos llamadas a `now()` devuelven el mismo
  valor. Con ambos inserts en la misma transacción (decisión de más
  arriba), usar `now()` dejaría las filas de salida y entrada con
  `entrado_en` idéntico, rompiendo cualquier verificación que dependa de
  ordenarlas por fecha (FR-007, SC-004). `clock_timestamp()` sí avanza
  entre sentencias dentro de la misma transacción.
- **Alternatives considered**: mantener `now()` y ordenar por `id`
  (columna identity, que sí refleja el orden de inserción) en vez de por
  `entrado_en` — descartado como única solución porque además de ser más
  frágil para quien lea la tabla directamente (dos filas con timestamps
  idénticos son confusas de leer), no hay ninguna razón para no usar la
  función correcta (`clock_timestamp()`) cuando el propio caso de uso es
  justamente necesitar dos momentos distintos.
