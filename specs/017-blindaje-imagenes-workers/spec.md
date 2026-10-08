# Blindaje y publicación de imágenes de workers

**Feature Branch**: `017-blindaje-imagenes-workers`

**Created**: 2026-09-22

**Status**: Draft

**Input**: Estandarizar el ciclo de build, publicación, ejecución y recuperación de los workers aislados sin fusionarlos en una única imagen.

**Alcance de entrega**: `workers`, `ci`, `kestra`, `infraestructura`. No cambia reglas de negocio ni integra ningún proveedor concreto.

**Origen**: Este patrón ya está validado en producción en un producto derivado real, con varios workers publicados, escaneados y ejecutados desde Kestra sin secretos filtrados — mismo precedente que spec 012 (convención de workers), que documentó su convención citando casos convergentes sin implementar ninguno.

## Clarifications

### Session 2026-09-21

- Q: ¿Qué severidad mínima debe bloquear la publicación de una imagen cuando el escaneo detecta vulnerabilidades? → A: Bloquear vulnerabilidades críticas y altas; permitir excepciones documentadas con vencimiento.

### Session 2026-09-22

- Q: ¿En qué sistemas operativos deben poder ejecutarse los workers? → A: Como contenedores Linux, con host Windows o Linux cuando el runtime soporte contenedores Linux; Linux es el destino preferido para producción.
- Q: ¿Qué arquitecturas de CPU deben soportar las imágenes de workers en esta primera versión? → A: `amd64`; el soporte `arm64` queda para una fase posterior si aparece un servidor que lo requiera.

## User Scenarios & Testing

### User Story 1 - Publicar una versión confiable de un worker (Priority: P1)

Como responsable de plataforma, quiero construir y publicar cada worker como un artefacto independiente, reproducible y verificable para saber exactamente qué versión se ejecutará.

**Why this priority**: Una publicación no reproducible puede introducir cambios involuntarios o impedir un rollback.

**Independent Test**: Construir cada worker desde un checkout limpio, verificar su contenido y publicar una referencia inmutable para cada integración.

**Acceptance Scenarios**:

1. **Given** un checkout limpio y el lockfile versionado, **When** se construyen los workers, **Then** todos los artefactos se generan sin dependencias de archivos locales no versionados.
2. **Given** una versión construida, **When** se publica, **Then** cada worker tiene una referencia inmutable, un resultado de escaneo y metadatos de procedencia.
3. **Given** una vulnerabilidad que supera el umbral acordado, **When** se ejecuta el pipeline, **Then** la publicación se bloquea y queda registrado el motivo.

### User Story 2 - Ejecutar un worker aislado desde Kestra (Priority: P1)

Como operador de automatizaciones, quiero lanzar un worker puntual con los parámetros y secretos de runtime necesarios para que una integración no afecte a otra y no queden credenciales en el artefacto.

**Why this priority**: La ejecución aislada es la frontera de seguridad y confiabilidad entre proveedores y organizaciones.

**Independent Test**: Lanzar una ejecución controlada de cada worker desde Kestra y comprobar parámetros, permisos, salida, logs sanitizados y código de finalización.

**Acceptance Scenarios**:

1. **Given** una referencia de worker autorizada, **When** Kestra inicia la ejecución, **Then** el worker recibe solo los parámetros de esa ejecución y obtiene secretos únicamente durante el runtime.
2. **Given** un worker en ejecución, **When** termina correctamente o falla, **Then** devuelve un estado inequívoco, conserva evidencia útil y no expone secretos en logs.
3. **Given** una ejecución cancelada o vencida, **When** Kestra aplica el límite definido, **Then** el proceso se detiene y puede reintentarse sin dejar una ejecución duplicada.

### User Story 3 - Recuperar y diagnosticar una versión (Priority: P2)

Como responsable de operación, quiero identificar qué versión ejecutó un flow y volver a una versión anterior para resolver una regresión sin modificar los demás workers.

**Why this priority**: Un rollback acotado reduce el tiempo de recuperación y el blast radius de una publicación defectuosa.

**Independent Test**: Publicar dos versiones de un worker, provocar un fallo controlado en la segunda y volver a la primera usando su referencia exacta.

**Acceptance Scenarios**:

1. **Given** dos versiones disponibles, **When** una versión falla, **Then** la ejecución y los logs identifican la versión exacta del worker.
2. **Given** una versión anterior conservada, **When** el operador solicita rollback, **Then** solo ese worker vuelve a la referencia anterior sin cambiar los restantes.
3. **Given** un reintento de la misma entrada, **When** el worker procesa la ejecución, **Then** la operación es idempotente y no duplica resultados.

### Edge Cases

- El registry no está disponible durante la publicación.
- El artefacto existe pero no coincide con el digest esperado.
- Un worker necesita escribir archivos temporales y el filesystem persistente está bloqueado.
- Un proveedor externo tarda más que el timeout o corta la conexión.
- Un reintento ocurre después de que el primer intento persistió parcialmente.
- La plataforma requiere ejecutar en una arquitectura de CPU distinta de la soportada.
- La imagen supera el umbral de tamaño o contiene una dependencia vulnerable transitoria.
- Un log contiene accidentalmente un valor con formato de secreto y debe quedar redactado.
- El proveedor cambia o amplía sus dominios: la ejecución debe fallar cerradamente hasta actualizar la allowlist versionada.

## Requirements

### Functional Requirements

- **FR-001**: El sistema MUST mantener una imagen o artefacto de ejecución independiente por worker e integración.
- **FR-002**: El sistema MUST generar los artefactos desde el código y lockfile versionados, sin depender de archivos locales no versionados.
- **FR-003**: El sistema MUST identificar cada artefacto por una referencia inmutable y conservar la relación entre worker, versión, commit y flow que lo ejecuta.
- **FR-003a**: El sistema MUST producir artefactos de contenedor Linux que puedan ejecutarse en hosts Windows o Linux cuando el runtime proporcione soporte para contenedores Linux.
- **FR-004**: El sistema MUST ejecutar los workers con el mínimo privilegio necesario y sin privilegios administrativos por defecto.
- **FR-005**: El sistema MUST mantener los secretos fuera del artefacto y entregarlos solo durante la ejecución autorizada.
- **FR-006**: El sistema MUST aplicar límites de tiempo, memoria y CPU, además de una política de red de salida con denegación por defecto y allowlist explícita por worker para Supabase, Vault y el proveedor externo necesario.
- **FR-007**: El sistema MUST producir logs y estados de ejecución útiles para diagnóstico sin incluir credenciales, tokens ni datos sensibles innecesarios.
- **FR-008**: El sistema MUST bloquear la publicación cuando el escaneo encuentre vulnerabilidades críticas o altas, salvo una excepción documentada, aprobada y con vencimiento.
- **FR-009**: El sistema MUST generar y conservar un inventario de componentes y metadatos de procedencia para cada artefacto publicado.
- **FR-010**: El sistema MUST permitir volver a una versión anterior por una referencia exacta sin reconstruirla ni modificar otros workers.
- **FR-011**: El sistema MUST mantener compatibilidad con la semántica actual de Kestra para parámetros, códigos de salida, timeout, cancelación, reintentos e idempotencia.
- **FR-012**: El sistema MUST ofrecer una ruta documentada para construir y ejecutar localmente cada worker con datos de prueba aislados, tanto en Docker Desktop/WSL2 sobre Windows como en Docker Engine sobre Linux.
- **FR-013**: El sistema MUST descubrir los workers declarados bajo `workers/`, comprobar en CI la construcción y ejecutar un smoke test de cada uno antes de publicar.
- **FR-014**: El sistema MUST conservar al menos una versión anterior utilizable por worker durante el período definido de recuperación.
- **FR-015**: Agregar un worker nuevo MUST requerir únicamente su paquete, código, contrato de ejecución y configuración de flow; no debe requerir duplicar el pipeline ni modificar una lista central de imágenes.

### Key Entities

- **Worker**: integración ejecutable con un proveedor externo, sus parámetros, permisos y contrato de salida.
- **Artefacto de ejecución**: versión inmutable del worker, con commit, componentes, digest y procedencia.
- **Ejecución**: intento de un worker asociado a una organización, flow, entrada, estado, timestamps, resultado y evidencia.
- **Política de publicación**: umbrales de seguridad, retención, permisos del registry y reglas de rollback.

## Success Criteria

### Measurable Outcomes

- **SC-001**: El 100% de los workers versionados se construye desde un checkout limpio en CI y pasa un smoke test antes de publicar.
- **SC-002**: El 100% de las ejecuciones auditadas identifica worker, versión exacta, flow, organización, estado, timestamps y código de salida.
- **SC-003**: Ninguna credencial de prueba aparece en los logs de 100 ejecuciones controladas de los workers.
- **SC-004**: Un rollback de un worker publicado se completa en menos de 10 minutos sin cambiar las versiones de los demás workers.
- **SC-005**: Una ejecución cancelada o reintentada no genera duplicados en el conjunto de pruebas de idempotencia.
- **SC-006**: El pipeline bloquea el 100% de las imágenes con vulnerabilidades críticas o altas, salvo excepciones documentadas, aprobadas y vigentes.
- **SC-007**: Un fallo intencional de un worker no interrumpe las ejecuciones de los otros workers en la prueba de aislamiento.
- **SC-008**: Un worker nuevo de fixture puede pasar de una carpeta vacía a una imagen publicada y un smoke test integrado sin cambios en la lógica central del pipeline.

## Assumptions

- Cada integración conserva su propia imagen y ciclo de versión; la spec no crea una imagen monolítica.
- Kestra continúa siendo el coordinador y los workers continúan siendo procesos aislados que ejecutan y terminan.
- Las credenciales reales se entregan por Vault o variables efímeras fuera del repositorio; la validación local usa fixtures o credenciales de sandbox.
- Los artefactos son contenedores Linux; Docker Desktop/WSL2 puede proporcionar ese runtime en desarrollo sobre Windows y Linux es el destino preferido en servidores.
- La arquitectura de CPU inicial es `amd64`; cualquier soporte `arm64` se decide antes de implementarlo.
- Las políticas de retención y el umbral exacto de vulnerabilidad se concretan en el plan sin ampliar el alcance funcional.
- No se agregan nuevos proveedores, tablas de negocio ni pantallas del panel.
- El template todavía no tiene ningún worker real bajo `workers/`; esta spec entrega el mecanismo (descubrimiento, imagen parametrizada, política de release, runtime endurecido) para que el primer worker real de cada producto derivado lo adopte sin construir nada de esto por su cuenta.
