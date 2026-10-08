# Feature Specification: Convención de Workers de Integración (Node + Kestra)

**Feature Branch**: `012-workers-conector-node-kestra`

**Created**: 2026-09-14

**Status**: Implemented

**Input**: User description: "Convención de workers técnicos para automatizaciones de integración: Node.js como lenguaje del worker (conectores que traen datos de sistemas externos vía API o automatización de navegador con Playwright), orquestado por Kestra (scheduling, reintentos, alertas — Kestra no reemplaza al worker, lo supervisa). Cada sistema externo tiene su propio conector. Los datos importados se normalizan en una tabla central por dominio, preservando el origen (columna `origen` + `id_externo` para idempotencia) y guardando los campos particulares de cada sistema en una columna `jsonb`, en vez de una tabla por sistema. Alcance basado en dos casos reales de dominios independientes ya confirmados en conversación (integración con Mercado Libre y con sistemas contables como Xubio/Colppy/Tango) — la spec documenta la convención y el contrato de worker (estructura de carpeta, Dockerfile, idempotencia, healthcheck) en `workers/README.md` y como guía reusable, sin incluir el dominio de negocio de ninguno de los dos casos (ni Mercado Libre ni contable)."

## Clarifications

### Session 2026-09-14

- Q: ¿Cómo debe manejar la convención las credenciales que cada conector necesita para acceder a su sistema externo (API keys, sesiones de navegador logueadas)? → A: La convención remite al principio de manejo de secretos ya existente en el proyecto (nunca en Git, solo en gestores de variables/vault por entorno) — no define un mecanismo de almacenamiento nuevo específico para conectores.
- Q: ¿La clave que evita duplicados al reimportar es la combinación de `origen` + `id_externo`, o alcanza con que `id_externo` sea único por sí solo? → A: Es la combinación `origen` + `id_externo` (clave compuesta) — ningún sistema externo controla los IDs de otro. *(Refinado durante `/speckit-plan`, Fase 1: la clave compuesta real es `organización` + `origen` + `id_externo` — ver FR-011 y `research.md` R4. Se detectó que `(origen, id_externo)` sin organización no aísla entre tenants distintos.)*
- Q: ¿Qué significa "healthcheck" para un worker que corre como proceso puntual disparado por Kestra (no un servicio persistente)? → A: Para ese tipo de worker, el healthcheck se cumple con el código de salida/estado que Kestra ya registra — no se requiere un endpoint HTTP separado. Un worker que sí sea un servicio persistente queda fuera de esta convención (FR-008) y ahí aplica un healthcheck tradicional.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Contrato claro para arrancar un worker nuevo (Priority: P1)

Quien va a construir un worker de integración con este template (persona o agente) necesita saber, antes de escribir la primera línea, qué se espera de ese worker: en qué lenguaje se escribe por defecto, cómo se estructura su carpeta, cómo se relaciona con Kestra, y qué garantías mínimas debe cumplir (idempotencia, healthcheck). Hoy esa información no existe más allá de una frase genérica en `workers/README.md`.

**Why this priority**: Sin este contrato, cada implementación reinventa su propia convención de worker, y las decisiones de diseño (idempotencia, estructura, healthcheck) quedan libradas al criterio de cada caso puntual — exactamente lo que esta convención busca evitar.

**Independent Test**: Se puede validar leyendo únicamente `workers/README.md` actualizado, sin que exista todavía ningún worker real construido, y verificando que alguien sin contexto previo puede describir correctamente la estructura y el contrato esperado de un worker nuevo.

**Acceptance Scenarios**:

1. **Given** alguien que va a crear un worker de integración por primera vez, **When** lee `workers/README.md`, **Then** encuentra especificado el runtime por defecto, la estructura de carpeta esperada, y el contrato de idempotencia y healthcheck.
2. **Given** un worker dedicado a un sistema externo que expone más de un tipo de dato o reporte, **When** se diseña, **Then** el documento aclara que cada tipo de dato se implementa como un conector propio dentro de ese worker, aislado de los demás conectores del mismo worker, y que cada conector elige su propio método de acceso (API o automatización de navegador) según lo que ese reporte permita.
3. **Given** alguien evaluando si Kestra por sí solo alcanza para una automatización, **When** consulta la convención, **Then** encuentra explícito que Kestra programa, reintenta y alerta, mientras que el worker ejecuta el trabajo técnico — uno no reemplaza al otro.

---

### User Story 2 - Normalizar datos de múltiples fuentes sin una tabla por sistema (Priority: P2)

Quien diseña el modelo de datos de varios workers (cada uno dedicado a su propio sistema externo) que producen información equivalente dentro del mismo dominio necesita un criterio para no terminar con una tabla distinta por cada sistema, ya que eso obliga a que todo lo que consuma esos datos conozca cada estructura por separado.

**Why this priority**: Depende de que exista el contrato general de worker (User Story 1), pero es la parte que más valor aporta cuando más de un sistema externo produce el mismo tipo de dato — es el problema concreto que motivó esta convención en los dos casos reales que la originaron.

**Independent Test**: Se puede validar diseñando en el papel el modelo de datos de dos workers hipotéticos, cada uno dedicado a un sistema externo distinto, usando solo la convención documentada, y verificando que el resultado no requiere una tabla por sistema.

**Acceptance Scenarios**:

1. **Given** dos o más workers, cada uno dedicado a un sistema externo distinto del mismo dominio, **When** se diseña la tabla de destino, **Then** la convención indica usar una tabla central con una columna de origen, un identificador externo para detectar duplicados, y una columna flexible para los datos propios de cada sistema que no comparten estructura común.
2. **Given** que un sistema externo ya integrado cambia su forma de acceso (por ejemplo, pasa de requerir automatización de navegador a ofrecer una API), **When** se actualiza su conector, **Then** la tabla central y el resto de los conectores no requieren ningún cambio.
3. **Given** que un worker vuelve a ejecutar la importación de un período ya procesado, **When** encuentra registros con el mismo origen e identificador externo, **Then** no los duplica.

---

### User Story 3 - Alcance explícito de la convención (Priority: P3)

Quien lea esta convención en el futuro, sin haber participado de la discusión que la originó, necesita entender por qué existe (qué la justifica como capacidad del template y no de un solo producto) y qué queda deliberadamente fuera de ella, para no asumir que cubre más de lo que cubre ni aplicarla donde no corresponde.

**Why this priority**: Es la garantía de que la convención se mantenga como lo que es — una guía de diseño acotada — y no se malinterprete como una plantilla de código lista para copiar o como cobertura de necesidades que en realidad siguen siendo específicas de cada implementación.

**Independent Test**: Se puede validar revisando que el documento nombra explícitamente los casos que la originaron y lista, sin ambigüedad, qué NO cubre.

**Acceptance Scenarios**:

1. **Given** alguien evaluando si esta convención ya resuelve la necesidad de un backend síncrono o de procesamiento en tiempo real para su producto, **When** consulta el documento, **Then** encuentra explícito que eso queda fuera de esta convención y sigue siendo una decisión propia de cada implementación.
2. **Given** alguien buscando el origen de esta convención, **When** lee el documento, **Then** encuentra que se basa en al menos dos automatizaciones de dominios de negocio independientes, sin que ninguno de esos dominios quede descrito en el propio documento.

---

### Edge Cases

- ¿Qué pasa si un worker nuevo necesita otro lenguaje distinto de Node.js porque su carga de trabajo lo justifica (por ejemplo, procesamiento de datos pesado)? La convención debe dejar Node.js como runtime *por defecto*, no como obligación absoluta.
- ¿Qué pasa si el sistema externo de un worker solo expone un único tipo de dato (un solo conector)? El patrón de tabla central aplica igual cuando hay más de un worker (más de un sistema) produciendo el mismo tipo de dato; con un solo worker y un solo tipo de dato, la convención no debe forzar una tabla central si no aporta valor.
- ¿Qué pasa si un conector necesita automatización de navegador? La convención debe indicar que se apoya en la infraestructura de Playwright ya existente en el template, sin requerir una imagen o servicio nuevo.
- ¿Qué pasa si una futura spec necesita procesamiento en tiempo real o un backend que sirva un frontend? Debe quedar claro que eso no está cubierto por esta convención.
- ¿Qué pasa si un mismo sistema externo produce más de un tipo de registro de negocio (por ejemplo, movimientos y balances de mayor)? Cada tipo se implementa como su propio conector dentro del worker de ese sistema, y tiene su propia tabla central — la convención no obliga a una única tabla por worker.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `workers/README.md` DEBE especificar Node.js + TypeScript como runtime por defecto recomendado para workers de integración con sistemas externos, sin prohibir el uso de otro lenguaje cuando un worker puntual lo justifique.
- **FR-002**: `workers/README.md` DEBE establecer que un worker se dedica a un único sistema externo, y que dentro de ese worker cada tipo de dato o reporte que ese sistema expone se implementa como un conector propio y aislado — cada conector elige su propio método de acceso (API o automatización de navegador) según lo que ese reporte puntual permita.
- **FR-003**: `workers/README.md` DEBE aclarar la relación entre Kestra y el worker: Kestra programa, reintenta y alerta; el worker ejecuta el trabajo técnico (llamadas a APIs, automatización de navegador, descarga y procesamiento de archivos, validación e importación). Uno no reemplaza al otro.
- **FR-004**: `workers/README.md` DEBE documentar el patrón de "tabla central" para normalizar datos de múltiples fuentes que representan el **mismo tipo de registro de negocio** (por ejemplo, movimientos contables, o balances de mayor — no "todo el dominio contable" en una sola tabla): columna de organización dueña del dato (multi-tenant, ver FR-011), columna de origen, identificador externo, y una columna flexible para los datos propios de cada fuente que no comparten estructura común. La combinación de organización + origen + identificador externo (no el identificador externo por sí solo, ni siquiera junto con origen sin la organización) es la clave que determina si un registro ya fue importado — dos organizaciones distintas pueden tener, cada una, un registro con el mismo `id_externo` en el mismo sistema de origen, sin ser el mismo dato.
- **FR-004b**: El documento DEBE aclarar que un worker puede alimentar **más de una tabla central** — una por cada tipo de registro de negocio distinto que su sistema externo exponga, a través de sus distintos conectores internos — y que un mismo conector puede escribir en más de una tabla central si el tipo de dato que trae mezcla más de un concepto de negocio.
- **FR-005**: El documento DEBE aclarar que la tabla central es una convención de diseño que cada spec que la implemente adapta a su propio dominio — no un esquema, migración ni tabla que el template provee directamente.
- **FR-006**: El documento DEBE extender el contrato de worker ya existente (carpeta propia, Dockerfile, salida idempotente, healthcheck, pruebas) sin duplicarlo ni contradecirlo. Para un worker que corre como proceso puntual disparado por Kestra (no un servicio persistente), el healthcheck se cumple con el código de salida/estado que Kestra ya registra — no se requiere un endpoint HTTP separado; esto no aplica a un worker que sea un servicio persistente, caso que de todas formas queda fuera de esta convención (FR-008).
- **FR-007**: El documento NO DEBE incluir ningún concepto de dominio de negocio de los casos que motivaron la convención — ninguna marca, empresa o sistema externo concreto por nombre, ni terminología propia de un dominio de negocio puntual.
- **FR-008**: El documento DEBE dejar fuera de su alcance, de forma explícita, el procesamiento en tiempo real disparado por eventos de usuario (colas como Redis/BullMQ) y cualquier backend síncrono que sirva a un frontend — indicando que siguen siendo decisiones propias de cada implementación.
- **FR-009**: El documento DEBE registrar que esta convención surge de al menos dos automatizaciones de dominios de negocio independientes, como justificación de por qué se documenta a nivel de template y no dentro de una implementación puntual.
- **FR-010**: El documento DEBE remitir, para las credenciales que cada conector necesite (API keys, sesiones de navegador logueadas u otro secreto de acceso al sistema externo), al manejo de secretos ya establecido para el proyecto (nunca en Git, solo en gestores de variables o vault por entorno) — sin definir un mecanismo de almacenamiento nuevo o específico para conectores.
- **FR-011**: El documento DEBE aclarar que la tabla central hereda el aislamiento multi-tenant ya establecido en el template (Principio I de la constitución): toda tabla central lleva una columna que identifica a la organización dueña de cada dato, con RLS activo — sin excepción por tratarse de datos importados por un worker en vez de ingresados por un usuario.

### Key Entities *(include if feature involves data)*

- **Worker de integración**: unidad de ejecución técnica dedicada a un único sistema externo, que un flow de Kestra dispara, responsable de correr uno o más conectores de ese sistema y de dejar los datos importados en estado consistente e idempotente.
- **Conector**: módulo dentro de un worker responsable de obtener un único tipo de dato o reporte del sistema externo al que ese worker está dedicado (vía API o automatización de navegador, según lo que ese reporte permita), sin conocer ni depender de los demás conectores del mismo worker.
- **Tabla central**: patrón de modelo de datos que un worker usa para normalizar registros provenientes de múltiples fuentes que representan el mismo tipo de registro de negocio (no todo un dominio entero), preservando la organización dueña del dato, el origen y un identificador externo por registro; la combinación de los tres (nunca el identificador externo solo, ni origen + identificador externo sin la organización) identifica un registro de forma única, y la organización es además la columna que habilita RLS como cualquier otra tabla del template. Un mismo worker puede tener varias tablas centrales — una por cada tipo de registro distinto que su sistema externo exponga, a través de sus distintos conectores — y un mismo conector puede alimentar más de una si el dato que trae mezcla más de un concepto de negocio.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Alguien sin contexto previo puede describir correctamente la estructura de carpeta, el runtime por defecto y el contrato de idempotencia/healthcheck de un worker nuevo leyendo únicamente `workers/README.md`.
- **SC-002**: Dos especificaciones distintas que implementen workers de integración llegan, sin coordinación directa entre sí, a estructuras de carpeta y contratos de entrada/salida consistentes entre ambas.
- **SC-003**: Una revisión del documento no encuentra ninguna marca, empresa o sistema externo concreto por nombre, ni terminología específica de un dominio de negocio particular.
- **SC-004**: Cuando un sistema externo integrado cambia su forma de acceso, el cambio necesario queda acotado al conector correspondiente, sin tocar el modelo de datos central ni otros conectores.

## Assumptions

- Esta convención es guía de diseño para cuando se abra una spec que la necesite — no es código, migración ni tabla reutilizable que el template provea directamente.
- Node.js + TypeScript queda como runtime por defecto porque ya es el lenguaje del resto del monorepo (`apps/web`) y porque los dos casos reales que motivaron esta convención lo confirmaron de forma independiente; no impide que un worker puntual use otro lenguaje si su carga de trabajo lo justifica.
- El patrón de tabla central se documenta como técnica de diseño, no como esquema fijo — cada implementación define sus propias columnas según su dominio.
- La automatización de navegador reutiliza la infraestructura de Playwright ya existente en el template (`infra/playwright`), sin requerir una imagen o servicio nuevo.
- Redis, BullMQ y cualquier backend HTTP síncrono para servir un frontend quedan explícitamente fuera de esta convención — siguen siendo decisiones propias de cada implementación, a incorporar al template solo si un futuro caso independiente confirma esa misma necesidad.
- La tabla central no es una excepción al aislamiento multi-tenant que ya rige el resto del template (Principio I): lleva columna de organización y RLS igual que cualquier tabla expuesta, aunque sus filas las escriba un worker y no un usuario desde la UI.
- Esta spec no cubre cómo Kestra llega a un worker que corre en un servidor distinto al de la plataforma, ni cómo se administran las credenciales de infraestructura (SSH, roles de base) cuando hay varias organizaciones con workers propios repartidos en servidores separados — eso es una capa de orquestación/despliegue distinta, cubierta por su propia spec.
