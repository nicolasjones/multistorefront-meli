# Feature Specification: Mapeo de identificadores externos de clientes

**Feature Branch**: `nicolasjones/mapeo-identificadores-clientes`

**Created**: 2026-09-30

**Status**: Draft

**Delivery scope**: supabase. No toca `refine`, `kestra`, `superset` ni `workers`, ni contiene lógica de negocio de ningún producto derivado ni de ningún sistema externo puntual.

**Input**: User description: "Agregar un mecanismo genérico de mapeo entre
`clientes` (tabla de plataforma, fundación multitenant) y un identificador
externo de cualquier sistema/integración que un producto derivado le
conecte."

**Origen**: en productos derivados de este template, varias tablas de negocio
propias necesitan correlacionar una fila de `clientes` con la identidad que
ese mismo cliente tiene en un sistema externo (por ejemplo, un ERP o una
plataforma de facturación conectada vía integración). Sin una pieza de
plataforma para esto, cada producto derivado termina guardando esa
correlación como texto libre, sin garantía de que el identificador no se
duplique entre clientes distintos. Esa lógica de negocio puntual no es parte
de esta spec: acá solo se agrega la tabla y las funciones genéricas de
mapeo, reutilizables por cualquier integración futura.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Vincular un identificador externo a un cliente (Priority: P1)

Un administrador de una organización (o el proceso de integración que actúa
en su nombre) vincula el identificador que un cliente tiene en un sistema
externo con la fila de `clientes` correspondiente, para que de ahí en más
cualquier dato entrante de ese sistema pueda resolverse al cliente correcto.

**Why this priority**: sin esta vinculación no existe ninguna forma confiable
de correlacionar datos externos con clientes; es el valor mínimo de toda la
spec.

**Independent Test**: puede probarse por completo vinculando un identificador
de un sistema cualquiera a un cliente existente y verificando que el vínculo
queda creado y es consultable, sin depender de las otras historias.

**Acceptance Scenarios**:

1. **Given** un cliente existente de la organización del usuario y un
   identificador de un sistema que todavía no está vinculado a ningún
   cliente, **When** el usuario vincula ese identificador al cliente,
   **Then** el vínculo queda creado y disponible para consulta.
2. **Given** un identificador de un sistema que ya está vinculado a otro
   cliente, **When** el usuario intenta vincularlo a un cliente distinto,
   **Then** la operación se rechaza con un error identificable y el vínculo
   original no se modifica.
3. **Given** un cliente que pertenece a otra organización, **When** el
   usuario intenta vincularle un identificador externo, **Then** la
   operación se rechaza.

---

### User Story 2 - Resolver el cliente a partir de un identificador externo, o los identificadores de un cliente (Priority: P2)

Dado un identificador externo y su sistema de origen, resolver a qué cliente
corresponde; o, dado un cliente, listar todos sus identificadores externos
vinculados (de uno o varios sistemas).

**Why this priority**: es la razón de ser del mapeo — sin poder consultarlo
en ambos sentidos, vincular no tiene utilidad práctica.

**Independent Test**: puede probarse por completo creando vínculos de la
Historia 1 y luego consultándolos en ambos sentidos (por cliente y por
identificador), sin necesidad de la Historia 3.

**Acceptance Scenarios**:

1. **Given** un cliente con uno o más identificadores externos vinculados,
   **When** se consultan sus vínculos, **Then** se listan todos, incluyendo
   los de distintos sistemas si los tiene.
2. **Given** un identificador externo vinculado a un cliente de la
   organización del usuario, **When** se busca por ese sistema e
   identificador, **Then** se obtiene el cliente correspondiente.
3. **Given** un cliente o vínculo que pertenece a otra organización,
   **When** un usuario de una organización distinta intenta consultarlo,
   **Then** no se devuelve ningún resultado.

---

### User Story 3 - Desvincular un identificador externo (Priority: P3)

Un administrador elimina un vínculo creado por error o que dejó de ser
válido (por ejemplo, el cliente cambió de identidad en el sistema externo),
sin afectar el resto de los vínculos del cliente.

**Why this priority**: corrige errores operativos; no bloquea el valor
principal de vincular y consultar, pero evita que un error de carga quede
irreversible.

**Independent Test**: puede probarse por completo creando un vínculo con la
Historia 1, eliminándolo, y verificando que ya no aparece en las consultas de
la Historia 2 y que el identificador vuelve a estar disponible para
vincularse a cualquier cliente.

**Acceptance Scenarios**:

1. **Given** un vínculo existente de un cliente de la organización del
   usuario, **When** el usuario lo elimina, **Then** el vínculo deja de
   existir y el identificador queda libre para vincularse a otro cliente.
2. **Given** un vínculo de un cliente de otra organización, **When** un
   usuario de una organización distinta intenta eliminarlo, **Then** la
   operación se rechaza.

---

### Edge Cases

- ¿Qué pasa si se intenta vincular al mismo cliente el mismo identificador
  del mismo sistema dos veces? No debe crear un segundo vínculo duplicado ni
  fallar de forma confusa: la segunda vinculación es un no-op sobre el
  vínculo ya existente.
- ¿Qué pasa si se elimina el cliente? Todos sus identificadores externos
  vinculados se eliminan junto con él, sin dejar vínculos huérfanos.
- ¿Qué pasa si el sistema o el identificador externo llegan vacíos o solo
  espacios en blanco? La operación se rechaza: un vínculo sin sistema o sin
  identificador no tiene sentido.
- ¿Qué pasa si dos vinculaciones concurrentes intentan asignar el mismo
  identificador a dos clientes distintos al mismo tiempo? Solo una debe
  tener éxito; la otra debe fallar de forma consistente, sin dejar el
  identificador asociado a ambos clientes ni a ninguno de forma parcial.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema MUST permitir vincular un cliente existente con un
  identificador externo, identificado por el nombre del sistema de origen y
  el valor del identificador dentro de ese sistema.
- **FR-002**: El sistema MUST impedir que el mismo par (sistema,
  identificador externo) quede vinculado a más de un cliente, incluso bajo
  operaciones concurrentes.
- **FR-003**: El sistema MUST permitir que un mismo cliente tenga vinculados
  múltiples identificadores externos, del mismo sistema o de sistemas
  distintos.
- **FR-004**: El sistema MUST tratar la re-vinculación del mismo identificador
  al mismo cliente que ya lo tiene vinculado como una operación sin efecto
  (no crea un vínculo duplicado ni la rechaza como conflicto).
- **FR-005**: El sistema MUST permitir consultar, dado un cliente, todos sus
  identificadores externos vinculados.
- **FR-006**: El sistema MUST permitir resolver, dado un sistema y un
  identificador externo, el cliente vinculado (si existe alguno).
- **FR-007**: El sistema MUST permitir eliminar un vínculo existente,
  liberando el identificador para que pueda vincularse a otro cliente.
- **FR-008**: El sistema MUST restringir la lectura de los vínculos a los
  miembros de la organización dueña del cliente correspondiente (incluido un
  superadmin con esa organización activa), con el mismo criterio de
  aislamiento que el resto de las tablas de negocio de esta plataforma.
- **FR-009**: El sistema MUST restringir la creación y la eliminación de
  vínculos a quienes tienen permiso de escritura sobre la organización dueña
  del cliente, validado en el mismo punto de control que resuelve la
  operación (no solo en una interfaz).
- **FR-010**: El sistema MUST eliminar automáticamente los identificadores
  externos vinculados a un cliente cuando ese cliente se elimina.
- **FR-011**: El sistema MUST rechazar un intento de vinculación que no
  incluya un sistema o un identificador externo con contenido (vacío o solo
  espacios en blanco no es válido).
- **FR-012**: El sistema MUST identificar el sistema de origen mediante texto
  libre, sin restringirlo a un catálogo cerrado, dado que hoy esta
  plataforma no tiene un catálogo de sistemas externos.

### Key Entities *(include if feature involves data)*

- **Identificador externo de cliente**: vínculo entre un cliente de la
  plataforma y su identidad en un sistema externo. Atributos: el cliente al
  que pertenece, el nombre del sistema de origen y el valor del
  identificador dentro de ese sistema. Un cliente puede tener varios; un par
  (sistema, identificador) pertenece a lo sumo a un cliente.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Vincular un identificador externo a un cliente y consultarlo de
  vuelta (por cliente o por identificador) no requiere pasos adicionales más
  allá de la vinculación misma.
- **SC-002**: En cualquier secuencia de operaciones, incluidas las
  concurrentes, ningún identificador externo termina vinculado a más de un
  cliente a la vez.
- **SC-003**: Ningún miembro de una organización puede ver, crear ni eliminar
  vínculos de clientes que pertenecen a otra organización, verificado sin
  depender de la interfaz que los consuma.
- **SC-004**: Eliminar un cliente no deja ningún identificador externo
  huérfano asociado a un cliente inexistente.

## Assumptions

- El "sistema" de origen se guarda como texto libre porque hoy no existe un
  catálogo de sistemas externos en esta plataforma. Si en el futuro existe
  uno (hay una spec en curso, `catalogo-sistemas-externos`, para esto), esta
  tabla podría migrar a referenciarlo por clave foránea en una spec
  posterior; esta spec no depende de esa decisión ni la bloquea.
- La lógica de negocio que decide cuándo y con qué valor crear o eliminar
  estos vínculos (por ejemplo, durante la sincronización con un sistema
  externo puntual, o desde una pantalla de un producto derivado) es
  responsabilidad de cada producto derivado y queda fuera de esta spec.
- La creación y eliminación de vínculos se resuelven mediante funciones
  controladas de la base de datos (no mediante INSERT/UPDATE/DELETE directo
  del cliente sobre la tabla), siguiendo el mismo patrón que ya usan otras
  tablas de negocio equivalentes de esta plataforma para centralizar la
  validación de pertenencia organizacional y dar un error identificable en
  caso de conflicto. La lectura, en cambio, se resuelve con una política de
  RLS de solo lectura, igual que el resto de las tablas de esta plataforma.
- No hay interfaz de usuario en el alcance de esta spec (delivery scope:
  `supabase`). Una pantalla en Refine para gestionar estos vínculos a mano
  queda fuera de alcance; sería una spec futura si algún producto derivado
  la necesita.
