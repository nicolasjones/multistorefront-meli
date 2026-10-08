# Feature Specification: Fundación multi-tenant

**Feature Branch**: `003-fundacion-multitenant`

**Created**: 2026-09-07

**Status**: Implemented

**Input**: User description: "spec 1" — referido en la conversación como la
"Fundación multi-tenant": organizaciones, usuarios_organizacion, la función
helper de RLS, el test de aislamiento real, y las pantallas de Refine para
operar dentro de la propia organización. Es la primera funcionalidad real
que se construye sobre `automation-platform-template` (spec 002):
`organizaciones` = el tenant genérico, `clientes` = a quién le presta
servicio la organización. Hay 3 perfiles desde el arranque: superadmin
(plataforma completa, no pertenece a ninguna organización), administrador
de organización, y miembro. El superadmin tiene una pantalla propia en
Refine para crear organizaciones y ver el listado completo, y puede entrar
a una organización puntual para operarla como si fuera su administrador
(una organización a la vez, nunca varias mezcladas) — esto reemplaza a lo
que antes se pensaba como una spec separada de "Consola de superadmin".

**Delivery scope**: supabase | refine

## Clarifications

### Session 2026-09-08

- Q: ¿Un usuario con perfil administrador o miembro puede pertenecer a más de una organización, o siempre a una sola? → A: Una sola, al menos por ahora. Un usuario tiene como máximo una fila en `usuarios_organizacion` — no hace falta selector de "organización activa" en Refine para estos dos perfiles (el superadmin es la única excepción, porque entra a organizaciones sin ser miembro de ellas — Historia 4).
- Q: Cuando el superadmin crea una organización con el email de su primer administrador, ¿ese email tiene que corresponder a una cuenta que ya existe, o el sistema invita/crea la cuenta automáticamente? → A: El sistema invita automáticamente por email (vía el mecanismo de invitación de Supabase Auth) — no hay otro camino de alta de cuenta en este template, dado que no existe autoservicio de registro. Esa persona invitada es el primer administrador ("fundador") de la organización.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Los datos de cada organización quedan aislados (Priority: P1)

Como usuario autenticado de una organización, no puedo ver ni modificar
datos de ninguna otra organización, sin importar qué consulta haga.

**Why this priority**: Es la base de todo lo demás — sin aislamiento
verificado, ninguna otra funcionalidad de este template es segura de
construir encima. Es literalmente lo que dice el Principio I de la
constitución.

**Independent Test**: con dos organizaciones y datos de prueba en cada una,
un usuario de la organización A no puede leer ni escribir ninguna fila de
la organización B — verificado con un test automatizado (pgTAP) que no
depende de revisión manual.

**Acceptance Scenarios**:

1. **Given** dos organizaciones con clientes propios cada una, **When** un
   usuario de la organización A consulta la tabla de clientes, **Then**
   solo ve los clientes de la organización A.
2. **Given** un usuario autenticado, **When** intenta actualizar o borrar
   una fila de `clientes` que pertenece a otra organización, **Then** la
   operación no afecta ninguna fila (RLS la filtra, no hay error revelador
   de que la fila existe).
3. **Given** un usuario sin ninguna membresía en `usuarios_organizacion`,
   **When** consulta cualquier tabla aislada por organización, **Then** no
   ve ninguna fila (falla cerrado, no abierto).

---

### User Story 2 - El superadmin crea y ve organizaciones desde una pantalla propia (Priority: P2)

Como superadmin (hoy, una sola persona en toda la aplicación), tengo una
pantalla exclusiva en Refine donde veo el listado de todas las
organizaciones y puedo crear una nueva junto con su primer usuario
administrador. Ningún otro perfil ve esta pantalla ni puede crear
organizaciones.

**Why this priority**: Sin esto no hay forma de que exista una sola
organización real, ni de verlas — es el punto de entrada obligatorio antes
de que cualquier otra historia tenga sentido.

**Independent Test**: el usuario con perfil superadmin abre la pantalla de
organizaciones, ve el listado, crea una organización nueva con el botón
correspondiente, y la ve aparecer en el listado; un usuario con perfil
administrador o miembro no encuentra esta pantalla en ningún lado de
Refine.

**Acceptance Scenarios**:

1. **Given** que el superadmin abre la pantalla de organizaciones, **When**
   completa el formulario de alta (nombre de la organización, email del
   primer administrador) y confirma, **Then** se crea la organización, una
   fila en `usuarios_organizacion` con rol de administrador para ese
   usuario, y la organización aparece en el listado.
2. **Given** un usuario autenticado con perfil administrador o miembro,
   **When** navega Refine, **Then** no encuentra la pantalla de
   organizaciones ni ninguna opción para crear una.
3. **Given** un usuario sin perfil superadmin, **When** intenta crear una
   organización por cualquier vía (no solo la UI), **Then** la operación es
   rechazada.

---

### User Story 3 - Administrar los clientes de la propia organización (Priority: P3)

Como administrador de una organización, puedo listar, crear y editar los
clientes de mi organización desde Refine. Como miembro, puedo listarlos
pero no crear ni editar — al menos por ahora.

**Why this priority**: Es la primera entidad de negocio real que valida
que el patrón de aislamiento se replica sin fricción a una tabla nueva —
el objetivo explícito de esta fundación.

**Independent Test**: desde Refine, un administrador crea un cliente, lo ve
listado, lo edita, y confirma que ese cliente no aparece para un usuario de
otra organización; un miembro de la misma organización ve el mismo listado
pero no encuentra forma de crear ni editar ningún cliente.

**Acceptance Scenarios**:

1. **Given** un administrador autenticado, **When** crea un cliente desde
   Refine, **Then** el cliente queda asociado a su organización sin que el
   usuario tenga que indicarlo explícitamente.
2. **Given** una lista de clientes en Refine, **When** un usuario de otra
   organización abre la misma pantalla, **Then** ve una lista distinta
   (solo la suya).
3. **Given** un miembro autenticado (no administrador), **When** abre la
   pantalla de clientes, **Then** ve el listado pero no tiene disponible
   ninguna acción de crear ni editar.
4. **Given** un miembro autenticado, **When** intenta crear o editar un
   cliente por cualquier vía (no solo la UI), **Then** la operación es
   rechazada.

---

### User Story 4 - El superadmin entra a una organización y la administra (Priority: P4)

Como superadmin, desde el listado de organizaciones puedo entrar a una
organización puntual y operar sus datos (por ejemplo, sus clientes) como
si fuera su administrador — una organización a la vez, nunca varias
mezcladas al mismo tiempo.

**Why this priority**: Depende de que ya existan el listado (Historia 2) y
las pantallas de `clientes` (Historia 3) — es la última pieza, la que hace
que el conjunto sea operable de punta a punta para el superadmin, no solo
un listado sin acción.

**Independent Test**: el superadmin entra a la organización X desde el
listado, ve/edita sus clientes, vuelve al listado, entra a la organización
Y, y confirma que ve datos distintos — sin ver ambas mezcladas en ningún
momento.

**Acceptance Scenarios**:

1. **Given** el listado de organizaciones, **When** el superadmin hace clic
   en "Ingresar" en la fila de una organización, **Then** accede a las
   pantallas de esa organización (por ejemplo, `clientes`) con los mismos
   permisos que un administrador de esa organización.
2. **Given** que el superadmin está dentro de la organización X, **When**
   intenta ver datos de la organización Y sin volver antes al listado y
   entrar explícitamente a Y, **Then** no los ve.
3. **Given** que el superadmin entra a una organización, **When** lo hace,
   **Then** el sistema registra quién entró, a qué organización, y cuándo
   (Principio III de la constitución: toda ejecución sensible queda
   auditada).

---

### Edge Cases

- ¿Qué pasa si se borra la última membresía de una organización (queda sin
  ningún usuario)? La organización y sus datos permanecen (no se borran en
  cascada); queda huérfana hasta que alguien la recupere por otra vía. No
  se resuelve una UI para esto en esta spec.
- ¿Qué pasa si dos usuarios de la misma organización editan el mismo
  cliente al mismo tiempo? Gana la última escritura (comportamiento por
  defecto de Postgres); no se agrega bloqueo optimista en esta spec.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE tener una tabla `organizaciones` que
  represente el tenant (identificador, nombre, fecha de creación).
- **FR-002**: El sistema DEBE tener una tabla `usuarios_organizacion` que
  vincule un usuario autenticado con una organización y un rol
  (administrador o miembro, ambos acotados a esa organización). Un usuario
  con perfil administrador o miembro NO DEBE tener más de una fila en esta
  tabla — pertenece a una única organización, al menos por ahora.
- **FR-003**: El sistema DEBE tener un mecanismo para marcar a un usuario
  como superadmin, independiente de cualquier organización (un superadmin
  no es necesariamente miembro de ninguna `usuarios_organizacion`).
- **FR-004**: El sistema DEBE tener una función helper de Postgres
  reutilizable que resuelva la organización del usuario autenticado actual,
  usada por toda policy de RLS de este template en adelante.
- **FR-005**: El sistema DEBE tener una tabla `clientes` (a quién le presta
  servicio la organización), aislada por el mismo mecanismo de RLS que
  cualquier tabla futura del template.
- **FR-006**: Ninguna tabla aislada por organización DEBE ser legible ni
  modificable por un usuario que no pertenezca a esa organización, **salvo**
  un superadmin que haya entrado explícitamente a esa organización puntual
  (Historia 4) — nunca a varias a la vez, nunca de forma implícita. Sin
  excepciones fuera de ese único caso, verificado con un test automatizado
  (pgTAP), no solo revisión manual.
- **FR-007**: Un usuario sin ninguna fila en `usuarios_organizacion` y sin
  perfil superadmin NO DEBE ver ninguna fila de ninguna tabla aislada por
  organización.
- **FR-008**: Refine DEBE exponer una pantalla de organizaciones, visible
  solo para usuarios con perfil superadmin, con el listado completo de
  organizaciones y un formulario para crear una nueva indicando nombre de
  la organización y el email de su primer administrador ("fundador").
- **FR-009**: Al crear una organización, el sistema DEBE invitar por email
  a la persona indicada como primer administrador (no existe otro camino
  de alta de cuenta en este template, dado que no hay autoservicio de
  registro). Esa persona queda vinculada en `usuarios_organizacion` con rol
  de administrador de la organización nueva.
- **FR-010**: Un intento de crear una organización, ver el listado, o
  entrar a una organización, por parte de un usuario sin perfil superadmin,
  DEBE ser rechazado — sin importar por qué vía se intente, no solo desde
  la UI de Refine.
- **FR-011**: Refine DEBE exponer una pantalla de clientes visible para
  administrador y miembro. Solo administrador puede crear y editar; miembro
  únicamente puede listar/ver — al menos por ahora, sin excepciones fuera
  de RLS (no alcanza con ocultar el botón en la UI, la escritura debe
  rechazarse también a nivel de base de datos).
- **FR-012**: Cada fila del listado de organizaciones DEBE tener una acción
  para que el superadmin entre a esa organización y opere sus pantallas de
  negocio (por ejemplo, `clientes`) con los mismos permisos que un
  administrador de esa organización.
- **FR-013**: El sistema DEBE registrar cada vez que un superadmin entra a
  una organización: quién, a qué organización, y cuándo.

### Key Entities

- **Organización**: el tenant — el límite de aislamiento de RLS. Tiene
  nombre y fecha de creación.
- **Superadmin**: perfil de plataforma completa, no pertenece a ninguna
  organización. Puede crear organizaciones, ver el listado completo, y
  entrar a una organización puntual para operarla como su administrador —
  una a la vez, con cada entrada registrada.
- **Registro de entrada de superadmin**: quién, a qué organización, y
  cuándo — se genera automáticamente cada vez que un superadmin entra a
  una organización (FR-013).
- **Usuario_organización**: la membresía — vincula un usuario autenticado
  con una organización y le asigna un rol acotado a esa organización:
  **administrador** (gestiona membresías y datos: lee, crea y edita — el
  primer administrador de una organización, invitado por el superadmin al
  crearla, es su "fundador") o **miembro** (solo lee/lista los datos de
  negocio; no crea ni edita, no
  gestiona membresías — al menos por ahora).
- **Cliente**: a quién le presta servicio la organización. Pertenece a
  exactamente una organización.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El test de aislamiento (pgTAP) falla si cualquier policy de
  RLS permite lectura o escritura cruzada entre organizaciones — corre
  como parte de `pnpm test` en cada entrega, no como paso manual.
- **SC-002**: Un usuario administrador recién dado de alta por el
  superadmin puede iniciar sesión y cargar su primer cliente en menos de 3
  pasos, sin ningún paso adicional de configuración de organización.
- **SC-003**: Agregar una tabla de negocio nueva que reutilice el mismo
  mecanismo de aislamiento no requiere escribir una función de RLS nueva —
  solo aplicar el mismo molde (columna + policy) que ya usa `clientes`.
- **SC-004**: El superadmin puede crear una organización y entrar a
  administrarla en menos de 2 minutos desde que abre la pantalla de
  organizaciones, sin ayuda externa ni pasos manuales en la base de datos.

## Assumptions

- **3 perfiles desde el arranque**: superadmin (plataforma, sin
  organización), administrador (de una organización) y miembro (de una
  organización). Permisos más finos dentro de estos tres quedan para una
  spec futura si aparece el caso de uso.
- **Alcance del superadmin en esta spec**: crear organizaciones, verlas
  listadas, y entrar a una organización puntual para operarla como su
  administrador — nunca ver ni mezclar datos de varias organizaciones al
  mismo tiempo. Hoy hay una sola persona con este perfil.
- **Alta de organización**: no es autoservicio para usuarios comunes. Se
  hace desde la pantalla de organizaciones en Refine, solo visible para
  superadmin. Ningún usuario con perfil administrador o miembro ve ni
  puede acceder a esta capacidad.
- El mecanismo técnico exacto por el que el superadmin "entra" a una
  organización (cómo se acota el acceso a una sola organización por vez, y
  cómo queda registrado) se define en el plan — esta spec fija el
  comportamiento esperado (FR-006, FR-012, FR-013), no la implementación.
- Esta spec no incluye facturación, límites de uso, ni ningún otro atributo
  específico de un vertical — eso es responsabilidad del producto real que
  se construya sobre este template, no de la fundación.
