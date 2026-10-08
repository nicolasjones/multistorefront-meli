# Feature Specification: Capacidad de IA gobernada

**Feature Branch**: `016-capacidad-ia-gobernada`

**Created**: 2026-09-20

**Status**: Draft

**Input**: User description: "Una capacidad reutilizable y gobernada permite incorporar IA en la aplicación y en procesos aislados; la navegación será un consumidor futuro bajo políticas estrictas y auditables."

**Delivery scope**: refine | supabase | kestra | workers

## Alcance

Esta entrega aporta el núcleo común para casos de uso de IA de la plataforma: catálogo de proveedores, claves, descubrimiento y selección de modelos, contratos, políticas globales, límites, auditoría, retención y eventos sanitizados. Cada consumidor declara su contrato de entrada, salida, datos permitidos, acciones y verificadores en su propia spec; no duplica proveedores, secretos, límites ni auditoría.

Los proveedores, claves y modelos se administran globalmente; el superadmin solo puede elegir un proveedor del catálogo inicial: OpenAI, Anthropic/Claude, Google/Gemini, xAI/Grok, DeepSeek, Alibaba/Qwen, Zhipu/GLM, Moonshot/Kimi y Baidu/ERNIE. Los modelos se descubren para cada clave, sin nombres de modelo fijados en la interfaz. Cada política global selecciona un perfil principal y otro de fallback, que pueden pertenecer al mismo proveedor o a proveedores distintos. La capacidad conserva un contrato agnóstico de proveedor para ampliar el catálogo en una entrega posterior. Solo se habilitan proveedores que garanticen cero retención del contexto enviado. Las capturas están deshabilitadas por defecto.

## Clarifications

### Session 2026-09-20

- Q: ¿Quién puede configurar proveedores, claves y políticas? → A: Solo superadmin configura proveedores, claves, contratos y políticas globales; el administrador de organización no ve ni habilita esta capacidad.
- Q: ¿Qué se envía al proveedor? → A: Solo contexto estructural sanitizado, sin valores contables.
- Q: ¿Cuál es el límite por intervención? → A: Dos intentos y 90 segundos.
- Q: ¿Cuánto se conservan trazas y evidencias sanitizadas? → A: 90 días.
- Q: ¿Qué requisito de retención tiene un proveedor habilitado? → A: Cero retención del contexto enviado.
- Q: ¿Cómo se cargarán o rotarán las claves de proveedor? → A: Se configuran en un archivo local ignorado por Git o variables del entorno de despliegue; un script de aprovisionamiento autorizado las guarda en Vault. Refine no recibe ni administra claves y solo permite seleccionar proveedor, modelo principal y modelo de fallback.
- Q: Si el modelo principal falla, ¿cuándo puede usarse el modelo de fallback? → A: Solo ante error técnico, timeout o respuesta inválida del principal antes de producir una propuesta válida; ambos modelos comparten el límite total de dos intentos y 90 segundos. Una propuesta rechazada por política o verificador no habilita el fallback.
- Q: Cuando una intervención se agota, es incierta o queda bloqueada por política, ¿quién debe recibir y resolver la revisión humana? → A: Solo el superadmin recibe y resuelve las revisiones humanas en esta primera entrega; los administradores de organización no ven ni resuelven esos casos.
- Q: ¿Querés que el superadmin pueda agregar cualquier proveedor, o sólo elegir de ese catálogo inicial de proveedores conocidos? → A: Por ahora, el superadmin solo puede elegir proveedores de un catálogo inicial; la capacidad sigue siendo agnóstica y se podrá ampliar el catálogo en una entrega posterior.
- Q: ¿Esta spec debe entregar el núcleo general junto con el adaptador de navegación, o sólo el núcleo general? → A: Solo el núcleo general; navegación y cada caso de uso concreto se entregan en specs separadas.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Configurar una capacidad de IA reutilizable (Priority: P1)

El superadmin configura un proveedor del catálogo, carga su clave en Vault y elige modelos disponibles. Un consumidor futuro puede adoptar el núcleo declarando su contrato, sin volver a implementar transporte de claves, límites, auditoría o sanitización.

**Why this priority**: permite habilitar capacidades de IA consistentes sin que cada producto implemente su propia seguridad u operación.

**Independent Test**: se configura un proveedor y sus modelos desde la administración, y un consumidor fixture obtiene una configuración autorizada sin recibir la clave ni duplicar la auditoría.

**Acceptance Scenarios**:

1. **Given** un proveedor del catálogo y una clave válida, **When** el superadmin la configura, **Then** puede elegir modelos descubiertos sin que la clave vuelva a la interfaz.
2. **Given** un consumidor autorizado con un contrato declarado, **When** usa el núcleo, **Then** recibe sólo la configuración y el resultado sanitizados definidos por su política.

---

### User Story 2 - Gobernar proveedores, contratos y políticas globales (Priority: P1)

El superadmin selecciona proveedores, modelo principal y modelo de fallback, y administra contratos y políticas globales. Las claves se aprovisionan fuera de Refine hacia Vault. Los administradores de organización no ven ni administran esta capacidad.

**Why this priority**: las sesiones externas y las claves de IA requieren un límite de permisos independiente del poder de cada organización.

**Independent Test**: se comprueba que solo superadmin administra el catálogo, contratos y políticas globales; un administrador de organización no puede leerlos ni modificarlos.

**Acceptance Scenarios**:

1. **Given** una política global aprobada, **When** el superadmin la activa, **Then** no expone ni modifica la clave del proveedor.
2. **Given** un administrador de organización, **When** intenta leer o cambiar proveedor, modelo, contrato, política o interacción, **Then** el sistema lo rechaza y registra la decisión.

---

### User Story 3 - Auditar y gobernar una interacción de IA (Priority: P2)

El superadmin puede distinguir una interacción normal, rechazada o derivada a revisión humana y diagnosticarla con evidencia sanitizada, sin secretos ni contenido sensible; en esta primera entrega, es el único rol que recibe y resuelve esos casos.

**Why this priority**: el uso de IA solo es seguro si una interacción agotada o incierta deja trazabilidad útil y no se transforma en una dependencia silenciosa.

**Independent Test**: se ejecutan una interacción permitida, una rechazada y una agotada; el historial global muestra contrato, decisión, intentos y resultado solo al superadmin.

**Acceptance Scenarios**:

1. **Given** una interacción que excede el límite declarado por su política, **When** alcanza el límite, **Then** se detiene, pasa a revisión humana en menos de dos minutos y queda disponible solo para el superadmin.
2. **Given** una solicitud fuera del contrato activo, **When** se evalúa, **Then** se rechaza antes de producir un efecto y queda auditada.

### Edge Cases

- Si el proveedor no está disponible o su respuesta no coincide con el contrato, la interacción conserva el error original y finaliza de forma controlada.
- Si el modelo principal produce un error técnico, timeout o respuesta inválida antes de una respuesta válida, puede usarse una vez el modelo de fallback dentro del mismo límite; un rechazo de política o contrato finaliza la interacción sin fallback.
- Si un consumidor no tiene política activa o intenta datos/acciones fuera de su contrato, el núcleo rechaza antes de invocar al proveedor.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE poder ser adoptado por cualquier consumidor de IA mediante un contrato declarado de entrada, salida, datos permitidos, límites, acciones y verificadores propios.
- **FR-002**: El núcleo DEBE validar el contrato y la política activa antes de invocar un proveedor y rechazar una solicitud fuera de ellos.
- **FR-003**: Cada interacción DEBE limitarse a los datos, acciones, límites y resultados verificables definidos por su política activa.
- **FR-004**: El núcleo DEBE proveer sanitización, transporte seguro de claves, límites, auditoría y eventos comunes; los efectos de negocio concretos pertenecen al consumidor y a su propia spec.
- **FR-005**: El proveedor DEBE recibir exclusivamente los datos sanitizados permitidos por el contrato del consumidor; no DEBE recibir secretos, tokens, sesiones, capturas ni datos excluidos por esa política.
- **FR-006**: La respuesta del proveedor DEBE ajustarse al esquema de salida declarado y validarse contra contrato, política, límite y verificador del consumidor antes de producir un efecto.
- **FR-007**: Cada interacción DEBE limitarse a los intentos y tiempo definidos por su política; al agotarse o quedar incierta DEBE derivar a revisión humana exclusiva del superadmin.
- **FR-008**: Solo el superadmin DEBE elegir proveedores del catálogo inicial (OpenAI, Anthropic/Claude, Google/Gemini, xAI/Grok, DeepSeek, Alibaba/Qwen, Zhipu/GLM, Moonshot/Kimi y Baidu/ERNIE), descubrir modelos y crear perfiles reutilizables de proveedor+modelo. Cada política global DEBE seleccionar un perfil principal y un perfil de fallback, que pueden pertenecer al mismo proveedor o a proveedores distintos. Los administradores de organización no DEBEN ver ni administrar esta capacidad. La capacidad DEBE conservar un contrato agnóstico que permita incorporar proveedores al catálogo sin cambiar los contratos de consumidores.
- **FR-009**: Las claves de proveedor DEBEN configurarse exclusivamente mediante archivo local ignorado por Git o variables del entorno de despliegue y aprovisionarse a Vault por un script autorizado. Refine, el navegador, Kestra, logs, historial y artefactos de ejecución no DEBEN recibirlas; solo el runtime autorizado puede recuperarlas temporalmente de Vault para invocar al proveedor.
- **FR-010**: El sistema DEBE registrar interacción, decisión, contrato, intentos, timestamps, resultado y evidencia sanitizada; el detalle y evidencia DEBEN eliminarse a los 90 días, preservando agregados no sensibles.
- **FR-011**: La visibilidad de configuración e interacciones DEBE respetar RLS; solo superadmin ve y administra el alcance global, incluidas las revisiones humanas. Los administradores de organización no DEBEN ver ninguna configuración, política, interacción ni evidencia de IA.
- **FR-012**: Kestra DEBE recibir exclusivamente eventos JSON sanitizados, sin claves, sesiones, payload de proveedor ni datos excluidos por el contrato.
- **FR-013**: El perfil de fallback, del mismo u otro proveedor, solo DEBE invocarse ante error técnico, timeout o respuesta inválida del perfil principal antes de obtener una respuesta válida; DEBE consumir el mismo presupuesto definido por la política y no DEBE ejecutarse tras el rechazo de contrato, política o verificador.

### Key Entities

- **Proveedor de IA**: entrada global del catálogo inicial, con adaptador agnóstico, configuración y clave segura de un proveedor apto para cero retención.
- **Modelo descubierto**: modelo disponible para una clave de proveedor, con sus capacidades sanitizadas.
- **Configuración de modelo**: selección global de un modelo principal y un modelo de fallback pertenecientes al mismo proveedor habilitado.
- **Contrato de consumidor**: versión declarada de entradas, salidas, datos permitidos, acciones y verificadores para un caso de uso.
- **Política de IA**: versión global aprobada que vincula un contrato de consumidor, perfiles de modelo y límites.
- **Interacción de IA**: intento acotado asociado a un consumidor y, cuando aplique, a una ejecución, con decisión, límites, resultado y evidencia sanitizada.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las solicitudes fuera de un contrato y política activos se rechaza antes de invocar al proveedor o producir un efecto del consumidor.
- **SC-002**: El 100% de las interacciones registra contrato, decisión, intentos, resultado y timestamps sin secretos ni datos excluidos por el contrato.
- **SC-003**: El 100% de las interacciones agotadas o inciertas se deriva a revisión humana en menos de dos minutos.
- **SC-004**: Un consumidor nuevo puede adoptar la capacidad declarando su contrato y verificadores, sin implementar transporte de claves, sanitización, límites ni auditoría propios.
- **SC-005**: Las pruebas de permisos confirman que un administrador de organización no puede acceder a configuraciones, contratos, políticas, interacciones ni evidencias de IA.

## Assumptions

- Cada consumidor aporta sus propios mecanismos de ejecución y concurrencia cuando los requiera.
- La adopción por un producto requiere una spec propia solo si agrega una acción de negocio o un recorrido fuera de su catálogo aprobado.
- Un proveedor no verificable en cero retención del contexto enviado queda inhabilitado.
- La primera implementación de producto proveerá los recorridos E2E, pero no forma parte de esta spec del template.
