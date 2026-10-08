# Feature Specification: Orquestación de Workers Multi-Organización

**Feature Branch**: `013-orquestacion-multi-organizacion`

**Created**: 2026-09-14

**Status**: Implemented

**Input**: User description: "Arquitectura de despliegue y orquestación para workers de integración multi-organización, como capacidad del template complementaria a la convención de código de la spec 012 (workers-conector-node-kestra). A diferencia de la 012, esta spec no surge de dos casos independientes convergiendo — es una decisión explícita de incorporar esta arquitectura al template ahora. Alcance: Supabase, Kestra (una sola instancia central), Refine y Superset son compartidos entre organizaciones, reusando el multi-tenant ya existente del template (organizaciones + RLS). Los workers de integración, en cambio, se despliegan aislados por organización, cada uno en su propio servidor. Kestra despacha la ejecución del worker al servidor de la organización correspondiente mediante un task SSH (no mediante Kestra Worker Groups, que es función Enterprise no disponible en la edición open-source que usa este template). Dos niveles de flows: genéricos compartidos por tipo de conector (paralelo, no secuencial) y dedicados por organización para casos excepcionales. Gestión de secretos en tres niveles vía Supabase Vault. Control de acceso admin/superadmin para conexiones. Alertas centralizadas que distinguen falla técnica de falla de credencial. Aprovisionamiento manual documentado de una organización nueva. Código de workers en el mismo repo del producto, imagen construida una vez y distribuida bajo demanda. Testing de normalización con fixtures, sin perseguir cobertura realista de automatización de navegador. Continuidad documentada ante restauración de backups en un proyecto distinto."

## Clarifications

### Session 2026-09-15

- Q: ¿Cómo vuelve una conexión de "credencial inválida" a "activa" — automáticamente en la próxima ejecución exitosa, o necesita una acción explícita del administrador? → A: Automático — la próxima ejecución que complete sin error de credencial contra esa conexión limpia el estado inválido, sin acción manual adicional.
- Q: ¿El flow genérico debe correr todas las organizaciones activas en paralelo sin límite, o con un tope de concurrencia configurable? → A: Con un tope de concurrencia configurable — las organizaciones por encima del tope esperan turno dentro del mismo flow, sin bloquear el resto del recorrido.
- Q: ¿Cuántos reintentos debe hacer Kestra ante una falla técnica antes de disparar la alerta? → A: Reintentos limitados (por ejemplo 3, con backoff) antes de alertar — no en el primer intento fallido.
- Q: ¿Una organización puede tener más de una conexión activa al mismo sistema externo? → A: Sí — no hay restricción de unicidad por organización + sistema; una organización puede tener varias conexiones al mismo sistema externo (por ejemplo, dos cuentas distintas del mismo proveedor).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ejecutar el worker de una organización en su propio servidor (Priority: P1)

Quien opera la plataforma necesita que el trabajo de integración de una organización corra físicamente en la infraestructura de esa organización — no en el servidor central donde vive Supabase, Kestra, Refine y Superset — para que un problema de una organización (una falla, un volumen inesperado) no afecte a las demás, y para no exponer las credenciales de sistemas externos de una organización al resto de la plataforma.

**Why this priority**: Es el mecanismo base — sin esto, no hay forma de que las siguientes historias (flows compartidos, secretos por organización, alertas) tengan sentido.

**Independent Test**: Se puede validar documentando el mecanismo (Kestra despachando por SSH a un servidor remoto) y verificando, en una prueba controlada con un único servidor de ejemplo, que el trabajo efectivamente se ejecuta ahí y no en el servidor central.

**Acceptance Scenarios**:

1. **Given** una organización con su propio servidor de workers dado de alta, **When** Kestra dispara la ejecución de un conector para esa organización, **Then** el contenedor del worker corre en el servidor de esa organización, no en el servidor central.
2. **Given** que se evalúa cómo lograr este despacho remoto, **When** se revisa qué mecanismo de Kestra usar, **Then** la documentación es explícita en que se usa un mecanismo disponible en la edición open-source (no Kestra Worker Groups, exclusivo de la edición Enterprise).
3. **Given** dos organizaciones con servidores distintos, **When** ambas tienen ejecuciones corriendo al mismo tiempo, **Then** un problema de recursos en el servidor de una no afecta la ejecución en el servidor de la otra.

---

### User Story 2 - Un solo flow atendiendo a todas las organizaciones, en paralelo (Priority: P2)

Quien mantiene los flows de Kestra necesita que agregar una organización nueva a un conector ya existente no implique crear un flow nuevo — y que, cuando corresponda, varias organizaciones se procesen al mismo tiempo en vez de esperar su turno, ya que cada una corre en un servidor aislado sin motivo real para competir por turno.

**Why this priority**: Sin esto, la cantidad de flows crece sin control a medida que se suman organizaciones, y el tiempo total de una corrida crece innecesariamente si se procesan de a una.

**Independent Test**: Se puede validar con un flow de ejemplo que recorre una lista de organizaciones ficticias y verificando que las ejecuciones se solapan en el tiempo, no se esperan entre sí.

**Acceptance Scenarios**:

1. **Given** un conector que ya sirve a varias organizaciones sin necesidades particulares, **When** se agrega una organización nueva con el mismo comportamiento estándar, **Then** no hace falta crear ni modificar ningún flow — la organización nueva es recogida por el flow genérico existente.
2. **Given** un flow genérico procesando varias organizaciones, **When** se ejecuta, **Then** las organizaciones se procesan en paralelo, no una después de la otra.
3. **Given** una organización que necesita un comportamiento distinto al estándar de un conector, **When** se le da un flow dedicado, **Then** el flow genérico deja de procesarla, evitando que se ejecute dos veces para la misma organización.

---

### User Story 3 - Gestionar credenciales de forma segura, sin que crezcan sin control (Priority: P2)

Quien administra una organización necesita conectar sus sistemas externos sin que esa credencial quede expuesta en texto plano en ningún lugar del sistema, y quien opera la plataforma necesita que dar de alta una organización nueva no implique tocar la configuración central cada vez.

**Why this priority**: Es condición para que las historias anteriores sean seguras de operar a medida que crece la cantidad de organizaciones — sin esto, cada alta nueva sería trabajo manual creciente y un riesgo de seguridad acumulativo.

**Independent Test**: Se puede validar revisando que ninguna credencial (de negocio o de infraestructura) aparece en texto plano en una tabla común, en el código, ni en la configuración del orquestador central más allá de una única credencial fija que no varía por organización.

**Acceptance Scenarios**:

1. **Given** un administrador conectando un sistema externo desde el panel, **When** la credencial se guarda, **Then** queda cifrada, accesible solo mediante un mecanismo que primero valida que quien la pide tiene permiso sobre esa organización.
2. **Given** una organización nueva con su propio servidor, **When** se da de alta, **Then** sus credenciales de infraestructura (dirección del servidor, acceso remoto, credencial de base de datos) se registran cifradas, sin necesidad de modificar la configuración del orquestador central.
3. **Given** un miembro sin rol de administrador, **When** intenta ver o modificar una conexión, **Then** el sistema se lo impide, tanto en la interfaz como en el control de acceso a los datos.
4. **Given** ese mismo miembro sin rol de administrador, **When** consulta los datos ya importados por una conexión, **Then** puede verlos sin restricción adicional.

---

### User Story 4 - Enterarse cuando algo falla, y saber a quién le toca actuar (Priority: P3)

Quien opera la plataforma y quien administra una organización necesitan enterarse de una falla sin tener que revisar activamente el historial de ejecuciones — y necesitan que la notificación les diga si es algo que ellos pueden resolver (una credencial vencida) o algo que requiere intervención técnica.

**Why this priority**: Depende de que ya exista el mecanismo de ejecución distribuida (Historia 1); sin alertas, una falla puede pasar inadvertida por días.

**Independent Test**: Se puede validar provocando una falla de prueba de cada tipo (técnica y de credencial) y verificando que cada una llega a la audiencia correcta.

**Acceptance Scenarios**:

1. **Given** una ejecución que falla por un motivo técnico genérico, **When** el fallo ocurre, **Then** se notifica a quien opera la plataforma.
2. **Given** una ejecución que falla porque la credencial de un sistema externo ya no es válida, **When** el fallo ocurre, **Then** se notifica tanto al administrador de esa organización como a quien opera la plataforma, y el estado de esa conexión queda visible como inválido en el panel.
3. **Given** que existen varios flows distintos (genéricos y dedicados) que pueden fallar, **When** se diseña el mecanismo de alertas, **Then** es un mecanismo centralizado, no lógica repetida dentro de cada flow individual.

---

### User Story 5 - Dar de alta el servidor de una organización nueva (Priority: P3)

Quien opera la plataforma necesita un procedimiento claro para dejar operativo el servidor de workers de una organización que se suma, sin depender de una herramienta que hoy no existe ni se justifica construir.

**Why this priority**: Es necesario para que las historias anteriores tengan un punto de partida, pero es un procedimiento infrecuente — no bloquea el resto del diseño, se documenta al final.

**Independent Test**: Se puede validar siguiendo el procedimiento documentado paso a paso contra un servidor de prueba y verificando que, al terminar, ese servidor queda listo para recibir ejecuciones despachadas desde Kestra.

**Acceptance Scenarios**:

1. **Given** una organización nueva sin servidor todavía, **When** se sigue el procedimiento documentado, **Then** al finalizar existen credenciales de infraestructura acotadas (no acceso irrestricto) registradas para esa organización.
2. **Given** que el procedimiento es manual, **When** se documenta, **Then** queda explícito que no requiere ni justifica una herramienta o automatización propia todavía.

---

### Edge Cases

- ¿Qué pasa si el servidor de una organización no está disponible cuando le toca ejecutar? Se registra como una falla más (Historia 4), con el mismo mecanismo de reintento y alerta que cualquier otro fallo — no requiere un caso especial.
- ¿Qué pasa si se restaura una copia de seguridad de la base compartida en un proyecto distinto al original? Las credenciales cifradas no son recuperables en ese escenario — la respuesta documentada es reconectar cada sistema externo y regenerar las credenciales de infraestructura de cada organización, no mantener un procedimiento de recuperación de claves de cifrado.
- ¿Qué pasa si una organización todavía no tiene servidor aprovisionado pero ya intenta configurar una conexión? La gestión de conexiones no depende de que el servidor ya exista — pero la ejecución fallará (y alertará, Historia 4) hasta que el servidor esté dado de alta.
- ¿Qué pasa con la automatización de navegador (Playwright) en integración continua? No se persigue una cobertura realista contra el sistema externo real — se confía en el registro de estado por ejecución que ya exige la convención de worker (spec 012).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El template DEBE documentar que Supabase, Kestra, Refine y Superset son instancias únicas y compartidas entre organizaciones, reutilizando el multi-tenant ya existente (organizaciones + RLS) — mientras que los workers de integración se despliegan aislados, uno por organización.
- **FR-002**: El mecanismo de despacho de la ejecución de un worker hacia el servidor de su organización DEBE usar una capacidad disponible en la edición open-source de Kestra, no depender de una función exclusiva de la edición Enterprise.
- **FR-003**: El template DEBE documentar dos niveles de flow: genérico por tipo de conector (recorre todas las organizaciones con conexión activa sin necesidad de comportamiento particular) y dedicado por organización (para casos excepcionales), con una convención de nombres que los distinga.
- **FR-004**: El recorrido de organizaciones dentro de un flow genérico DEBE ejecutarse en paralelo, no secuencial — cada organización corre en un servidor aislado y no hay motivo para hacerlas esperar entre sí. El grado de paralelismo DEBE tener un tope de concurrencia configurable (no ilimitado); las organizaciones por encima del tope esperan turno dentro del mismo flow, sin bloquear el resto del recorrido.
- **FR-005**: El flow genérico DEBE excluir de su recorrido a cualquier organización que tenga un flow dedicado para ese mismo conector, para que no se procese dos veces.
- **FR-006**: Las credenciales de negocio de cada conexión a un sistema externo DEBEN guardarse cifradas, accesibles solo mediante un mecanismo que aplique primero el control de acceso ya existente antes de descifrar — nunca mediante acceso directo a una vista de secretos ya descifrados.
- **FR-007**: Las credenciales de infraestructura de cada organización (dirección de su servidor, credencial de acceso remoto, credencial de su rol de base de datos acotado) DEBEN guardarse con el mismo mecanismo de cifrado y control de acceso que las credenciales de negocio (FR-006), en vez de vivir en la configuración del orquestador central.
- **FR-008**: El orquestador central DEBE necesitar una única credencial propia hacia la base de datos compartida — esa credencial no crece ni se multiplica con cada organización nueva.
- **FR-009**: Gestionar conexiones (crear, ver, editar credenciales de negocio) DEBE quedar restringido a roles administradores de la organización y a superadmin, aplicado tanto en la interfaz como en el control de acceso a los datos — restringirlo solo en la interfaz no es suficiente.
- **FR-010**: La lectura de los datos ya importados por una conexión DEBE permanecer abierta a cualquier miembro de la organización, sin la restricción de rol que aplica a FR-009.
- **FR-011**: El template DEBE documentar un mecanismo centralizado de alertas — no lógica de notificación repetida dentro de cada flow individual.
- **FR-012**: El mecanismo de alertas DEBE distinguir una falla técnica genérica de una falla de credencial/autenticación, notificando a audiencias distintas: la primera únicamente a quien opera la plataforma, la segunda tanto al administrador de la organización afectada como a quien opera la plataforma. Una falla técnica DEBE alertar recién después de un número limitado de reintentos automáticos con backoff (por ejemplo, 3) — no en el primer intento fallido, para no generar ruido por fallas transitorias.
- **FR-013**: Una falla de credencial/autenticación DEBE reflejarse además como un estado visible en la gestión de conexiones de esa organización — no depender solo de que la notificación llegue y se lea. Ese estado inválido se limpia automáticamente en la próxima ejecución que complete sin error de credencial contra esa conexión, sin requerir una acción manual adicional del administrador.
- **FR-014**: El template DEBE documentar el procedimiento para dar de alta el servidor de workers de una organización nueva (generación y registro de sus credenciales de infraestructura acotadas) como procedimiento manual — no requiere ni justifica una herramienta automatizada todavía.
- **FR-015**: El código de los workers de un producto DEBE vivir en el mismo repositorio que el resto de ese producto — no requiere repositorios separados por worker salvo una necesidad concreta que lo justifique.
- **FR-016**: La imagen de cada worker DEBE construirse una sola vez y distribuirse bajo demanda a los servidores de las organizaciones que la necesiten — sin requerir un paso de despliegue activo hacia cada servidor de organización en cada actualización de versión.
- **FR-017**: La lógica de normalización de un conector (dato crudo del sistema externo → fila de tabla central) DEBE poder verificarse en integración continua usando datos de ejemplo grabados, sin depender de acceso en vivo al sistema externo real.
- **FR-018**: El template NO DEBE exigir cobertura de pruebas automatizadas realista, contra el sistema externo real, para la automatización de navegador — se apoya en el registro de estado por ejecución que ya exige la convención de worker (spec 012).
- **FR-019**: El template DEBE documentar que, ante la restauración de una copia de seguridad en un proyecto de base de datos distinto al original, las credenciales cifradas no son recuperables, y que la respuesta aceptada es reconectar cada sistema y regenerar las credenciales de infraestructura — no mantener un procedimiento de recuperación de claves de cifrado.
- **FR-020**: Esta spec DEBE registrar que, a diferencia de la spec 012, no se origina en dos casos de negocio independientes convergiendo — es una decisión explícita de incorporar esta arquitectura al template, y se documenta como tal sin fabricar una justificación de convergencia que no ocurrió.
- **FR-021**: Una organización DEBE poder tener más de una conexión activa al mismo sistema externo — la gestión de conexiones NO DEBE imponer una restricción de unicidad por organización + sistema externo.

### Key Entities *(include if feature involves data)*

- **Organización**: entidad multi-tenant ya existente en el template; en el alcance de esta spec, además es la dueña de un servidor propio para sus workers.
- **Servidor de organización**: la infraestructura donde corren los workers de una organización — dirección, credencial de acceso remoto y credencial de su rol de base de datos acotado, todas cifradas.
- **Conexión**: vínculo entre una organización y un sistema externo — credencial de negocio cifrada, estado (activa / error / credencial inválida), visible y gestionable solo por administradores de esa organización. El estado credencial inválida se limpia automáticamente ante la siguiente ejecución exitosa contra esa conexión, sin acción manual del administrador. Una organización puede tener más de una conexión activa al mismo sistema externo (por ejemplo, dos cuentas distintas del mismo proveedor) — no hay restricción de unicidad por organización + sistema.
- **Flow genérico**: definición de orquestación compartida por tipo de conector, que recorre en paralelo (hasta un tope de concurrencia configurable) todas las organizaciones con conexión activa y sin necesidad de comportamiento particular.
- **Flow dedicado**: definición de orquestación específica de una organización, para un comportamiento que no encaja en el flow genérico de ese conector.
- **Alerta**: notificación disparada ante un fallo de ejecución, clasificada por tipo (técnica / credencial) y dirigida a la audiencia que corresponde a ese tipo.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un fallo en el worker de una organización no interrumpe ni demora la ejecución de los workers de ninguna otra organización.
- **SC-002**: Agregar una organización nueva a un conector con comportamiento estándar no requiere crear, modificar ni redesplegar ningún flow de orquestación.
- **SC-003**: Ante una falla de credencial, el administrador de la organización afectada se entera sin tener que revisar el historial técnico de ejecuciones.
- **SC-004**: Ningún flow genérico deja de avanzar ni se bloquea por una organización que requiera un comportamiento distinto al estándar.
- **SC-005**: Un miembro sin rol de administrador puede consultar los datos ya importados de su organización, pero no puede ver ni modificar ninguna credencial de conexión.
- **SC-006**: Dar de alta una organización nueva no requiere modificar la configuración del orquestador central más allá de un registro de sus propias credenciales.

## Assumptions

- Se asume un servidor dedicado por organización para sus workers, no compartido entre organizaciones distintas — decisión de aislamiento y simplicidad operativa, revisable si el volumen conocido cambia sustancialmente.
- Kestra corre en su edición open-source/self-hosted; cualquier capacidad exclusiva de la edición Enterprise (como el ruteo nativo de tareas a servidores específicos) queda fuera del mecanismo que esta spec documenta.
- El cifrado de secretos se apoya en la extensión de bóveda de secretos ya disponible en el proyecto de base de datos compartido — no se introduce una herramienta externa nueva para esto.
- Esta spec no define el dominio de negocio de ninguna implementación concreta, siguiendo la misma regla de alcance que ya aplica la spec 012.
- Esta spec se documenta como una decisión explícita de plataforma — a diferencia de la spec 012, no surge de dos casos de negocio reales e independientes convergiendo en la misma necesidad.
- La audiencia "quien opera la plataforma" (Historia 4) es un destino de notificación configurable (canal de mensajería, correo, u otro) — esta spec no fija cuál en particular.
