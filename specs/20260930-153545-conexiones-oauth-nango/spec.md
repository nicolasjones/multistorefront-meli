# Especificación: Conexiones OAuth de plataforma vía Nango

**Rama**: `nicolasjones/conexiones-oauth-nango`

**Creada**: 2026-09-30

**Estado**: Draft

**Alcance de entrega**: `supabase`, `refine`

**Input**: descripción de usuario: mecanismo genérico y reutilizable de "conexiones por OAuth" de plataforma, usando Nango self-hosted, para que cualquier producto derivado conecte servicios externos (Google, y a futuro Microsoft/SharePoint/Teams) mediante OAuth2 estándar, sin construir el conector de negocio concreto (eso lo hace cada producto).

## Escenarios de usuario y pruebas *(obligatorio)*

### Historia 1 - Conectar una cuenta externa con un login (Prioridad: P1)

Como persona de una organización cliente, necesito conectar mi propia cuenta de Google haciendo login una sola vez en la pantalla de consentimiento estándar de Google, para que el producto pueda operar con mis datos externos (por ejemplo, mis hojas de Google Sheets) sin que yo tenga que crear una cuenta dedicada ni pedirle a un administrador de Google Workspace que configure nada especial.

**Por qué esta prioridad**: sin esto no existe conexión que ningún producto derivado pueda usar; es el punto de entrada de todo el mecanismo.

**Prueba independiente**: con una integración OAuth habilitada (p. ej. Google) en el entorno de prueba, una persona con permisos inicia el flujo desde la organización, completa el consentimiento del proveedor y, al volver, ve la conexión como activa sin haber visto ni manejado ningún secreto.

**Criterios de aceptación**:

1. **Dado** que una integración OAuth está habilitada para la organización, **cuando** una persona con permisos inicia la conexión, **entonces** es redirigida a la pantalla de consentimiento estándar del proveedor externo.
2. **Dado** que la persona autoriza el acceso en el proveedor, **cuando** vuelve al producto, **entonces** la organización queda con una conexión activa para esa integración, visible en la interfaz.
3. **Dado** que la persona cancela o rechaza el consentimiento, **cuando** vuelve al producto, **entonces** no se crea ninguna conexión y el producto muestra un estado claro de que no se completó.

---

### Historia 2 - Un producto obtiene un token vigente sin manejar el refresh (Prioridad: P1)

Como backend o worker de un producto derivado, necesito pedir un access token vigente de una conexión ya establecida de una organización, para poder llamar la API externa (por ejemplo, Google Sheets) en su nombre, sin implementar yo mismo la renovación del token ni almacenar el secreto del proveedor.

**Por qué esta prioridad**: es el motivo de negocio de toda la funcionalidad — una conexión que nadie puede usar para operar no aporta valor. Junto con la Historia 1 forma el circuito mínimo completo (conectar → usar).

**Prueba independiente**: con una conexión activa de una organización, un proceso de backend de prueba sigue el contrato documentado, obtiene un token vigente y lo usa contra un endpoint del proveedor externo.

**Criterios de aceptación**:

1. **Dada** una conexión activa de una organización, **cuando** un backend autorizado la solicita, **entonces** recibe un access token vigente sin necesidad de conocer ni de manejar el refresh token.
2. **Dado** un access token ya vencido en el momento del pedido, **cuando** un backend lo solicita, **entonces** el sistema lo renueva automáticamente y entrega uno vigente, de forma transparente para quien lo pide.
3. **Dado** un backend que no pertenece a la organización dueña de la conexión, **cuando** intenta solicitar su token, **entonces** el pedido es rechazado.

---

### Historia 3 - Ver el estado de una conexión y volver a autorizarla (Prioridad: P2)

Como persona con permisos de gestión en una organización, necesito ver si una conexión OAuth está activa, expirada o revocada, y poder volver a autorizarla, para no depender de que el equipo técnico detecte y resuelva el problema por mí.

**Por qué esta prioridad**: sin visibilidad del estado, una conexión rota permanece invisible hasta que falla un proceso de negocio en el producto derivado; esto degrada la confianza en el mecanismo pero no bloquea el circuito mínimo de las Historias 1 y 2.

**Prueba independiente**: revocar el acceso desde el lado del proveedor externo (fuera del producto) y comprobar que la organización ve la conexión como no utilizable y puede iniciar una reautorización sin duplicar la integración.

**Criterios de aceptación**:

1. **Dada** una conexión activa, **cuando** una persona con permisos consulta su estado, **entonces** ve si está activa, con error o pendiente de reautorización.
2. **Dado** que el proveedor externo revocó el acceso o el refresh token dejó de ser válido, **cuando** un backend intenta usar la conexión, **entonces** el estado de la conexión pasa a reflejar el problema en vez de fallar en silencio.
3. **Dada** una conexión con error, **cuando** la persona repite el flujo de consentimiento, **entonces** la conexión existente se reautoriza sin crear una conexión duplicada para la misma organización e integración.

---

### Historia 4 - La plataforma habilita un nuevo tipo de proveedor sin tocar el producto (Prioridad: P3)

Como quien opera la plataforma (por ejemplo, Agenmatica), necesito registrar un nuevo tipo de integración OAuth (por ejemplo, Microsoft/SharePoint) en el motor compartido, para que cualquier producto derivado pueda ofrecerlo a sus organizaciones sin duplicar infraestructura de autenticación ni escribir de nuevo el flujo de conexión.

**Por qué esta prioridad**: valida que el mecanismo es realmente genérico y no quedó acoplado a Google; no es indispensable para el primer uso real (Google Sheets), por eso queda última.

**Prueba independiente**: dar de alta una integración de prueba (proveedor distinto de Google) en el motor de autenticación y confirmar que queda disponible para conectar desde el patrón genérico sin cambios de esquema ni de infraestructura.

**Criterios de aceptación**:

1. **Dado** un nuevo proveedor OAuth soportado por el motor de autenticación, **cuando** se registra como integración, **entonces** queda disponible para cualquier organización sin requerir una migración de esquema nueva.
2. **Dada** una integración deshabilitada por la plataforma, **cuando** una organización intenta conectarla, **entonces** el sistema lo impide con un mensaje claro.

### Casos límite

- El proveedor externo revoca el acceso o expira el refresh token mientras no hay ningún backend usándolo activamente (se detecta recién en el siguiente pedido de token).
- Dos personas de la misma organización intentan conectar la misma integración casi al mismo tiempo.
- El motor de autenticación (Nango) está caído o inaccesible en el momento en que un backend pide un token.
- El callback HTTPS de OAuth no está correctamente enrutado en el entorno del producto derivado (dominio/reverse proxy mal configurado).
- Faltan las credenciales de plataforma (client id/secret) del proveedor para una integración habilitada.
- Una organización es eliminada o pierde acceso mientras conserva una conexión activa.
- Un producto derivado pide un token para una integración que existe en el motor pero que esa organización nunca conectó.

## Requisitos *(obligatorio)*

### Requisitos funcionales

- **FR-001**: La plataforma DEBE ofrecer el motor de autenticación y proxy OAuth (Nango self-hosted) como infraestructura propia y aislada, con su propio ciclo de desarrollo y despliegue, sin mezclarse con la infraestructura de otros productos del template.
- **FR-002**: El sistema DEBE permitir que una persona con permisos de gestión en una organización inicie el flujo de consentimiento OAuth estándar de un proveedor habilitado, y quede la organización con una conexión activa al completarlo con éxito.
- **FR-003**: El sistema DEBE aislar las conexiones OAuth por organización: ninguna organización puede ver, listar ni usar la conexión de otra.
- **FR-004**: El sistema DEBE exponer un mecanismo para que un backend o worker de un producto derivado obtenga un access token vigente de una conexión activa de una organización específica, renovándolo automáticamente si venció, sin que el backend implemente lógica de refresh propia.
- **FR-005**: El sistema NO DEBE exponer al navegador secretos administrativos del motor de autenticación, credenciales de la integración (client id/secret del proveedor) ni tokens de acceso o refresh de ninguna conexión.
- **FR-006**: El sistema DEBE permitir registrar un nuevo tipo de integración OAuth (proveedor) de forma configurable en el motor de autenticación, sin requerir una migración de esquema por cada proveedor nuevo.
- **FR-007**: Una persona con permisos de gestión DEBE poder consultar el estado de cada conexión de su organización (activa, con error/expirada, no conectada) y volver a autorizarla sin crear un duplicado para la misma organización e integración.
- **FR-008**: El sistema DEBE registrar auditoría mínima de cada creación o reautorización de conexión: actor, organización, integración, resultado y fecha.
- **FR-009**: El contrato para pedir un access token vigente DEBE quedar documentado (entradas, salida y errores posibles) de forma que un producto derivado lo consuma sin leer el código fuente de esta implementación.
- **FR-010**: El flujo de callback OAuth DEBE poder colgarse del dominio/reverse proxy HTTPS que cada producto derivado ya opera en su propio entorno de staging o producción; el template no asume ni provee ese dominio.
- **FR-011**: El sistema DEBE mantener la convención del template de no usar un Compose raíz: la infraestructura de Nango vive en `infra/nango/compose.yaml`, con desarrollo local independiente del resto de los productos.
- **FR-012**: El sistema NO DEBE requerir que un cliente/estudio cree una cuenta dedicada del proveedor externo ni que un administrador de ese proveedor realice una configuración especial fuera del consentimiento OAuth estándar.

### Entidades clave

- **Integración OAuth**: un tipo de proveedor habilitado en el motor de autenticación (p. ej. "Google"), con sus alcances (scopes) y si está habilitada para uso general.
- **Conexión OAuth**: la autorización concreta de una organización para una integración: a qué integración corresponde, qué organización la posee, su estado (activa, con error, pendiente de reautorización) y una referencia opaca hacia la credencial gestionada por el motor de autenticación — nunca el secreto ni el token en sí.
- **Evento de conexión**: registro de auditoría de una creación o reautorización de conexión (actor, organización, integración, resultado, fecha).

## Criterios de éxito *(obligatorio)*

### Resultados medibles

- **SC-001**: Una persona sin conocimiento técnico completa la conexión de su cuenta de Google en menos de 2 minutos, sin asistencia del equipo que opera el producto.
- **SC-002**: El 100% de los pedidos de token contra una conexión activa devuelve un token vigente sin que el producto derivado implemente lógica de renovación propia.
- **SC-003**: Ninguna organización puede leer ni usar la conexión OAuth de otra organización, verificado con una prueba de aislamiento.
- **SC-004**: Agregar un nuevo tipo de proveedor OAuth no requiere cambiar el esquema de datos ya publicado ni el contrato de consumo ya documentado.
- **SC-005**: Una conexión revocada o irrecuperable se refleja como tal en el primer pedido de token posterior, en vez de fallar en silencio o exponer un error técnico sin contexto.
- **SC-006**: Un producto derivado que no participó en el diseño de esta spec puede implementar su primer conector real (Google Sheets) usando únicamente el contrato documentado, sin leer el código fuente de esta funcionalidad.

## Supuestos y límites

- El producto derivado ya opera un dominio HTTPS propio (reverse proxy) en su entorno de staging/producción; el template no provee ni asume ese dominio para el callback OAuth.
- Las credenciales OAuth de plataforma (client id/secret del proveedor externo, p. ej. Google) son secretos de quien opera el producto, gestionados igual que el resto de los secretos del template — nunca en Git, nunca las de un cliente/estudio.
- Existe un único conjunto de credenciales OAuth de plataforma por proveedor y por producto derivado (no un client id/secret distinto por organización/cliente).
- Iniciar, ver el estado y reautorizar una conexión requiere el mismo nivel de permisos que otras acciones de gestión de organización ya existentes en el template (roles con permisos administrativos y contexto de organización activo).
- La verificación formal de la pantalla de consentimiento ante el proveedor (p. ej. estado "Testing" de Google con usuarios de prueba) es un trámite posterior de cada producto derivado; no es parte de esta spec.
- El conector concreto de Google Sheets, con su lógica de negocio, tablas de dominio y flujo de Kestra, se implementa en el producto derivado que lo necesita, no en esta plantilla.
- El self-host gratuito del motor de autenticación (Nango) cubre autenticación OAuth y proxy de llamadas a la API del proveedor; capacidades pagas (syncs, functions, webhooks administrados) quedan fuera de esta spec.
- Un único conjunto de servicios de Nango self-hosted por producto derivado es suficiente; no se especifica una instancia compartida entre productos distintos.
