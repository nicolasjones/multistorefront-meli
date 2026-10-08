# Feature Specification: Gestión de miembros de organización

**Feature Branch**: `005-gestion-miembros`

**Created**: 2026-09-09

**Status**: Implemented

**Input**: User description: "Gestión de miembros por organización: invitar miembros, cambiar sus roles y removerlos, respetando aislamiento multi-tenant y auditoría."

**Delivery scope**: refine | supabase

## Clarifications

### Session 2026-09-09

- Q: ¿El administrador fundador debe tener una protección especial frente a otros administradores? → A: El fundador se administra igual que cualquier otro administrador; no se puede quitar ni degradar al último administrador.
- Q: ¿Qué debe ocurrir al sumar a una persona que ya tiene cuenta pero fue removida de otra organización? → A: Se la asocia directamente a la nueva organización, sin enviar un nuevo email.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Consultar e invitar miembros (Priority: P1)

Como administrador de una organización, puedo ver quiénes pertenecen a mi organización e invitar por correo a una nueva persona con el rol adecuado, para que pueda acceder sin que exista un registro propio abierto al público.

**Why this priority**: Sin una invitación administrada, el fundador depende del superadmin para sumar a cada colaborador y la organización no puede operar de manera autónoma.

**Independent Test**: Un administrador abre el listado de miembros, invita una dirección de correo como miembro y comprueba que la persona invitada queda asociada únicamente a esa organización y recibe las instrucciones para acceder.

**Acceptance Scenarios**:

1. **Given** un administrador de la organización X, **When** consulta los miembros, **Then** ve solo las personas y roles de X.
2. **Given** un administrador de X, **When** suma una persona como miembro, **Then** si no tiene cuenta recibe una invitación para acceder y queda vinculada a X con el rol seleccionado; si ya tiene cuenta y no pertenece a otra organización, queda vinculada directamente sin un nuevo correo.
3. **Given** un superadmin que opera X como organización activa, **When** consulta o invita miembros, **Then** obtiene las mismas capacidades que un administrador de X.
4. **Given** un miembro o una persona de otra organización, **When** intenta consultar o invitar miembros de X por cualquier vía, **Then** la operación es rechazada y no se revela información de X.

---

### User Story 2 - Cambiar el rol de un miembro (Priority: P2)

Como administrador, puedo promover a un miembro a administrador o degradar a un administrador a miembro, para distribuir la responsabilidad operativa sin mezclar organizaciones.

**Why this priority**: Una vez incorporado un equipo, el fundador necesita delegar administración o revocarla sin tener que crear cuentas ni pedir intervención de plataforma.

**Independent Test**: Con dos administradores y un miembro en una organización, un administrador cambia el rol del miembro y luego el del otro administrador; los permisos de cada persona se ajustan al nuevo rol y queda registro de ambos cambios.

**Acceptance Scenarios**:

1. **Given** un administrador de X y un miembro de X, **When** el administrador cambia el rol del miembro a administrador, **Then** la persona adquiere las capacidades de administrador en X.
2. **Given** dos administradores en X, **When** uno cambia el rol del otro a miembro, **Then** la persona conserva acceso a X con las capacidades de miembro.
3. **Given** que una organización tiene un único administrador, **When** se intenta degradarlo a miembro, **Then** la operación se rechaza y X conserva al menos un administrador.
4. **Given** una persona que no administra X, **When** intenta cambiar un rol de X por interfaz o acceso directo, **Then** la operación es rechazada.

---

### User Story 3 - Remover un miembro (Priority: P3)

Como administrador, puedo quitar de mi organización a una persona que ya no debe acceder, para revocar su acceso de forma inmediata y dejar trazabilidad de la decisión.

**Why this priority**: Completa el ciclo de vida de una membresía y evita que una persona conserve acceso después de dejar la organización.

**Independent Test**: Un administrador remueve a un miembro de X y comprueba que esa persona ya no puede consultar datos de X ni ve las pantallas de la organización.

**Acceptance Scenarios**:

1. **Given** un administrador y un miembro de X, **When** el administrador remueve al miembro, **Then** el miembro pierde el acceso a los datos y pantallas de X.
2. **Given** una organización con dos o más administradores, **When** uno remueve a otro, **Then** la persona removida pierde su acceso y X conserva al menos un administrador.
3. **Given** una organización con un único administrador, **When** se intenta removerlo, **Then** la operación se rechaza y la organización conserva su administrador.
4. **Given** un miembro o una persona de otra organización, **When** intenta remover a alguien de X, **Then** la operación es rechazada y no se modifica ninguna membresía.

### Edge Cases

- Invitar una dirección que ya pertenece a la misma organización no crea una segunda membresía ni envía una invitación duplicada.
- Invitar una dirección asociada a otra organización se rechaza; una persona solo puede pertenecer a una organización en esta etapa del producto.
- Sumar una dirección con una cuenta existente y sin membresía la vincula directamente, sin una nueva invitación por correo.
- Una invitación no aceptada no permite acceso a datos de la organización antes de que la persona complete su acceso.
- Si la entrega o aceptación de una invitación falla, no queda una membresía utilizable sin que la persona pueda recibir una vía válida de acceso.
- Un administrador no puede quitar ni degradar el último rol de administrador de la organización, incluso si intenta hacerlo sobre sí mismo.
- Las acciones rechazadas no cambian membresías ni generan un evento de auditoría exitoso.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE ofrecer un listado de miembros y sus roles, limitado a la organización del administrador que consulta.
- **FR-002**: El sistema DEBE permitir a un administrador sumar una persona como `administrador` o `miembro` de su propia organización: si no tiene cuenta, recibe una invitación por correo; si ya tiene cuenta y no pertenece a otra organización, queda vinculada directamente sin un nuevo correo.
- **FR-003**: El sistema DEBE impedir que una invitación cree una segunda pertenencia para una persona que ya pertenece a cualquier organización.
- **FR-004**: El sistema DEBE permitir a un administrador cambiar el rol de otra persona de su organización entre `administrador` y `miembro`.
- **FR-005**: El sistema DEBE permitir a un administrador remover a otra persona de su organización y revocar su acceso a los recursos de esa organización.
- **FR-006**: El sistema DEBE garantizar que toda organización conserva al menos un administrador; no puede degradarse ni removerse al último administrador, incluido el fundador.
- **FR-007**: El sistema DEBE rechazar el listado de miembros ajenos y cualquier modificación de membresías por parte de miembros, personas de otra organización y usuarios no autenticados, sin depender solo de la interfaz. Un miembro puede conservar lectura de su propia membresía solo para resolver sus permisos, sin acceso a la pantalla de gestión.
- **FR-008**: El superadmin con una organización activa DEBE poder gestionar los miembros de esa organización con los mismos permisos que su administrador, sin obtener acceso a los miembros de otra organización sin cambiar primero de contexto.
- **FR-009**: El sistema DEBE ocultar la gestión de miembros a un superadmin que no tenga una organización activa y redirigirlo al listado de organizaciones si accede por una URL directa.
- **FR-010**: El sistema DEBE registrar cada incorporación, invitación enviada, cambio de rol y remoción efectiva, incluyendo quién realizó la acción, qué organización afectó, cuál fue la persona objetivo, el cambio realizado y cuándo ocurrió.
- **FR-011**: El sistema DEBE mostrar mensajes claros para operaciones rechazadas, incluidos usuario ya perteneciente a una organización, invitación duplicada y último administrador.
- **FR-012**: La gestión de membresías DEBE utilizar únicamente los roles existentes `administrador` y `miembro`; crear roles nuevos queda fuera de alcance.

### Key Entities

- **Membresía**: vínculo de una persona autenticada con una única organización y uno de los roles existentes.
- **Invitación de membresía**: solicitud dirigida por correo para que una persona acceda a una organización con un rol elegido.
- **Evento de auditoría de membresía**: registro inmutable de una incorporación, invitación, cambio de rol o remoción efectivos, con actor, objetivo, organización, detalle y momento.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100 % de los intentos de consulta o modificación entre organizaciones son rechazados y no exponen datos de miembros ajenos.
- **SC-002**: Un administrador puede invitar a una persona y asignarle un rol en menos de 2 minutos, sin intervención del superadmin.
- **SC-003**: El 100 % de las incorporaciones, invitaciones, cambios de rol y remociones efectivos tienen un registro de auditoría con actor, objetivo, organización y fecha.
- **SC-004**: Ninguna organización queda sin administrador después de un cambio de rol o una remoción.
- **SC-005**: Una persona removida deja de poder acceder a los recursos de la organización en su siguiente intento de acceso.

## Assumptions

- Las únicas opciones de rol de esta entrega son `administrador` y `miembro`, ya definidas por la fundación multi-tenant.
- Solo los administradores y los superadmins dentro de una organización activa gestionan membresías; los miembros no ven ni acceden a esta funcionalidad.
- Cada persona puede pertenecer a una única organización; para pasarla a otra, primero debe removerse de la actual y luego invitarse a la nueva.
- Se reutiliza el canal de invitación por correo ya establecido para el primer administrador de una organización; no se incorpora registro público ni administración de identidad independiente.
- Una invitación efectiva reserva la membresía con el rol elegido, pero no concede acceso hasta que la persona complete el flujo de acceso.
- Una cuenta existente sin membresía se vincula directamente y no recibe un nuevo correo; puede acceder con sus credenciales ya existentes.
- Para impedir privilegios circulares y conservar una administración recuperable, un administrador no puede cambiar su propio rol ni removerse a sí mismo en esta entrega.
- El fundador no tiene privilegios permanentes: cualquier administrador puede cambiar su rol o removerlo si se conserva al menos un administrador.
- No se incluye historial visible en la interfaz ni cancelación o reenvío de invitaciones; los eventos de auditoría quedan disponibles para trazabilidad operativa futura.
