# Feature Specification: Observabilidad de plataforma para workers de navegador

**Feature Branch**: `20260925-133820-observabilidad-workers-navegador`

**Created**: 2026-09-25

**Status**: Draft

**Delivery scope**: kestra | workers

**Input**: User description: "Generalizar en el template, sin conceptos de
negocio, el contrato de observabilidad que nació en un producto derivado:
contrato genérico de eventos por etapa y sanitización en `workers/CONTRATO.md`,
variables `EVIDENCIA_VISUAL` y `EVIDENCIA_RETENCION_DIAS`, flows plantilla que
publican logs y capturas como outputs de la ejecución de Kestra, un flow
genérico de limpieza programada de capturas vencidas, y su publicación como
versión nueva de la capacidad `worker-execution-cycle`."

**Origen**: spec `20260916-233205-observabilidad-evidencia-navegador` del
producto derivado `estudio-contable-automation` y la sección "Observabilidad de
automatizaciones de navegador" de su `workers/README.md`. Esta spec toma solo
la parte de plataforma: ningún nombre de sistema externo, etapa de negocio ni
dato de dominio entra al template.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Seguir y diagnosticar una ejecución desde Kestra (Priority: P1)

Como operador de un producto derivado, quiero que cualquier worker que respete
el contrato muestre en su ejecución de Kestra el avance por etapas y deje sus
logs publicados como output descargable, para saber en qué etapa está o dónde
falló sin leer código, sin abrir el panel y sin acceso al host de despacho.

**Why this priority**: es el valor mínimo de la observabilidad y no depende de
capturas: con solo eventos y logs publicados ya se diagnostica un fallo.

**Independent Test**: despachar con la plantilla un worker de prueba que emite
eventos del contrato (uno exitoso y uno fallido) y comprobar en la ejecución
real de Kestra los eventos en orden y un output con los logs de la tarea de
despacho, sin ningún valor secreto.

**Acceptance Scenarios**:

1. **Given** un worker que respeta el contrato, **When** avanza de etapa,
   **Then** la ejecución de Kestra muestra un evento con etapa, estado,
   timestamp, identificador de ejecución y mensaje sanitizado.
2. **Given** una ejecución que termina (con éxito o con error), **When** el
   operador abre sus outputs, **Then** encuentra un archivo con los logs del
   despacho de esa ejecución.
3. **Given** una ejecución fallida, **When** el operador revisa los eventos,
   **Then** identifica la última etapa completada y un motivo técnico sin
   credenciales, tokens, cookies ni datos de sesión.

---

### User Story 2 - Consultar capturas de hitos desde la ejecución (Priority: P1)

Como operador, quiero que, con la evidencia visual habilitada en el entorno,
las capturas de hitos que tome el worker queden adjuntas como outputs de la
misma ejecución de Kestra, también cuando la ejecución falla, para comprobar
visualmente qué vio el navegador.

**Why this priority**: la captura del momento del fallo es la evidencia más
útil para diagnosticar automatizaciones de navegador; sin publicación en
Kestra el operador tendría que entrar al host.

**Independent Test**: con la evidencia visual habilitada, despachar el worker
de prueba (éxito y error) y abrir desde los outputs de cada ejecución las
capturas que produjo; con la evidencia deshabilitada, verificar que no hay
capturas y que el resultado de negocio no cambia.

**Acceptance Scenarios**:

1. **Given** evidencia visual habilitada, **When** termina una ejecución
   exitosa o fallida, **Then** sus outputs contienen las capturas de hitos
   que tomó el worker, separadas de cualquier dato de negocio.
2. **Given** evidencia visual deshabilitada (valor por defecto), **When** se
   despacha un worker, **Then** no se generan ni publican capturas.
3. **Given** que la publicación de capturas falla, **When** termina la
   ejecución, **Then** el resultado de negocio (éxito, alerta de credencial o
   alerta técnica) es el mismo que sin evidencia.
4. **Given** capturas publicadas en Kestra, **When** termina la publicación,
   **Then** no quedan copias en el host de despacho.

---

### User Story 3 - Limpiar capturas vencidas sin tocar datos ni auditoría (Priority: P2)

Como responsable de la plataforma, quiero una limpieza programada que borre las
capturas más antiguas que el plazo de retención configurado, para acotar
almacenamiento y exposición de datos sin perder el registro de ejecuciones.

**Why this priority**: controla el riesgo acumulado de la evidencia, pero la
retención recién importa después de que existan capturas.

**Independent Test**: con capturas de ejecuciones vencidas y recientes,
ejecutar la limpieza dos veces; la primera borra solo las vencidas, la segunda
no borra nada y termina bien; las ejecuciones, sus logs y el registro de
auditoría siguen disponibles.

**Acceptance Scenarios**:

1. **Given** capturas con más antigüedad que el plazo, **When** corre la
   limpieza, **Then** esas capturas dejan de estar disponibles y las recientes
   permanecen.
2. **Given** una limpieza ya ejecutada, **When** vuelve a correr sin capturas
   nuevas vencidas, **Then** termina con éxito sin borrar nada.
3. **Given** ejecuciones cuyas capturas se limpiaron, **When** el operador las
   consulta, **Then** la ejecución, su estado, sus logs y el registro de
   auditoría de la base siguen disponibles.

---

### User Story 4 - Adoptar la capacidad en un producto derivado (Priority: P3)

Como responsable de un producto derivado, quiero recibir este cambio como una
versión nueva de una capacidad publicada del template, para saber que tengo
que adoptarla y qué contrato cambió.

**Why this priority**: es el canal de distribución; sin él el producto no se
entera, pero no aporta observabilidad por sí mismo.

**Independent Test**: la verificación de versiones del catálogo pasa con la
versión nueva y la verificación de adopción de un producto con la versión
anterior la informa como pendiente.

**Acceptance Scenarios**:

1. **Given** el catálogo publicado, **When** un producto compara su
   manifiesto, **Then** la capacidad aparece con versión nueva y su guía de
   adopción describe el contrato de observabilidad.

---

### Edge Cases

- Una captura que falla (o una carpeta de evidencia inaccesible) no aborta el
  worker: se registra como evento de etapa fallida de evidencia y la ejecución
  sigue.
- Si la publicación a Kestra falla, el worker no reintenta ni imprime datos
  binarios en los logs; las capturas residuales en el host se eliminan en un
  despacho posterior al vencer el plazo.
- Reintentos del despacho dentro de una misma ejecución acumulan capturas en
  la misma carpeta sin sobrescribirse entre intentos.
- En el despacho genérico en paralelo, las capturas de cada organización
  quedan separadas y no se mezclan entre organizaciones.
- Una línea de stdout que no es JSON o no respeta el formato no rompe la
  ejecución: queda como log común.
- Un plazo de retención inválido (no entero o negativo) hace fallar la
  limpieza sin borrar nada.
- Un worker sin navegador puede emitir eventos y nunca generar capturas.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El contrato de workers DEBE definir un evento por etapa emitido
  como una línea JSON en la salida estándar, con los campos `etapa`, `estado`,
  `timestamp`, `ejecucion` y `mensaje`, sin nombres de etapa de negocio
  obligatorios.
- **FR-002**: El contrato DEBE prohibir que eventos, logs, nombres de archivo o
  capturas contengan credenciales, tokens, cookies, contenido de
  almacenamiento de sesión o secretos, y DEBE indicar que los errores
  sanitizados van por la salida de error.
- **FR-003**: El contrato DEBE definir `EVIDENCIA_VISUAL` (deshabilitada por
  defecto) y `EVIDENCIA_RETENCION_DIAS` (30 por defecto), configurables por
  entorno sin cambiar código.
- **FR-004**: El contrato DEBE limitar las capturas a hitos (nunca por
  interacción ni por registro procesado), guardarlas en una ubicación de
  evidencia separada de archivos y datos de negocio, y establecer que un fallo
  de captura no cambia el resultado del worker.
- **FR-005**: Las plantillas de despacho genérica y dedicada DEBEN publicar
  como output de la ejecución de Kestra los logs de la tarea de despacho, en
  éxito y en error.
- **FR-006**: Con la evidencia visual habilitada, las plantillas DEBEN
  publicar como outputs de la ejecución las capturas producidas por el worker,
  en éxito y en error, separadas por organización en el despacho genérico.
- **FR-007**: Un fallo en la publicación de logs o capturas NO DEBE cambiar el
  estado de negocio de la ejecución ni la clasificación de alertas existente.
- **FR-008**: Las capturas publicadas DEBEN eliminarse del host de despacho
  una vez transferidas, y los residuos más antiguos que el plazo de retención
  DEBEN eliminarse en despachos posteriores al mismo host.
- **FR-009**: DEBE existir un flow genérico de limpieza programada que elimine
  la evidencia de ejecuciones más antiguas que `EVIDENCIA_RETENCION_DIAS`,
  idempotente, que nunca borre ejecuciones, logs, métricas, datos de negocio
  ni registros de auditoría.
- **FR-010**: El endurecimiento de runtime vigente del despacho (sistema de
  archivos de solo lectura, capabilities mínimas, red de egress, límites) DEBE
  mantenerse; la carpeta de evidencia es el único punto de escritura
  adicional y solo existe con la evidencia habilitada.
- **FR-011**: La capacidad `worker-execution-cycle` DEBE publicarse con una
  versión nueva en el catálogo, y su guía de adopción DEBE describir el
  contrato, las variables y la limpieza.
- **FR-012**: La validación DEBE incluir una ejecución real en el Kestra local
  del template de ambas plantillas y de la limpieza, verificando que ningún
  valor centinela secreto aparece en logs, outputs ni capturas publicadas.

### Key Entities

- **Evento de etapa**: etapa, estado, timestamp, identificador de ejecución y
  mensaje sanitizado; lo emite el worker y lo conserva Kestra en sus logs.
- **Evidencia visual**: captura de un hito asociada a una ejecución, una
  organización y una etapa; vive en Kestra como output hasta vencer.
- **Política de retención**: plazo en días y regla de limpieza que borra solo
  evidencia vencida.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El operador identifica la última etapa completada de una
  ejecución fallida en menos de 30 segundos desde la vista de la ejecución.
- **SC-002**: El 100% de las ejecuciones de prueba con evidencia habilitada
  (éxito y error) publican sus capturas y sus logs como outputs.
- **SC-003**: Ninguna aparición del centinela secreto en logs, outputs ni
  capturas de todas las ejecuciones de la validación real.
- **SC-004**: La limpieza elimina el 100% de la evidencia vencida, el 0% de la
  reciente, y conserva el 100% de ejecuciones y logs; una segunda corrida no
  elimina nada y termina con éxito.
- **SC-005**: Deshabilitar la evidencia o forzar su fallo no cambia el estado
  final de ninguna ejecución de prueba respecto del mismo escenario sin
  evidencia.

## Contrato con productos derivados

Respecto de la sección de observabilidad del `workers/README.md` del producto
de origen, esta spec **cambia** el contrato así (ver `research.md` R8):

1. Campos fijos del evento: `etapa`, `estado`
   (`iniciada|completada|fallida|omitida`), `timestamp` (ISO UTC),
   `ejecucion` (`EJECUCION_ID` o `KESTRA_EJECUCION_ID`) y `mensaje`; los
   campos extra del producto se permiten si están sanitizados.
2. Las capturas se escriben en `EVIDENCIA_DIR` (`/evidencia`), carpeta que
   monta el flow; las publica Kestra como output.
3. `EVIDENCIA_RETENCION_DIAS` es de plataforma: el worker no la lee ni borra
   evidencia.
4. Un fallo de captura se informa como evento `evidencia/fallida` en stdout.

El producto `estudio-contable-automation` ya implementó sus workers contra
este contrato (rama `observabilidad-workers`, PR #34). Cualquier cambio
posterior debe anotarse aquí y avisarse antes de mergear.

## Assumptions

- La consulta operativa se hace exclusivamente en Kestra; Refine queda fuera
  de alcance.
- `EVIDENCIA_VISUAL` y `EVIDENCIA_RETENCION_DIAS` son configuración de
  plataforma por entorno (Kestra), que el despacho transmite al worker; el
  worker no borra evidencia por su cuenta: la retención es responsabilidad de
  la plataforma.
- La evidencia visual y los logs publicados viven en el almacenamiento interno
  de Kestra; los datos de negocio siguen el camino que ya defina cada worker
  (base de datos o almacenamiento propio) y nunca se guardan como evidencia.
- La limpieza actúa sobre la evidencia de los flows de despacho del namespace
  configurado; un producto que copie las plantillas a otro namespace copia
  también la limpieza con su namespace, igual que ya hace con las plantillas.
- Los nombres concretos de etapa, los hitos que se capturan y su verificación
  con sistemas externos reales pertenecen a cada producto derivado.
- No hay cambios de base de datos: la auditoría existente del ciclo de
  ejecuciones no se modifica.
