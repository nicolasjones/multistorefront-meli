# Feature Specification: Panel de funcionalidades por organización

**Feature Branch**: `009-panel-de-funcionalidades`

**Created**: 2026-09-10

**Status**: Implemented

**Input**: User description: "Panel de features por organización: el
superadmin necesita poder habilitar/deshabilitar funcionalidades por
organización (pensando a futuro en distintos planes contratados), pero
todavía no existe ninguna feature concreta que envolver — esto es
infraestructura de plataforma genérica, generalizando el patrón ya
validado en la spec 007-analitica-embebida (catálogo de reportes +
asignación por organización + auditoría) a 'cualquier feature futura'."

**Delivery scope**: refine | supabase

## Clarifications

### Session 2026-09-10

- Q: ¿Se arma ya una capa de "planes" (paquetes de funcionalidades) o
  alcanza con habilitar/deshabilitar cada una por separado? → A: Solo
  habilitación directa por organización. Un plan es, en esencia, un
  conjunto de habilitaciones con nombre — no hay todavía un caso de
  negocio real de precios o paquetes que justifique modelarlo. Se agrega
  después si aparece, sin romper este mecanismo.
- Q: ¿Quién da de alta una funcionalidad nueva en el catálogo? → A:
  únicamente el despliegue de código de la funcionalidad real que la
  construye — nunca una persona tipeando un nombre en una pantalla. Evita
  que el nombre que ve el superadmin no coincida con el que el código
  realmente verifica.
- Q: ¿Una organización puede ver el catálogo completo de funcionalidades,
  aunque no las tenga habilitadas? → A: No — solo ve las que tiene
  efectivamente habilitadas. Ver el catálogo completo filtraría a qué
  funcionalidades (y, a futuro, qué planes) tienen acceso otras
  organizaciones.
- Q: ¿Conviene integrar una herramienta externa de "feature flags"
  (LaunchDarkly, Unleash, y similares) en vez de construir esto? → A: No
  — esas herramientas resuelven un problema más grande (targeting por
  usuario individual, activaciones graduales, experimentación) del que
  hace falta acá, y de todas formas requerirían sincronizar su resultado
  hacia esta misma base para poder protegerlo a nivel de datos — sumarían
  un servicio más sin reemplazar lo que hay que construir igual.
- Q: ¿Las pantallas ya existentes del producto (clientes, miembros,
  analítica) se conectan a este mecanismo ahora? → A: No — quedan
  totalmente al margen en esta especificación. Conectarlas exigiría
  además pre-habilitar la funcionalidad para todas las organizaciones
  actuales, para no cortarles el acceso de un día para el otro; queda
  para si alguna vez hace falta, no como parte de esto.
- Q: ¿Qué debe ver el superadmin en la grilla el primer día, cuando el
  catálogo de funcionalidades todavía está vacío? → A: Un mensaje
  explícito indicando que todavía no hay funcionalidades registradas, no
  una tabla vacía sin contexto — mismo patrón que ya usa este producto
  para "sin reportes asignados" (spec 007).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - El superadmin habilita y deshabilita funcionalidades por organización (Priority: P1)

Como superadmin, veo en una sola pantalla qué funcionalidades del catálogo
tiene habilitada cada organización, y puedo habilitar o quitarle una
funcionalidad puntual a una organización puntual, sin afectar a las demás.

**Why this priority**: Es el único valor de negocio directo de esta
funcionalidad — sin esto, no hay forma de controlar qué organización
accede a qué, más allá de todo o nada.

**Independent Test**: Como superadmin, con al menos una funcionalidad ya
registrada en el catálogo (dada de alta por su propio despliegue de
código) y dos organizaciones existentes, habilitarla para una de las dos y
confirmar que solo esa queda habilitada; deshabilitarla y confirmar que
vuelve a quedar como si nunca se hubiera habilitado.

**Acceptance Scenarios**:

1. **Given** una funcionalidad registrada en el catálogo y dos
   organizaciones sin ninguna habilitación, **When** el superadmin habilita
   esa funcionalidad para la organización X, **Then** X queda habilitada y
   la organización Y permanece sin cambios.
2. **Given** una funcionalidad habilitada para la organización X,
   **When** el superadmin la deshabilita, **Then** X deja de tener esa
   funcionalidad habilitada, como si nunca se le hubiera dado.
3. **Given** una funcionalidad ya habilitada para la organización X,
   **When** el superadmin repite la misma acción de habilitarla,
   **Then** el estado no cambia y no se genera un registro de auditoría
   duplicado.
4. **Given** una organización con una funcionalidad habilitada, **When**
   esa organización se elimina del sistema, **Then** su habilitación
   desaparece con ella, sin afectar el catálogo ni a otras organizaciones.
5. **Given** un administrador de organización (no superadmin) autenticado,
   **When** intenta habilitar o deshabilitar una funcionalidad por
   cualquier medio, **Then** el sistema lo rechaza — es una capacidad
   exclusiva del superadmin.
6. **Given** el catálogo de funcionalidades sin ninguna entrada todavía,
   **When** el superadmin abre la pantalla, **Then** ve un mensaje
   explícito indicando que no hay funcionalidades registradas, no una
   tabla vacía sin contexto.

---

### User Story 2 - Una funcionalidad futura verifica si está habilitada (Priority: P2)

Como responsable de construir una funcionalidad nueva del producto, cuento
con una única forma confiable de preguntar "¿la organización de quien está
usando esto tiene esta funcionalidad habilitada?", usable tanto para
decidir qué mostrar en pantalla como para proteger los datos del lado del
servidor — no solo para ocultar un botón.

**Why this priority**: Es la razón de ser de construir esto de forma
genérica en vez de una vez por cada funcionalidad futura; sin esto, cada
funcionalidad nueva tendría que inventar su propio mecanismo de
habilitación por organización.

**Independent Test**: Con una funcionalidad de prueba registrada en el
catálogo y habilitada solo para la organización X, verificar que la
consulta de habilitación da un resultado positivo para alguien de X,
negativo para alguien de una organización Y sin habilitar, y negativo para
una organización recién creada sin ninguna habilitación registrada.

**Acceptance Scenarios**:

1. **Given** una funcionalidad habilitada para la organización X,
   **When** alguien de X consulta si la tiene habilitada, **Then** la
   respuesta es afirmativa.
2. **Given** esa misma funcionalidad sin habilitar para la organización Y,
   **When** alguien de Y hace la misma consulta, **Then** la respuesta es
   negativa, incluso si la funcionalidad está habilitada para X en ese
   mismo momento.
3. **Given** una organización recién creada, sin ninguna habilitación
   registrada todavía, **When** se consulta cualquier funcionalidad del
   catálogo, **Then** la respuesta es siempre negativa (nunca habilitada
   por defecto).
4. **Given** un superadmin operando dentro de una organización activa
   puntual, **When** consulta si esa organización tiene una funcionalidad
   habilitada, **Then** la respuesta corresponde a la organización activa
   en ese momento, no a una organización distinta.

### Edge Cases

- ¿Qué pasa si el superadmin intenta habilitar, para una organización, una
  funcionalidad cuyo nombre no existe en el catálogo? El sistema lo
  rechaza explícitamente, sin crear una habilitación "huérfana".
- ¿Qué pasa si el superadmin intenta habilitar una funcionalidad para una
  organización que no existe (o fue eliminada)? El sistema lo rechaza
  explícitamente.
- ¿Qué ve una organización que consulta el catálogo de funcionalidades sin
  tener ninguna habilitada? Ninguna — el catálogo completo nunca se
  expone a quien no tiene acceso a esas funcionalidades.
- ¿Qué ve el superadmin en la grilla mientras el catálogo de
  funcionalidades está vacío (el estado del primer día)? Un mensaje
  explícito indicando que todavía no hay funcionalidades registradas, no
  una tabla vacía sin contexto.
- ¿Qué pasa si dos personas con permiso intentan habilitar o deshabilitar
  la misma funcionalidad para la misma organización al mismo tiempo? El
  resultado final es consistente (habilitada o deshabilitada una sola vez)
  y no se duplica el registro de auditoría.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE mantener un catálogo de funcionalidades
  registrables, cada una identificada por un nombre estable, dado de alta
  únicamente por el despliegue de código de la funcionalidad real que lo
  usa — nunca por una pantalla de alta manual.
- **FR-002**: El sistema DEBE permitir únicamente al superadmin habilitar
  o deshabilitar, para una organización puntual, una funcionalidad del
  catálogo.
- **FR-003**: Una organización sin habilitación explícita para una
  funcionalidad DEBE tratarse como deshabilitada — nunca habilitada por
  defecto.
- **FR-004**: El sistema DEBE mostrar al superadmin, en una sola pantalla,
  qué funcionalidades tiene habilitadas cada organización existente, y
  permitir cambiarlo ahí mismo.
- **FR-005**: El sistema DEBE registrar quién habilitó o deshabilitó una
  funcionalidad para una organización, y cuándo, de forma permanente.
- **FR-006**: El sistema DEBE proveer una única forma confiable de
  consultar, para la organización de quien pregunta, si una funcionalidad
  puntual está habilitada — utilizable tanto para decidir qué mostrar en
  pantalla como para proteger datos del lado del servidor.
- **FR-007**: El sistema DEBE impedir que, al consultar si una
  funcionalidad está habilitada, el resultado revele información sobre la
  habilitación de una organización distinta a la de quien pregunta.
- **FR-008**: El sistema NO DEBE exponer a una organización el catálogo
  completo de funcionalidades existentes — solo debe poder ver las que
  tiene efectivamente habilitadas. El superadmin sí ve el catálogo
  completo, sin esta restricción.
- **FR-009**: El sistema DEBE resolver, para un superadmin operando dentro
  de una organización activa puntual, la habilitación según esa
  organización activa — nunca según una organización distinta.
- **FR-010**: El sistema NO DEBE permitir que un administrador de
  organización (no superadmin) habilite, deshabilite, ni registre
  funcionalidades — es una capacidad exclusiva del superadmin.
- **FR-011**: Al eliminarse una organización, el sistema DEBE dejar sin
  efecto todas sus habilitaciones, sin afectar el catálogo de
  funcionalidades ni las habilitaciones de otras organizaciones.
- **FR-012**: Repetir una habilitación o deshabilitación ya vigente NO
  DEBE generar un nuevo registro de auditoría duplicado.
- **FR-013**: Mientras el catálogo de funcionalidades no tenga ninguna
  entrada, el sistema DEBE mostrarle al superadmin un mensaje explícito
  indicándolo, en vez de una tabla vacía sin contexto.

### Key Entities

- **Funcionalidad**: entrada del catálogo interno, identificada por un
  nombre estable, dada de alta al construirse la funcionalidad real que la
  usa. Esta especificación no registra ninguna funcionalidad de negocio
  concreta — el catálogo arranca vacío.
- **Habilitación de funcionalidad por organización**: si una organización
  puntual tiene o no una funcionalidad del catálogo activa en este
  momento; su ausencia significa deshabilitada.
- **Registro de auditoría de funcionalidades**: quién habilitó o
  deshabilitó qué funcionalidad para qué organización, y cuándo.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El superadmin puede habilitar una funcionalidad para una
  organización sin ninguna intervención técnica adicional (sin desplegar
  código ni modificar datos a mano).
- **SC-002**: Ninguna organización puede determinar, por ningún medio, si
  otra organización tiene habilitada una funcionalidad, ni ver el catálogo
  completo de funcionalidades que ella misma no tiene.
- **SC-003**: El 100% de los cambios de habilitación quedan auditados con
  quién, qué organización, qué funcionalidad, y cuándo.
- **SC-004**: Una funcionalidad nueva del producto puede controlar su
  propio acceso por organización sin que este mecanismo genérico tenga que
  modificarse para ella.

## Assumptions

- No existe todavía ninguna funcionalidad real de negocio que use este
  mecanismo — esta especificación entrega el mecanismo de habilitación en
  sí, no una funcionalidad concreta a activar. El catálogo arranca vacío.
- No se modela agrupación de funcionalidades en "planes" (paquetes
  contratados) en esta versión — es una habilitación directa por
  organización. Agrupar en planes queda para una especificación futura, si
  aparece un caso de negocio real de precios o paquetes.
- Ninguna pantalla ya existente del producto (clientes, miembros,
  analítica, perfil personal) se conecta a este mecanismo en esta
  especificación.
- Una funcionalidad futura implementada fuera del producto principal (por
  ejemplo, una automatización que corre por su cuenta, sin que nadie esté
  usando el producto en ese momento) es responsable de consultar su propia
  habilitación — este mecanismo no lo hace en su nombre.
- Registrarse en el catálogo, y consultar la habilitación desde su propia
  regla de acceso a datos y su propia pantalla, es una acción explícita
  que cada funcionalidad futura debe tomar — ninguna funcionalidad nueva
  queda automáticamente controlada por este mecanismo solo por existir.
  Este mecanismo provee la capacidad (FR-006); no la impone.
- `organizaciones` (spec 003) sigue siendo el catálogo de referencia de
  organizaciones; esta funcionalidad no lo modifica, solo lo consume.
