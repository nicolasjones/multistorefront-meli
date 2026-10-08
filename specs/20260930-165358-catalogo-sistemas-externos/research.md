# Research: Catálogo real para sistema_externo en conexiones

Esta spec no tenía marcadores `[NEEDS CLARIFICATION]` en `spec.md` (checklist
de calidad en verde). Las decisiones de diseño que sí requerían investigar el
código real de este repo (instrucción explícita de la tarea: "fijate primero
en las migraciones de este repo... no asumas") se resuelven acá.

## R1: Forma exacta del catálogo existente a replicar

**Decision**: replicar `roles_organizacion` tal cual — `id text primary
key`, `descripcion text not null`, sin más columnas, con un `comment on
table` explicando "agregar un valor es una fila nueva, no un check fijo".

**Rationale**: es el patrón que la propia tarea señala como ya correcto en
este repo (`supabase/migrations/20260908172920_fundacion_multitenant.sql`,
líneas 13-19). Confirmado leyendo el archivo real, no asumido.

**Alternatives considered**:
- Agregar columnas extra (p.ej. `activo boolean`, `orden integer`): rechazado
  — no hay requisito de negocio para eso todavía (regla de CLAUDE.md: "una
  extensión... sin un caso de uso de negocio todavía... no necesita spec";
  acá directamente no hace falta la columna). `roles_organizacion` tampoco
  las tiene.
- Enum de Postgres en vez de tabla: rechazado por la razón que ya documenta
  el comentario de `roles_organizacion` — un catálogo-tabla permite agregar
  un valor con una fila, no con un `ALTER TYPE` que en Postgres no es
  transaccional-seguro de la misma forma y requiere migración de esquema.

## R2: Cómo agregar la FK sin romper si `conexiones` ya tiene datos

**Decision**: `alter table conexiones add constraint
conexiones_sistema_externo_fkey foreign key (sistema_externo) references
sistemas_externos (id) not valid;` — sin `validate constraint` en la misma
migración.

**Rationale**: `NOT VALID` hace que Postgres no escanee las filas existentes
al crear la constraint (no bloquea ni falla si hay datos huérfanos), pero sí
la aplica a partir de ahí para todo `insert`/`update` nuevo (Postgres docs:
una FK `NOT VALID` se comporta como una FK normal para filas nuevas). Esto
satisface FR-005/FR-006 de la spec: la migración no puede fallar por datos
que no controla (relevante para forks que ya tengan filas reales en
`conexiones`, no para este template — verificado: `conexiones` no tiene
ninguna carga de datos en ninguna migración de este repo, está vacía).
`validate constraint` queda deliberadamente fuera de esta migración: cada
fork decide cuándo correrlo, después de cargar su catálogo y reparar datos
huérfanos si los tuviera.

**Alternatives considered**:
- FK validada de entrada (sin `not valid`): funcionaría igual de bien en
  *este* template (0 filas en `conexiones` hoy), pero rompería la migración
  al aplicarse sobre cualquier fork con datos reales que no resuelvan contra
  el catálogo todavía vacío — viola FR-005 explícitamente.
- `check` con subquery en vez de FK: Postgres no permite `check` con
  subqueries contra otra tabla (no es una expresión inmutable) — no es una
  opción real.
- Trigger de validación en vez de FK: más código, mismo resultado que una FK
  nativa; rechazado por simplicidad operativa (Principio V) — la FK es la
  herramienta nativa para esto, ya usada en todo el resto del esquema
  (`usuarios_organizacion.rol_id → roles_organizacion.id`).

## R3: Impacto en los tests pgTAP existentes

**Decision**: actualizar los fixtures de los 5 archivos que insertan
`conexiones` con un `sistema_externo` de prueba, agregando la fila de
catálogo correspondiente antes de esa inserción (ver lista en `plan.md`,
Project Structure).

**Rationale**: confirmado por búsqueda (`grep sistema_externo
supabase/tests/database/*.sql`) que 5 archivos insertan filas en
`conexiones` directo por SQL (no vía `crear_conexion`), y 2 más llaman a
`crear_conexion` con un `sistema_externo` de prueba
(`orquestacion_multi_organizacion.test.sql`). Aunque la FK es `NOT VALID`,
sigue aplicando a toda fila nueva — y estos tests corren sobre una base
recién migrada (catálogo vacío), así que sin el fixture nuevo, esas
inserciones pasarían a fallar por violación de integridad referencial
(`23503`). El precedente de este mismo repo para catálogos similares
(`analitica_embebida.test.sql` inserta una fila en `roles_organizacion`
como fixture, línea 35) confirma que insertar filas de catálogo dentro de un
test pgTAP es el patrón esperado, no un desvío.

**Alternatives considered**:
- Cargar un catálogo con valores fijos de prueba en la migración misma:
  rechazado — violaría FR-002 (migración vacía, sin valores de negocio ni de
  prueba cargados en `supabase/migrations`). Los fixtures de test son datos
  de test, viven en `supabase/tests/`, no en la migración.
- Dejar la FK fuera del alcance de los inserts directos (solo aplicarla a
  `crear_conexion`): no es posible — una FK de columna aplica a toda
  escritura sobre esa columna sin importar el camino (RPC o INSERT directo);
  tampoco sería consistente con el objetivo de la spec (integridad real).
