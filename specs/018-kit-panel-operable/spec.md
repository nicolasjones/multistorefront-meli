# Feature Specification: Kit de panel operable

**Feature Branch**: `018-kit-panel-operable`

**Created**: 2026-09-22

**Status**: Draft

**Input**: Kit reutilizable de navegación declarativa por audiencia, identidad de presentación segura, estados de página consistentes, contenido adaptable y contorno visual contenido, para que cualquier producto derivado construya un panel operable sin reinventar estos mecanismos.

**Delivery scope**: refine | supabase

Este patrón nace de convergencia real: un producto derivado en producción lo
construyó completo (navegación, identidad, estados, contenido adaptable,
contorno de sección) y lo validó con sus propios recursos de negocio antes de
que se generalizara acá — mismo precedente que la spec 012 (convención de
workers), que documentó su patrón citando casos convergentes sin
implementarlos en el template.

**Explícitamente fuera de esta spec**: la resolución del actor que disparó
una ejecución (quién la inició, mostrado con nombre en vez de UUID) depende
del diseño final de la tabla de ejecuciones del template, todavía en
discusión entre el diseño de la spec 016 (`ejecuciones_worker`) y el de un
producto derivado (`public.ejecuciones`). Esta spec entrega el componente de
identidad de presentación (`IdentidadVisible`) como pieza reutilizable, pero
no la función de resolución de actor de ejecución — eso vuelve en una spec
posterior, una vez resuelto ese diseño.

## User Scenarios & Testing

### User Story 1 - Navego el panel según mi audiencia (Priority: P1)

Como persona autenticada, veo en el menú solo las secciones y destinos que mi
rol permite (miembro, administrador de mi organización o superadmin de la
plataforma), agrupados de forma comprensible, sin una lista plana de recursos
técnicos.

**Why this priority**: La navegación es la entrada a todo el resto del
producto; sin una audiencia clara, cada producto derivado reinventa su propio
filtrado ad hoc y termina exponiendo destinos que un rol no debería ver.

**Independent Test**: Con contextos de miembro, administrador y superadmin
simulados, abrir el sider y comprobar que cada uno ve solo sus secciones,
agrupadas en un acordeón con una sección abierta por defecto.

**Acceptance Scenarios**:

1. **Given** una persona con organización de trabajo pero sin rol de
   administrador, **When** abre el menú, **Then** ve solo los destinos de
   audiencia `autenticada` y `organizacion`.
2. **Given** una persona administradora de su organización, **When** abre el
   menú, **Then** además ve los destinos de audiencia `administrador`.
3. **Given** un superadmin sin organización activa, **When** abre el menú,
   **Then** ve los destinos de audiencia `superadmin` y ningún destino de
   audiencia `organizacion` (que requiere una organización efectiva).
4. **Given** cualquier persona, **When** hace foco en un ítem del sider con
   teclado, **Then** el destino es alcanzable y su ícono es decorativo para
   el lector de pantalla.

---

### User Story 2 - Reconozco personas y organizaciones sin IDs técnicos (Priority: P1)

Como persona que opera el panel, veo nombres comprensibles en vez de UUIDs;
un identificador técnico solo aparece si lo pido explícitamente y soy
superadmin.

**Why this priority**: Un identificador técnico no ayuda a tomar una
decisión operativa y genera dudas sobre si se está actuando sobre el
registro correcto.

**Independent Test**: Renderizar el componente de identidad con perfiles
completos, incompletos, eliminados y de sistema, y confirmar que nunca
aparece un UUID como texto principal ni como `aria-label`.

**Acceptance Scenarios**:

1. **Given** una persona con nombre y apellido, **When** se muestra en
   cualquier superficie, **Then** aparece su nombre completo.
2. **Given** una persona con perfil incompleto o sin datos, **When** se
   muestra, **Then** aparece un nombre parcial o "Perfil sin completar".
3. **Given** un actor histórico que ya no puede resolverse o una acción de
   origen automático, **When** se muestra, **Then** aparece "Usuario
   eliminado" o "Sistema", nunca un UUID.
4. **Given** un superadmin que necesita el identificador técnico real,
   **When** usa la acción secundaria explícita, **Then** puede copiarlo; para
   cualquier otra audiencia esa acción no se renderiza.

---

### User Story 3 - Entiendo el estado de cada pantalla mientras carga (Priority: P2)

Como usuario del panel, veo una respuesta visual inmediata al entrar a una
pantalla con datos, en vez de un espacio vacío.

**Why this priority**: La confianza en un panel operativo depende de
entender qué está pasando, sobre todo al consultar datos sensibles o
protegidos por permisos.

**Independent Test**: Con latencia simulada, navegar a una pantalla y
comprobar que siempre aparece una estructura de carga, un estado vacío útil,
el contenido, o un error con acción de reintento.

**Acceptance Scenarios**:

1. **Given** una pantalla cuyos datos se están resolviendo, **When** se
   navega hacia ella, **Then** aparece un indicador de carga estructural
   (`role="status"`), no una pantalla en blanco.
2. **Given** una lista sin registros, **When** carga correctamente, **Then**
   aparece un estado vacío que explica qué falta.
3. **Given** un error al consultar datos, **When** la pantalla termina de
   cargar, **Then** aparece un mensaje claro con una acción de reintentar
   cuando corresponda.

---

### User Story 4 - Opero pantallas consistentes en cualquier ancho (Priority: P3)

Como administrador o miembro, encuentro título, contexto, acción principal y
contenido en el mismo lugar en cualquier pantalla del panel, y una tabla se
condensa en tarjetas sin perder acciones cuando el ancho es reducido.

**Why this priority**: La consistencia reduce el esfuerzo de aprender cada
pantalla nueva y evita que cada producto derivado reinvente su propio patrón
de encabezado y tabla responsive.

**Independent Test**: Renderizar una lista con `EncabezadoPagina` +
`ContenidoAdaptable` en un ancho angosto (< 600px) y uno amplio, y comprobar
que ambos exponen las mismas columnas y acciones por fila.

**Acceptance Scenarios**:

1. **Given** una pantalla con `EncabezadoPagina`, **When** se abre, **Then**
   presenta título, descripción opcional, acción principal y contexto en una
   jerarquía consistente.
2. **Given** una lista con `ContenidoAdaptable`, **When** el ancho es menor a
   600px, **Then** cada fila se condensa en una tarjeta con las mismas
   acciones que la tabla.

---

### User Story 5 - Reconozco cada pantalla como una unidad contenida (Priority: P4)

Como administrador o miembro, veo el contenido principal de cada pantalla
(tabla, formulario o historial) dentro de un contorno visual claro, en vez de
flotar directamente sobre el fondo de la aplicación.

**Why this priority**: Es un ajuste puramente visual sobre un patrón que la
propia US4 ya estableció; no cambia datos, permisos ni flujos. Se prioriza
último porque ninguna otra historia depende de él.

**Independent Test**: Envolver el contenido principal de una pantalla en
`ContenedorSeccion` y confirmar que tabla, estados de carga/vacío/error y
acciones quedan dentro de un único borde visual.

**Acceptance Scenarios**:

1. **Given** una pantalla con una tabla o grilla, **When** se abre, **Then**
   la tabla y sus estados quedan dentro de un contorno visual único.
2. **Given** una persona con un ancho de pantalla reducido, **When** ve una
   pantalla con este contorno, **Then** el contorno se adapta sin cortar
   contenido.

### Edge Cases

- Un miembro sin permisos administrativos nunca ve controles de
  configuración ni de plataforma, aunque conozca la URL directa.
- Una organización activa cambia o se elimina mientras una pantalla está
  abierta; el contexto se invalida y el panel deja de mostrar datos de ese
  contexto.
- Una lista contiene decenas de registros; la presentación adaptable sigue
  permitiendo identificar y accionar sin que datos técnicos ocupen la
  interfaz.

## Requirements

### Functional Requirements

- **FR-001**: El sistema DEBE ofrecer un tipo de destino de navegación con
  identificador, etiqueta, ícono, ruta y audiencia (`autenticada`,
  `organizacion`, `administrador` o `superadmin`), agrupado en secciones.
- **FR-002**: El sider DEBE renderizar únicamente los destinos autorizados
  para el contexto efectivo actual, agrupados en un acordeón con una sola
  sección abierta a la vez.
- **FR-003**: El sistema DEBE exponer un contexto de panel (superadmin,
  organización efectiva, rol, permiso de escritura, permiso de copiar
  identificador técnico) derivado del JWT actual, sin aceptar un
  identificador de usuario arbitrario, y con un único punto de invalidación
  al cambiar de organización.
- **FR-004**: La interfaz DEBE usar una identidad de presentación para
  personas y organizaciones; un identificador interno no DEBE aparecer como
  texto visible principal ni como *fallback* de nombre.
- **FR-005**: La identidad de presentación DEBE seguir el orden: nombre
  completo, nombre parcial, estado comprensible de perfil o actor no
  disponible; nunca UUID.
- **FR-006**: Un identificador técnico solo DEBE poder consultarse mediante
  una acción secundaria explícita y exclusiva de superadmin.
- **FR-007**: Cada pantalla que consuma este kit DEBE comunicar carga,
  estado vacío, error y éxito de manera visible; no DEBE quedar vacía
  mientras resuelve datos.
- **FR-008**: Las pantallas DEBEN compartir un patrón de encabezado con
  título, descripción breve, acción principal cuando exista y contexto de
  organización.
- **FR-009**: El contenido tabular DEBE adaptarse entre tabla (ancho ≥600px)
  y tarjeta (ancho <600px) compartiendo las mismas columnas y acciones.
- **FR-010**: El contenido principal de una pantalla DEBE poder envolverse en
  un contorno visual contenido y consistente, sin cambiar datos ni permisos.
- **FR-011**: El menú de cuenta (perfil, cambio de contraseña, salir) DEBE
  vivir en un área compacta separada del menú de navegación principal.

### Key Entities

- **Destino de navegación**: pantalla del menú, con propósito, audiencia y
  ubicación dentro de una sección.
- **Contexto de panel**: estado de sesión/organización efectivo que
  determina qué se muestra y qué se puede hacer.
- **Identidad de presentación**: texto seguro y comprensible que representa
  a una persona u organización en la interfaz.

## Success Criteria

### Measurable Outcomes

- **SC-001**: El 100% de los destinos visibles para un rol corresponde a su
  audiencia declarada; ningún rol ve un destino de una audiencia superior.
- **SC-002**: El 100% de las superficies que muestran una persona u
  organización evita un identificador técnico como nombre visible
  predeterminado.
- **SC-003**: El cambio de organización actualiza navegación y contenido sin
  una recarga completa del documento.
- **SC-004**: En una revisión manual a 320px, 768px y 1440px, ninguna acción
  principal ni opción de menú queda inaccesible o cortada.

## Assumptions

- El producto derivado que adopte este kit reemplaza `destinosPanel.ts` por
  sus propios destinos; el mecanismo (tipos, `destinoVisible`, `SiderPanel`)
  se porta, la lista de destinos no.
- El contexto de panel depende de `private.is_superadmin()`,
  `private.organizacion_id()`, `private.rol_id()` y `private.puede_escribir()`,
  ya establecidas por specs anteriores del template.
- El menú de cuenta depende de `perfiles_usuario` y del bucket
  `fotos-perfil`, ya establecidos por la spec de perfil de usuario.
- No se incorpora la resolución de actor de una ejecución (ver nota de
  alcance arriba).
