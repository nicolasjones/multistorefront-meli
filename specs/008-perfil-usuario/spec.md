# Feature Specification: Gestión del perfil personal

**Feature Branch**: `008-perfil-usuario`

**Created**: 2026-09-09

**Status**: Implemented

**Input**: User description: "Gestión del perfil del usuario activo: actualizar nombre, apellido y correo electrónico propio, con cambio de contraseña disponible desde el perfil."

**Delivery scope**: refine | supabase

## Clarifications

### Session 2026-09-09

- Q: ¿Quién debe poder ver la foto de perfil de una persona? → A: La ven personas de la misma organización.
- Q: ¿El listado debe incluir cada inicio de sesión exitoso, además de los cambios de contraseña y correo? → A: Cada inicio de sesión exitoso.
- Q: ¿Durante cuánto tiempo deben permanecer visibles los avisos de seguridad en el perfil? → A: Últimas 20 acciones de seguridad.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Consultar y actualizar datos personales (Priority: P1)

Como persona autenticada, puedo abrir una pantalla independiente de perfil y corregir mi nombre y apellido, para que la aplicación me identifique con datos personales actualizados.

**Why this priority**: Es la información básica de identidad visible y debe poder mantenerse sin intervención de un administrador.

**Independent Test**: Iniciar sesión, abrir el perfil, reemplazar nombre y apellido por valores válidos, guardar, volver a entrar al perfil y comprobar que se conservan los nuevos datos.

**Acceptance Scenarios**:

1. **Given** una persona autenticada, **When** abre desde la pantalla general la pantalla independiente de su perfil, **Then** ve su foto de perfil, nombre, apellido, correo electrónico actual y una opción para cambiar su contraseña.
2. **Given** una persona autenticada, **When** guarda un nombre y apellido válidos, **Then** solo sus propios datos personales se actualizan y se confirma el resultado.
3. **Given** una persona autenticada que deja vacío el nombre o el apellido, **When** intenta guardar, **Then** ve una indicación clara y no se actualizan sus datos.
4. **Given** una persona no autenticada, **When** intenta abrir un perfil por cualquier ruta, **Then** es dirigida al acceso y no se exponen datos personales.
5. **Given** una persona autenticada, **When** visualiza la pantalla general, **Then** encuentra una opción identificable para abrir su perfil personal.

---

### User Story 2 - Identificar la sesión activa en la pantalla general (Priority: P1)

Como persona autenticada, puedo ver en la pantalla general con qué cuenta estoy conectada, para confirmar la identidad con la que realizo las acciones de la aplicación.

**Why this priority**: Evita que una persona opere sin advertir que inició sesión con una cuenta distinta de la esperada y hace visible el acceso al perfil personal.

**Independent Test**: Iniciar sesión con una cuenta conocida, abrir la pantalla general y comprobar que se muestra “Logueado como” junto con la identidad de esa cuenta y un acceso al perfil.

**Acceptance Scenarios**:

1. **Given** una persona autenticada, **When** abre la pantalla general, **Then** ve el texto “Logueado como” junto con su nombre y apellido, o su correo electrónico cuando no haya nombre y apellido disponibles.
2. **Given** una persona autenticada, **When** selecciona el indicador o acceso de su identidad en la pantalla general, **Then** llega a su pantalla de perfil personal.
3. **Given** una persona cierra sesión o la sesión deja de ser válida, **When** la aplicación muestra el acceso, **Then** el indicador de identidad deja de mostrarse y no conserva datos de la cuenta anterior.

---

### User Story 3 - Cambiar el correo de acceso (Priority: P2)

Como persona autenticada, puedo solicitar el cambio de mi propio correo electrónico y confirmarlo desde el correo nuevo, para mantener vigente la dirección con la que accedo y recibo comunicaciones de seguridad.

**Why this priority**: El correo es un dato de identidad y un medio de recuperación; modificarlo sin verificaciones podría permitir perder el control de la cuenta.

**Independent Test**: Iniciar sesión, confirmar la contraseña actual, solicitar una dirección nueva disponible, completar la confirmación recibida en esa dirección y verificar que el acceso posterior usa el correo nuevo.

**Acceptance Scenarios**:

1. **Given** una persona autenticada que confirma su contraseña actual, **When** solicita una dirección de correo válida y disponible, **Then** recibe en la nueva dirección un enlace de confirmación y el correo de acceso anterior permanece vigente hasta completarlo.
2. **Given** una persona que abre dentro de la vigencia un enlace de confirmación enviado a la dirección nueva, **When** completa la confirmación, **Then** su correo de acceso cambia a la nueva dirección y recibe un aviso de seguridad en la dirección anterior.
3. **Given** una solicitud de cambio de correo sin contraseña actual válida, **When** la persona la confirma, **Then** el cambio se rechaza y no se envía una confirmación.
4. **Given** una dirección ya asociada a otra cuenta, una dirección inválida o un enlace inválido, vencido o usado, **When** se intenta solicitar o confirmar el cambio, **Then** el correo de acceso no cambia y se muestra un mensaje claro sin exponer datos de otras cuentas.

---

### User Story 4 - Personalizar la foto e identificar la cuenta (Priority: P2)

Como persona autenticada, puedo elegir o quitar mi foto de perfil y consultar los datos de mi cuenta sin modificarlos, para reconocer mi sesión y comprender a qué cuenta y organización corresponde.

**Why this priority**: La foto hace reconocible la cuenta en la aplicación, mientras que los datos de cuenta aclaran el contexto personal sin abrir una vía para cambiar permisos o pertenencias por error.

**Independent Test**: Iniciar sesión, cargar una imagen de perfil válida, confirmar que se muestra en el perfil, el indicador de sesión y el listado de miembros de la misma organización, quitarla y comprobar que se reemplaza por una representación neutra; verificar además que el resumen muestra los datos de cuenta sin controles para editar rol u organización.

**Acceptance Scenarios**:

1. **Given** una persona autenticada, **When** carga una imagen de perfil válida, **Then** la nueva foto queda asociada a su propio perfil, se muestra como su representación visual y puede verse por integrantes de su misma organización.
2. **Given** una persona autenticada con foto de perfil, **When** decide quitarla, **Then** la foto deja de mostrarse y la aplicación usa una representación neutra de su identidad.
3. **Given** una persona autenticada, **When** consulta los datos de su cuenta, **Then** ve en modo de solo lectura su correo de acceso, fecha de creación de la cuenta, organización y rol vigentes cuando corresponden.
4. **Given** una persona autenticada, **When** consulta su cuenta, **Then** no puede modificar desde esta sección su rol, organización, pertenencia ni datos de otra persona.
5. **Given** una persona intenta cargar un archivo que no puede utilizarse como foto de perfil, **When** confirma la carga, **Then** recibe una explicación clara y su foto anterior se conserva.
6. **Given** integrantes de una misma organización consultan el listado de miembros, **When** una persona tiene foto de perfil, **Then** pueden ver únicamente esa foto junto a su identificación existente, sin acceder a sus demás datos de perfil.

---

### User Story 5 - Consultar avisos de seguridad (Priority: P3)

Como persona autenticada, puedo consultar las últimas 20 acciones de seguridad de mi propia cuenta, para revisar mis inicios de sesión y cambios sensibles recientes y detectar acciones que no reconozco a tiempo.

**Why this priority**: Complementa las notificaciones por correo y da visibilidad dentro de la aplicación a los acontecimientos que afectan el control de la cuenta, sin introducir una gestión de sesiones.

**Independent Test**: Provocar un cambio efectivo de contraseña o correo, abrir el perfil y comprobar que aparece un aviso propio con tipo y momento; intentar acceder a los avisos de otra cuenta y verificar que no se muestran.

**Acceptance Scenarios**:

1. **Given** una persona que cambia su contraseña o confirma un cambio de correo, **When** abre sus avisos de seguridad, **Then** encuentra un aviso de ese cambio con su tipo y momento, sin secretos ni enlaces sensibles.
2. **Given** una persona que inició sesión correctamente, **When** abre sus avisos de seguridad, **Then** puede identificar sus inicios de sesión exitosos entre las últimas 20 acciones y cuándo ocurrieron, sin que ello le muestre ni le permita administrar sesiones activas.
3. **Given** una persona autenticada, **When** intenta consultar avisos de seguridad de otra cuenta por interfaz o acceso directo, **Then** la operación es rechazada y no se expone información ajena.

---

### User Story 6 - Administrar contraseña desde el perfil (Priority: P3)

Como persona autenticada, puedo acceder desde mi perfil al cambio de mi contraseña, para mantener mis credenciales desde un único lugar personal.

**Why this priority**: Completa la administración de identidad personal, reutilizando el flujo seguro de contraseña ya definido para la cuenta.

**Independent Test**: Desde el perfil, abrir el cambio de contraseña, confirmar la contraseña actual, definir una nueva válida y verificar que el flujo cumple los criterios de la especificación de autogestión de contraseña.

**Acceptance Scenarios**:

1. **Given** una persona autenticada, **When** selecciona cambiar su contraseña desde su perfil, **Then** accede al flujo de cambio de contraseña definido para su propia cuenta.
2. **Given** una persona que completa correctamente el cambio iniciado desde su perfil, **When** vuelve a iniciar sesión, **Then** la contraseña nueva funciona y se aplican las protecciones de sesión y avisos definidas para ese flujo.

### Edge Cases

- Guardar datos personales y cambiar el correo son operaciones independientes: un fallo en una no revierte un cambio ya confirmado de la otra.
- Solicitar como correo nuevo la misma dirección que ya está vigente no genera un enlace ni altera la cuenta.
- Mientras el cambio de correo está pendiente, el inicio de sesión, la recuperación de contraseña y las comunicaciones de seguridad continúan usando el correo anterior.
- Un enlace de confirmación de correo vencido, usado o manipulado no cambia ninguna dirección; la persona puede iniciar una nueva solicitud tras validar nuevamente su contraseña.
- Una persona solo puede consultar o actualizar su propio perfil, aun cuando tenga rol de administrador de organización o superadministrador.
- La aplicación no expone contraseñas, enlaces de confirmación ni direcciones de correo de otras personas en mensajes, registros operativos ni auditorías.
- La foto de perfil es opcional: si falta o se elimina, la aplicación conserva una representación neutra y no bloquea el acceso ni la actualización de los demás datos.
- Una foto rechazada o cuya actualización falle no reemplaza la foto de perfil anterior.
- Una persona de otra organización no puede consultar ni obtener la foto de perfil de integrantes ajenos.
- Los avisos de seguridad no dan acceso a sesiones activas ni permiten cerrar dispositivos; solo informan los inicios de sesión exitosos y acontecimientos sensibles de la propia cuenta.
- El listado de avisos se limita a las 20 acciones de seguridad más recientes; no incluye creación o edición de usuarios, clientes u otros datos operativos.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE ofrecer a toda persona autenticada una pantalla independiente de perfil personal con su nombre, apellido y correo electrónico vigentes, además de una opción para modificar su propia contraseña.
- **FR-002**: El sistema DEBE permitir a una persona autenticada actualizar únicamente su propio nombre y apellido, exigiendo que ambos tengan contenido válido.
- **FR-003**: El sistema DEBE impedir por interfaz y por controles de acceso que una persona consulte o modifique el perfil de otra.
- **FR-004**: El sistema DEBE exigir la contraseña actual válida antes de aceptar una solicitud de cambio de correo electrónico.
- **FR-005**: El sistema DEBE requerir que la nueva dirección de correo sea válida, distinta de la vigente y no esté asociada a otra cuenta antes de iniciar su confirmación.
- **FR-006**: El sistema DEBE enviar la confirmación del cambio únicamente a la nueva dirección solicitada y conservar el correo anterior como dirección de acceso hasta que la confirmación se complete con un enlace vigente de un solo uso.
- **FR-007**: El sistema DEBE cambiar el correo de acceso solo después de una confirmación válida y enviar un aviso de seguridad al correo que estaba vigente antes del cambio, sin incluir secretos ni enlaces sensibles.
- **FR-008**: El sistema DEBE rechazar sin cambios las confirmaciones de correo inválidas, vencidas o ya utilizadas y las solicitudes con contraseña actual incorrecta, dirección inválida o dirección ya asociada a otra cuenta.
- **FR-009**: El sistema DEBE hacer accesible desde el perfil el flujo de cambio de contraseña definido en la especificación `006-autogestion-contrasena`, sin debilitar sus reglas de contraseña, confirmación de contraseña actual, cierre de otras sesiones ni aviso de seguridad.
- **FR-010**: El sistema DEBE registrar cada cambio efectivo de correo como evento de seguridad con titular, momento y dirección anterior y nueva protegidas de exposición indebida; no debe registrar contraseñas ni enlaces de confirmación en texto legible.
- **FR-011**: El sistema DEBE informar claramente el estado de cada operación: datos personales guardados, confirmación de correo pendiente, correo confirmado, validación fallida o error temporal.
- **FR-012**: El sistema DEBE mostrar en la pantalla general de toda persona autenticada un indicador con el texto “Logueado como” y la identidad de la sesión activa: nombre y apellido cuando estén disponibles, o correo electrónico en caso contrario.
- **FR-013**: El sistema DEBE ofrecer desde la pantalla general un acceso identificable al perfil personal de la sesión activa y no debe conservar ni mostrar la identidad de una sesión anterior tras cerrarla o invalidarla.
- **FR-014**: El sistema DEBE permitir a una persona autenticada cargar, reemplazar o quitar únicamente su propia foto de perfil, y debe conservar la foto anterior si una carga no es válida o falla.
- **FR-015**: El sistema DEBE mostrar una representación neutra de identidad cuando una persona no tenga foto de perfil y no debe exigir una foto para usar la cuenta.
- **FR-016**: El sistema DEBE mostrar a cada persona autenticada, en modo de solo lectura, los datos de su propia cuenta: correo de acceso, fecha de creación, organización y rol vigentes cuando correspondan.
- **FR-017**: El sistema DEBE impedir que la sección de perfil permita cambiar roles, organización o pertenencias; esas decisiones permanecen en sus flujos de administración correspondientes.
- **FR-018**: El sistema DEBE mostrar a cada persona autenticada las 20 acciones de seguridad más recientes de su propia cuenta, incluyendo inicios de sesión exitosos y cambios efectivos de contraseña y correo.
- **FR-018a**: El sistema DEBE excluir del listado de avisos la creación o edición de usuarios, clientes y cualquier otra acción operativa que no sea un inicio de sesión exitoso o un cambio efectivo de contraseña o correo.
- **FR-019**: Cada aviso de seguridad DEBE indicar su tipo y momento, excluir contraseñas, enlaces, tokens y otros secretos, y no habilitar la consulta ni administración de sesiones activas.
- **FR-020**: El sistema DEBE permitir que la foto de perfil de una persona sea visible únicamente para ella y para integrantes de su misma organización, y debe impedir su consulta desde otras organizaciones por interfaz y acceso directo.
- **FR-021**: El sistema DEBE restringir los datos de cuenta y avisos de seguridad al titular de la cuenta, sin exponerlos a otras personas por interfaz ni acceso directo.

### Key Entities

- **Perfil personal**: datos de identidad que pertenecen a una única persona autenticada, incluyendo nombre, apellido y correo electrónico de acceso.
- **Solicitud de cambio de correo**: pedido autenticado de reemplazar la dirección de acceso, que requiere revalidar la contraseña actual y confirmar control de la nueva dirección.
- **Confirmación de correo**: enlace de un solo uso y duración limitada dirigido a la nueva dirección, que habilita el cambio efectivo del correo de acceso.
- **Evento de seguridad de perfil**: registro de un cambio efectivo de correo que permite trazabilidad sin revelar secretos.
- **Foto de perfil**: imagen opcional elegida por una persona para representar visualmente su propia cuenta.
- **Datos de cuenta**: resumen de solo lectura de los atributos vigentes de la cuenta y su pertenencia, sin controles para administrar permisos.
- **Aviso de seguridad**: comunicación visible para el titular sobre cada inicio de sesión exitoso o cambio sensible de su propia cuenta, sin capacidad de gestionar sesiones.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Una persona autenticada puede localizar y actualizar su nombre y apellido en menos de 2 minutos, sin asistencia de un administrador.
- **SC-002**: Una persona puede completar un cambio de correo confirmado y volver a iniciar sesión con la nueva dirección en menos de 5 minutos desde que inicia la solicitud.
- **SC-003**: El 100 % de los intentos de consultar o modificar datos de perfil, cuenta o avisos de seguridad ajenos se rechaza y no expone datos personales de terceros, excepto la foto de perfil autorizada para integrantes de la misma organización.
- **SC-004**: El 100 % de las solicitudes de cambio de correo sin revalidación de contraseña o sin confirmación válida conserva el correo de acceso anterior.
- **SC-005**: El 100 % de los cambios efectivos de correo genera un aviso de seguridad a la dirección anterior y un evento de trazabilidad, sin incluir secretos.
- **SC-006**: El 100 % de las personas autenticadas puede identificar la cuenta de su sesión activa y acceder a su perfil desde la pantalla general sin navegar por más de una opción.
- **SC-007**: Una persona puede cargar o quitar su foto de perfil y comprobar el resultado en menos de 2 minutos, sin afectar su acceso ni sus otros datos personales.
- **SC-008**: El 100 % de los inicios de sesión exitosos y cambios efectivos de correo o contraseña que estén entre las 20 acciones más recientes se refleja en los avisos de seguridad del titular, sin exponer secretos ni avisos de terceros.

## Assumptions

- Se reutiliza la identidad por correo y contraseña ya existente; no se incorporan registro público, proveedores externos de acceso ni autenticación multifactor.
- Nombre y apellido son obligatorios para una cuenta activa y se mantienen como datos personales separados.
- El enlace de confirmación de correo aplica la vigencia, uso único y protección contra reenvío definidos por el proveedor de identidad configurado.
- El aviso al correo anterior se envía solo después de que el nuevo correo fue confirmado con éxito; si no se puede entregar, el cambio no se revierte automáticamente.
- El cambio de contraseña ya está dentro de `006-autogestion-contrasena`; esta entrega solo lo incorpora como entrada desde el perfil, sin duplicar su lógica ni ampliar sus requisitos.
- La pantalla general es la primera pantalla que ve una persona tras autenticarse y contiene el indicador “Logueado como” y el acceso al perfil; no se define una ubicación visual específica dentro de ella.
- La foto de perfil sirve para representar a la persona dentro de su propia sesión y para identificarla ante integrantes de su misma organización en el listado de miembros; no es visible entre organizaciones ni habilita el acceso a sus demás datos de perfil.
- Los avisos de seguridad comprenden una vista de las 20 acciones de seguridad más recientes: inicios de sesión exitosos y cambios sensibles de la cuenta, además de las comunicaciones de seguridad ya requeridas; no incluyen acciones operativas, administración ni cierre de sesiones activas.
- Quedan fuera de alcance la edición de roles, organización o pertenencias, preferencias, eliminación de cuenta, autenticación multifactor, historial general de actividad y modificación de datos por terceros.
