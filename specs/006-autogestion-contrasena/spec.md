# Feature Specification: Autogestión de contraseña

**Feature Branch**: `006-autogestion-contrasena`

**Created**: 2026-09-09

**Status**: Implemented

**Input**: User description: "Permitir que cada usuario acepte su invitación creando una contraseña, recupere su contraseña por correo y la modifique por sí mismo desde su sesión."

**Delivery scope**: refine | supabase

## Clarifications

### Session 2026-09-09

- Q: Cuando una persona recupera o cambia su contraseña, ¿qué debe ocurrir con las sesiones abiertas en otros dispositivos? → A: Cerrar todas las demás sesiones al cambiar o recuperar la contraseña.
- Q: ¿Qué regla mínima debe tener una contraseña nueva? → A: Mínimo 12 caracteres, mayúscula, minúscula, número y símbolo.
- Q: ¿Se debe enviar un correo de aviso después de que una contraseña cambie correctamente? → A: Enviar aviso por correo tras cada cambio efectivo.
- Q: ¿Con qué frecuencia puede una persona pedir un nuevo enlace de invitación o recuperación para el mismo correo? → A: Un enlace cada 15 minutos.
- Q: ¿Cuánto tiempo debe seguir siendo válido un enlace de invitación o recuperación? → A: 1 hora.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Crear contraseña al aceptar una invitación (Priority: P1)

Como persona invitada, puedo elegir mi propia contraseña al abrir el enlace de invitación, para poder iniciar sesión nuevamente sin depender de quien me invitó.

**Why this priority**: Sin este paso, una cuenta nueva no dispone de una credencial reutilizable para acceder después del primer enlace.

**Independent Test**: Invitar a una dirección nueva, abrir el enlace recibido, crear una contraseña válida y verificar que un cierre e inicio de sesión posterior funciona con esas credenciales.

**Acceptance Scenarios**:

1. **Given** una persona con una invitación vigente, **When** abre el enlace y elige una contraseña válida, **Then** queda autenticada y puede volver a iniciar sesión con su correo y esa contraseña.
2. **Given** una persona con una invitación vencida, inválida o ya utilizada, o que no logró completar la creación de contraseña, **When** abre o vuelve a abrir el enlace, **Then** ve un mensaje claro y puede solicitar para su propio correo un nuevo enlace de acceso, sin quedar autenticada hasta completarlo.
3. **Given** una persona que intenta definir una contraseña de menos de 12 caracteres o sin mayúscula, minúscula, número y símbolo, **When** confirma el formulario, **Then** recibe una explicación clara y la contraseña no cambia.

---

### User Story 2 - Recuperar acceso por correo (Priority: P2)

Como persona que olvidó su contraseña, puedo pedir un enlace de recuperación y definir una contraseña nueva, para recuperar el acceso sin intervención de un administrador.

**Why this priority**: Reduce bloqueos operativos y evita que terceros conozcan o administren contraseñas ajenas.

**Independent Test**: Desde la pantalla de acceso, solicitar recuperación para una cuenta existente, abrir el correo recibido, definir una contraseña nueva y acceder con ella.

**Acceptance Scenarios**:

1. **Given** una persona con una cuenta, **When** solicita recuperar su contraseña, **Then** recibe un enlace de recuperación en su correo.
2. **Given** una persona que abre un enlace de recuperación vigente, **When** define una contraseña válida, **Then** la contraseña anterior deja de servir y la nueva permite iniciar sesión.
3. **Given** cualquier dirección de correo, **When** solicita recuperación, **Then** el sistema muestra una respuesta neutral que no revela si existe una cuenta asociada.
4. **Given** una persona cuya contraseña cambió correctamente, **When** termina el flujo, **Then** recibe un aviso por correo sin contraseñas ni enlaces sensibles.

---

### User Story 3 - Modificar contraseña desde una sesión (Priority: P3)

Como persona autenticada, puedo cambiar mi contraseña desde la aplicación, para mantener el control de mis credenciales sin intervención de otra persona.

**Why this priority**: Completa el ciclo de autocontrol de credenciales una vez que la cuenta está en uso.

**Independent Test**: Iniciar sesión, ingresar la contraseña actual y una nueva válida, cerrar la sesión y confirmar que solo la nueva contraseña permite volver a entrar.

**Acceptance Scenarios**:

1. **Given** una persona autenticada, **When** confirma su contraseña actual y una contraseña nueva válida, **Then** la nueva reemplaza a la anterior.
2. **Given** una persona autenticada que ingresa incorrectamente su contraseña actual, **When** intenta modificarla, **Then** recibe un mensaje claro y su contraseña no cambia.
3. **Given** una persona que no está autenticada, **When** intenta abrir la modificación de contraseña, **Then** es dirigida al acceso o a la recuperación de contraseña.

### Edge Cases

- Un enlace de invitación o recuperación vence una hora después de emitirse; uno vencido, ya utilizado o manipulado no permite cambiar una contraseña ni iniciar sesión.
- Solicitudes repetidas de invitación o recuperación no invalidan una contraseña existente hasta que la persona complete un enlace válido.
- Una misma dirección de correo puede solicitar como máximo un enlace de invitación de reemplazo o recuperación cada 15 minutos.
- La aplicación no muestra, registra ni comunica contraseñas en texto legible, incluidos errores y auditorías.
- Si la actualización de contraseña falla, se conserva la contraseña anterior y se informa un error útil.
- Un usuario solo puede modificar su propia contraseña; ni administradores de organización ni superadministradores pueden hacerlo por él.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE permitir que una persona con una invitación vigente cree una contraseña propia antes de su primer acceso normal.
- **FR-001a**: El sistema DEBE ofrecer a una persona que no pudo completar una invitación un camino autoservicio para solicitar un nuevo enlace de acceso a su correo, sin requerir intervención de quien la invitó.
- **FR-002**: El sistema DEBE permitir iniciar sesión posteriormente con el correo invitado y la contraseña creada durante la aceptación.
- **FR-003**: El sistema DEBE ofrecer desde el acceso una opción para solicitar recuperación de contraseña por correo.
- **FR-004**: El sistema DEBE permitir a una persona que complete un enlace de recuperación vigente definir una contraseña nueva.
- **FR-005**: El sistema DEBE permitir a una persona autenticada cambiar su propia contraseña tras confirmar la contraseña actual.
- **FR-006**: El sistema DEBE rechazar enlaces inválidos, vencidos o ya utilizados y contraseñas que no cumplan las reglas vigentes, sin cambiar credenciales.
- **FR-006a**: El sistema DEBE exigir en toda contraseña nueva un mínimo de 12 caracteres e inclusión de mayúscula, minúscula, número y símbolo.
- **FR-007**: El sistema DEBE responder de forma neutral a solicitudes de recuperación para no revelar si una dirección de correo tiene una cuenta.
- **FR-008**: El sistema DEBE asegurar que una operación efectiva de cambio de contraseña invalida la contraseña anterior, cierra las demás sesiones de la persona, conserva la sesión que completó el flujo y no revela ni persiste contraseñas en texto legible.
- **FR-009**: El sistema DEBE restringir la modificación de contraseña al titular autenticado o a una persona que demuestre control del enlace de invitación o recuperación; ningún rol administrativo puede cambiar contraseñas ajenas.
- **FR-010**: El sistema DEBE mostrar mensajes claros para enlaces inválidos, contraseñas inválidas, contraseña actual incorrecta y fallas temporales de entrega o actualización.
- **FR-011**: El sistema DEBE enviar a la persona titular un aviso por correo después de cada cambio efectivo de contraseña, sin incluir contraseñas ni enlaces sensibles.
- **FR-012**: El sistema DEBE limitar a un enlace de invitación de reemplazo o recuperación cada 15 minutos por dirección de correo.
- **FR-013**: El sistema DEBE limitar la vigencia de cada enlace de invitación o recuperación a una hora desde su emisión.

### Key Entities

- **Enlace de acceso**: vínculo de un solo uso y duración limitada enviado a una dirección de correo para aceptar una invitación o recuperar acceso.
- **Credencial de contraseña**: secreto elegido y administrado solo por la persona titular para iniciar sesión.
- **Solicitud de recuperación**: pedido de envío de un enlace de acceso, cuya respuesta pública no expone la existencia de una cuenta.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Una persona invitada completa la creación de su contraseña y un segundo inicio de sesión en menos de 3 minutos, sin asistencia de un administrador.
- **SC-002**: Una persona con una cuenta recupera el acceso y vuelve a iniciar sesión con una contraseña nueva en menos de 5 minutos desde la solicitud del correo.
- **SC-003**: El 100 % de los intentos con enlaces inválidos, vencidos o ya utilizados se rechaza sin cambiar una contraseña ni crear una sesión válida.
- **SC-004**: El 100 % de los cambios efectivos permite ingresar con la contraseña nueva y rechaza la anterior en la siguiente autenticación.
- **SC-005**: Ninguna pantalla, correo de respuesta, registro operativo o auditoría expone una contraseña en texto legible.

## Assumptions

- Se reutiliza el sistema de identidad y el correo de invitación existentes; esta entrega no incorpora registro público ni proveedores externos de acceso.
- La persona debe confirmar su contraseña actual para cambiarla desde una sesión autenticada; el enlace de recuperación es la alternativa si no la recuerda.
- Los enlaces de invitación y recuperación tienen la vigencia y el uso único definidos por el proveedor de identidad configurado para el producto.
- La regla de complejidad de 12 caracteres con mayúscula, minúscula, número y símbolo se aplica por igual en creación, recuperación y modificación.
- Quedan fuera de alcance el cambio de correo, la autenticación multifactor, el historial de contraseñas y la administración de credenciales por terceros.
