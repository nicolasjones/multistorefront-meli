# Feature Specification: Catálogo real para sistema_externo en conexiones

**Feature Branch**: `nicolasjones/catalogo-sistemas-externos`

**Created**: 2026-09-30

**Status**: Draft

**Delivery scope**: supabase (migración aditiva sobre `conexiones`, spec 013).
No toca `refine`, `kestra`, `superset` ni `workers`, ni contiene lógica de
negocio de ningún producto derivado.

**Input**: User description: "Agregar un catálogo real para sistema_externo en
la tabla conexiones (spec 013, orquestación multi-organización), reemplazando
el text libre sin check actual por una foreign key a una tabla catálogo nueva,
siguiendo el mismo patrón ya usado en roles_organizacion (catálogo con id text
primary key + descripcion text not null, 'agregar un valor es una fila nueva,
no un check fijo'). Alcance: plataforma pura, sin lógica de negocio de ningún
producto derivado — la tabla catálogo se crea vacía, sin cargar ningún sistema
externo real; cada producto derivado carga sus propios valores en su propia
migración. La migración debe ser aditiva con camino de reversión documentado,
y debe poder aplicarse aunque conexiones.sistema_externo ya tenga datos."

**Origen**: `conexiones.sistema_externo` (spec 013,
`20260914150000_orquestacion_multi_organizacion.sql`) es `text not null` sin
catálogo ni `check`: cualquier string pasa, incluido un typo, y no hay forma
de listar "qué sistemas externos existen" desde el esquema. El patrón correcto
ya existe en este mismo repo para un caso análogo: `roles_organizacion`
(`20260908172920_fundacion_multitenant.sql`), una tabla catálogo real donde
"agregar un rol es una fila nueva, no un check fijo". Esta spec traslada ese
patrón a `sistema_externo`, sin tocar los flujos de negocio: solo el esquema
de plataforma.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Integridad referencial de sistema_externo (Priority: P1)

Como plataforma, `conexiones.sistema_externo` solo debe poder apuntar a un
valor que exista en un catálogo controlado, igual que `usuarios_organizacion.rol_id`
ya solo apunta a un valor de `roles_organizacion`. Hoy `crear_conexion` inserta
cualquier texto sin validar contra nada.

**Why this priority**: es el corazón del pedido — sin esto, agregar la tabla
catálogo no cambia el comportamiento real de `conexiones`.

**Independent Test**: en una base con el catálogo vacío (estado de este
template), intentar `select public.crear_conexion(org_id, 'valor-inexistente',
'credencial')` debe fallar por violación de foreign key. Insertar primero una
fila en la tabla catálogo y volver a intentar con ese `id` debe funcionar
igual que antes.

**Acceptance Scenarios**:

1. **Given** la tabla catálogo de sistemas externos está vacía (estado de
   este template, sin datos de negocio), **When** se llama a
   `crear_conexion` con cualquier `sistema_externo`, **Then** la inserción
   falla por violación de foreign key (comportamiento correcto: no hay
   ningún sistema externo dado de alta todavía en la plataforma).
2. **Given** existe una fila en la tabla catálogo con `id = 'demo'`, **When**
   se llama a `crear_conexion` con `sistema_externo = 'demo'`, **Then** la
   conexión se crea igual que antes de esta spec.
3. **Given** cualquier autenticado, **When** consulta la tabla catálogo,
   **Then** puede leerla (mismo criterio de solo-lectura que
   `roles_organizacion`), pero no puede insertar, actualizar ni borrar filas
   (alta de valores queda fuera de alcance de esta spec — ver Assumptions).

---

### User Story 2 - Migración aplicable sin datos de negocio previos (Priority: P2)

Como agente que corre esta migración sobre el template (que no tiene datos de
negocio) o sobre un fork que ya tuviera filas en `conexiones` con valores de
`sistema_externo` fuera del catálogo nuevo (vacío en el momento de esta
migración), la migración debe poder aplicarse igual sin fallar.

**Why this priority**: sin esto la migración es un camino de un solo sentido
que rompe cualquier entorno con datos — que no es el caso de este template
hoy, pero sí puede serlo en un fork.

**Independent Test**: aplicar la migración sobre una base con filas
preexistentes en `conexiones` cuyo `sistema_externo` no tiene fila
correspondiente en el catálogo nuevo (vacío) debe completar sin error,
dejando esas filas con un valor que no resuelve contra el catálogo hasta que
alguien cargue el catálogo y corrija esos datos en una migración posterior
(de negocio, fuera de esta spec).

**Acceptance Scenarios**:

1. **Given** `conexiones` tiene cero filas (estado real de este template),
   **When** se aplica la migración, **Then** se completa sin error y agrega
   la foreign key con `not valid` o equivalente que no re-valide datos
   inexistentes de forma bloqueante.
2. **Given** un fork hipotético con filas preexistentes en `conexiones` cuyo
   `sistema_externo` no existe en el catálogo (vacío al momento de esta
   migración), **When** se aplica la migración, **Then** se completa sin
   error — la fila queda con una referencia que no resuelve contra el
   catálogo hasta que ese fork cargue su catálogo y repare esos datos en su
   propia migración de negocio.

---

### User Story 3 - Reversión documentada sin destruir en el mismo PR (Priority: P3)

Como agente que revisa esta spec, quiero un camino de reversión explícito
para la foreign key y la tabla catálogo nueva, documentado en el plan, sin
que esta migración destruya ninguna columna o tabla existente (constitución,
Technology and Quality Gates).

**Why this priority**: gate de la constitución, no negociable, pero no cambia
el comportamiento funcional del día a día — por eso es P3.

**Independent Test**: revisar que `plan.md` documente el DOWN explícito (drop
de la foreign key, de la tabla catálogo y del índice si aplica) como texto,
sin que la migración en sí ejecute ningún `drop column` ni `drop table` sobre
objetos preexistentes.

**Acceptance Scenarios**:

1. **Given** el plan de esta spec, **When** se revisa su sección de
   reversión, **Then** describe los `ALTER TABLE ... DROP CONSTRAINT` y
   `DROP TABLE` necesarios para deshacer esta spec puntual, sin mencionar
   ningún `DROP COLUMN` sobre `conexiones.sistema_externo` (la columna se
   conserva; solo cambia su constraint).

---

### Edge Cases

- ¿Qué pasa si dos migraciones de un mismo fork insertan el mismo `id` en la
  tabla catálogo? Queda fuera de alcance de esta spec (cada fork gestiona sus
  propios valores y sus propios conflictos de datos).
- ¿Qué pasa con `excepciones_flow_generico.conector_id`, que también
  referencia conceptualmente un sistema externo? Queda fuera de alcance: la
  spec original (013) nunca lo relacionó con `sistema_externo` vía esquema, y
  esta spec no expande ese alcance.
- ¿Qué pasa si `conexiones` en este template ya tuviera datos con un
  `sistema_externo` que no matchea ningún `id` del catálogo (vacío)? Ver
  User Story 2 — la migración se aplica igual; la reparación de esos datos es
  responsabilidad de cada fork, no de esta spec.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: La plataforma MUST exponer una tabla catálogo de sistemas
  externos con el mismo patrón que `roles_organizacion`: `id text primary
  key`, `descripcion text not null`, comentario de tabla explicando que
  agregar un valor es una fila nueva, no un check fijo.
- **FR-002**: La tabla catálogo MUST crearse vacía — esta migración no MUST
  insertar ningún valor de negocio (ni nombres de sistemas externos reales).
- **FR-003**: `conexiones.sistema_externo` MUST quedar referenciada por
  foreign key a la tabla catálogo nueva, conservando su tipo (`text`) y su
  restricción `not null` actuales.
- **FR-004**: La tabla catálogo MUST tener RLS habilitado y una policy de
  `select` para cualquier autenticado, igual que `roles_organizacion`. Esta
  spec no agrega policies de escritura (alta de valores queda fuera de
  alcance — ver Assumptions).
- **FR-005**: La migración MUST poder aplicarse sin error sobre una base
  donde `conexiones` ya tuviera filas cuyo `sistema_externo` no exista en el
  catálogo nuevo (vacío en el momento de esta migración), sin borrar ni
  modificar esas filas.
- **FR-006**: La migración MUST ser aditiva: no MUST eliminar la columna
  `conexiones.sistema_externo` ni ninguna tabla existente. El plan MUST
  documentar el camino de reversión explícito (constitución, Technology and
  Quality Gates).
- **FR-007**: Los GRANT sobre la tabla catálogo nueva MUST declararse
  explícitos para `authenticated` (el proyecto tiene `auto_expose_new_tables
  = false`), igual que el resto de tablas de esta plataforma.
- **FR-008**: Esta spec MUST dejar documentado en `specs/`, `docs/` o la
  constitución (según corresponda) que cargar valores reales en la tabla
  catálogo es responsabilidad de cada producto derivado, en su propia
  migración — no de este template (regla ya existente de CLAUDE.md sobre
  capacidades sin caso de uso de negocio).

### Key Entities

- **sistema_externo (catálogo nuevo)**: fila = un sistema externo dado de
  alta en la plataforma para conectar organizaciones. `id` (slug estable,
  usado como FK), `descripcion` (texto libre). Vacía en este template; cada
  producto derivado carga sus propios valores.
- **conexiones (existente, spec 013)**: sin cambio de forma — su columna
  `sistema_externo` pasa de texto libre a texto con integridad referencial
  contra el catálogo nuevo.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un intento de crear una conexión con un `sistema_externo` que
  no existe en el catálogo falla de forma determinística (violación de
  integridad referencial), en el 100% de los casos, sin depender de
  validación en capas superiores.
- **SC-002**: La migración se aplica sin error tanto sobre una base vacía de
  `conexiones` (estado real de este template) como sobre una base con filas
  preexistentes cuyo `sistema_externo` no resuelve contra el catálogo vacío.
- **SC-003**: Ningún objeto existente (columna, tabla) se destruye como parte
  de esta migración; el camino de reversión queda documentado por escrito en
  el plan antes de implementar.
- **SC-004**: Cero valores de negocio (nombres de sistemas externos reales)
  quedan cargados en el template al cerrar esta spec.

## Assumptions

- La foreign key se agrega con una validación que no bloquea la migración si
  ya hay datos que no resuelven contra el catálogo (p.ej. `not valid` o un
  paso previo que tolere huérfanos) — el diseño exacto (`NOT VALID` +
  `VALIDATE CONSTRAINT` diferido, o una FK validada de entrada dado que este
  template no tiene datos hoy) se decide en `plan.md`, no en esta spec.
- El alta, edición y baja de valores del catálogo (RPC o pantalla de Refine
  para gestionar sistemas externos) queda fuera de alcance de esta spec —
  mismo criterio que `roles_organizacion`, que tampoco tiene pantalla de
  gestión propia en este template. Cada producto derivado que necesite una
  pantalla de alta la construye en su propio fork, con su propia lógica de
  negocio.
- `excepciones_flow_generico.conector_id` no se toca: no tiene FK a
  `sistema_externo` hoy y esta spec no le agrega una.
- Esta spec no requiere cambios en `apps/web` ni en `workers/`: es
  exclusivamente esquema de `supabase/migrations`.
