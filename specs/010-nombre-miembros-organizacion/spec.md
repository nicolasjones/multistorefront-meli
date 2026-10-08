# Feature Specification: Nombre visible entre miembros de una organización

**Feature Branch**: `010-nombre-miembros-organizacion`

**Created**: 2026-09-11

**Status**: Implemented

**Input**: User description: "Mostrar nombre y apellido de cada miembro en
la pantalla de gestión de miembros de una organización (hoy solo se ve el
user_id en UUID), visible para cualquier miembro de la misma organización
(no entre organizaciones distintas). El nombre/apellido sale de
perfiles_usuario (spec 008-perfil-usuario), que hoy prohíbe explícitamente
que un miembro lea la fila de perfil de otro — esta spec revierte esa
restricción puntualmente para nombre y apellido dentro de la misma
organización (la foto de perfil sigue con su propia regla de acceso ya
existente, sin cambios). Si una persona todavía no completó su
nombre/apellido en su perfil, la pantalla de miembros debe mostrar algo
explícito en vez de vacío o el UUID crudo."

**Delivery scope**: refine | supabase

## Clarifications

### Session 2026-09-12

- Q: ¿Quién debería poder ver nombre/apellido de otras personas dentro de
  su misma organización? → A: Quien administra membresías (administrador
  o superadmin con organización activa) — la pantalla de miembros es
  configuración de la organización, no una pantalla de uso general; un
  miembro raso no accede a ella, igual que hoy (spec 005).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Identificar a un compañero por nombre en la pantalla de miembros (Priority: P1)

Como administrador (o superadmin operando la organización), al abrir la
pantalla de miembros veo el nombre y apellido de cada persona en vez de un
identificador ilegible, para saber con quién estoy compartiendo la
organización sin tener que preguntarle a nadie ni consultar la base de
datos a mano.

**Why this priority**: Es el único valor de negocio de esta
especificación — sin esto, la pantalla de miembros es prácticamente
inutilizable para identificar personas.

**Independent Test**: Con dos personas en la misma organización, una de
ellas con nombre y apellido cargados en su perfil, iniciar sesión como
administrador de esa organización y confirmar que la pantalla de miembros
muestra "Nombre Apellido" en vez del UUID de esa persona.

**Acceptance Scenarios**:

1. **Given** dos personas en la misma organización, la segunda con nombre
   y apellido cargados en su perfil, **When** la primera (administrador de
   esa organización) abre la pantalla de miembros, **Then** ve el nombre y
   apellido de la segunda, no su identificador interno.
2. **Given** una persona con nombre y apellido cargados, **When** alguien
   de una organización **distinta** intenta acceder a esa información por
   cualquier medio, **Then** el sistema lo rechaza — el nombre sigue
   siendo privado entre organizaciones.
3. **Given** una persona que todavía no completó nombre ni apellido en su
   perfil, **When** un administrador de su organización abre la pantalla
   de miembros, **Then** ve una indicación explícita de que esa persona no
   completó su nombre, nunca un espacio vacío ni su identificador interno.

### Edge Cases

- ¿Qué pasa si alguien completa su nombre y apellido después de que un
  compañero ya abrió la pantalla de miembros? El próximo refresco de esa
  pantalla debe reflejar el dato actualizado — no hay una copia
  desactualizada que mantener.
- ¿Qué pasa si una persona pertenece a una organización y luego se va o es
  removida? Deja de ser visible en la pantalla de miembros de esa
  organización como cualquier otro miembro removido (spec 005); su nombre
  no queda expuesto a esa organización después de irse.
- ¿Qué ve un superadmin que entró a una organización (spec 003) en la
  pantalla de miembros de esa organización? Lo mismo que vería un
  administrador de ella — nombre y apellido de cada persona, según la
  misma regla.
- La foto de perfil no cambia de regla en esta especificación: sigue
  visible entre compañeros de organización exactamente como ya lo definió
  la spec 008, y sigue sin ser parte de esta habilitación puntual de
  nombre/apellido.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE permitir que un administrador (o superadmin
  operando esa organización, spec 003) lea el nombre y apellido de perfil
  de cualquier miembro de esa misma organización. Un miembro raso no
  accede a la pantalla de miembros ni, por lo tanto, a este dato de sus
  compañeros — igual que hoy (spec 005).
- **FR-002**: El sistema NO DEBE permitir que alguien de una organización
  distinta lea el nombre o apellido de perfil de una persona con la que no
  comparte organización.
- **FR-003**: La pantalla de gestión de miembros DEBE mostrar el nombre y
  apellido de cada persona listada, en vez de su identificador interno.
- **FR-004**: Cuando una persona no completó nombre ni apellido en su
  perfil, el sistema DEBE mostrar una indicación explícita de dato
  incompleto, nunca un espacio vacío ni el identificador interno crudo.
- **FR-005**: Esta habilitación DEBE alcanzar únicamente a nombre y
  apellido — ningún otro campo de `perfiles_usuario` (foto, u otro dato
  personal futuro) cambia de regla de acceso por esta especificación.
- **FR-006**: Un superadmin operando dentro de una organización activa
  (spec 003) DEBE ver nombre y apellido de los miembros de esa
  organización bajo la misma regla que un administrador de ella.
- **FR-007**: Dejar de pertenecer a una organización (remoción o salida)
  DEBE dejar sin efecto, para esa organización, la visibilidad del nombre
  y apellido de la persona que se fue.

### Key Entities

- **Perfil de usuario** (`perfiles_usuario`, spec 008): ya existente; esta
  especificación amplía quién puede leer únicamente sus campos de nombre y
  apellido, sin modificar su estructura.
- **Membresía de organización** (`usuarios_organizacion`, spec 003): ya
  existente; determina quién comparte organización con quién, y por lo
  tanto quién puede ver el nombre de quién.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Cualquier administrador (o superadmin operando la
  organización) puede identificar por nombre y apellido a cada compañero
  de su organización desde la pantalla de miembros, sin necesitar
  información adicional fuera del producto.
- **SC-002**: Ninguna persona puede leer, por ningún medio, el nombre o
  apellido de alguien con quien no comparte organización.
- **SC-003**: El 100% de las personas listadas en la pantalla de miembros
  muestran un nombre legible o una indicación explícita de dato
  incompleto — nunca un identificador interno crudo.

## Assumptions

- El alcance de visibilidad es "quien administra membresías"
  (administrador o superadmin con organización activa), resuelto en
  Clarifications — la pantalla de miembros es parte de la configuración
  de la organización (spec 005), no una pantalla de uso general para
  cualquier miembro.
- La organización efectiva de un superadmin, a los fines de esta regla, es
  la misma que ya resuelve el resto del producto (organización activa,
  spec 003) — no se introduce un concepto nuevo de "organización" para
  esto.
- El texto exacto mostrado cuando falta nombre/apellido (por ejemplo,
  "Sin nombre completado") es un detalle de redacción de la pantalla, no
  una decisión de negocio — se define en la fase de implementación.
- Email y otros datos de cuenta derivados (spec 008) no forman parte de
  esta especificación: solo se amplía el acceso a nombre y apellido de
  `perfiles_usuario`.
