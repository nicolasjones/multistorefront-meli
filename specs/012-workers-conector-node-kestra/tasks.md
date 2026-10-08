# Tasks: Convención de Workers de Integración (Node + Kestra)

**Input**: Design documents from `/specs/012-workers-conector-node-kestra/`

**Prerequisites**: plan.md, spec.md (clarificada), research.md, data-model.md, contracts/workers-readme-contract.md, quickstart.md

**Tests**: No aplica testing automatizado — esta feature es una edición de documentación, sin código (ver `plan.md`, Testing: N/A). La verificación es manual, contra el contrato y el quickstart.

**Organización**: Tareas agrupadas por historia de usuario. Casi todas las tareas editan el mismo archivo (`workers/README.md`), así que se ejecutan en orden — no hay oportunidad real de paralelismo dentro de una historia.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Se puede paralelizar (archivos distintos, sin dependencias)
- **[Story]**: A qué historia de usuario pertenece (US1, US2, US3)

## Path Conventions

Todas las tareas de contenido editan `workers/README.md` (raíz del repo). Las tareas de verificación leen `specs/012-workers-conector-node-kestra/contracts/workers-readme-contract.md` sin modificarlo.

---

## Phase 1: Setup

**Propósito**: Entender el contrato de worker ya existente antes de extenderlo, para no duplicarlo ni contradecirlo (FR-006).

- [X] T001 Leer el contenido completo actual de `workers/README.md` e identificar dónde insertar la sección nueva de convención de integración sin duplicar el contrato ya existente (carpeta propia, Dockerfile, salida idempotente, healthcheck, pruebas).

**Checkpoint**: Se conoce la estructura actual del archivo y el punto de inserción.

---

## Phase 2: Foundational

**Propósito**: Dejar el esqueleto de la sección nueva, compartido por las tres historias.

**⚠️ CRÍTICO**: Ninguna historia empieza antes de este paso.

- [X] T002 Agregar en `workers/README.md` el encabezado y una introducción breve de la sección "Convención de workers de integración" (sin contenido de historias todavía), dejando lugar para las subsecciones siguientes.

**Checkpoint**: El esqueleto existe — las tres historias pueden completarse en orden de prioridad.

---

## Phase 3: User Story 1 - Contrato claro para arrancar un worker nuevo (Priority: P1) 🎯 MVP

**Goal**: Que alguien sin contexto previo pueda leer `workers/README.md` y saber, antes de escribir código, el runtime por defecto, cómo se organiza un worker con sus conectores, y la relación con Kestra.

**Independent Test**: Leer solo `workers/README.md` y describir correctamente esos tres puntos, sin necesidad de que exista ningún worker real construido (Independent Test de US1 en `spec.md`).

### Implementation for User Story 1

- [X] T003 [US1] Escribir en `workers/README.md` la subsección de runtime por defecto: Node.js + TypeScript, no obligatorio si un caso puntual justifica otro lenguaje (FR-001).
- [X] T004 [US1] Escribir en `workers/README.md` la subsección de organización worker/conector: un worker se dedica a un único sistema externo; cada tipo de dato o reporte de ese sistema es un conector propio y aislado, con su propio método de acceso — API o automatización de navegador (FR-002).
- [X] T005 [US1] Escribir en `workers/README.md` la subsección de relación Kestra/worker: Kestra programa, reintenta y alerta; el worker ejecuta el trabajo técnico; uno no reemplaza al otro (FR-003).
- [X] T006 [US1] Escribir en `workers/README.md`, integrada al contrato de worker ya existente (no como sección aparte), la aclaración de qué es healthcheck para un worker de ejecución puntual disparado por Kestra: código de salida/estado, sin endpoint HTTP separado (FR-006).
- [X] T007 [US1] Verificar manualmente las preguntas 1, 2, 3 y 6 de `contracts/workers-readme-contract.md` contra el texto recién escrito — cada una debe responderse sin ambigüedad.

**Checkpoint**: User Story 1 completa y verificable de forma independiente — ya es un incremento entregable (MVP).

---

## Phase 4: User Story 2 - Normalizar datos de múltiples fuentes sin una tabla por sistema (Priority: P2)

**Goal**: Que quien diseñe el modelo de datos de varios workers (cada uno de su propio sistema) sepa usar una tabla central en vez de una tabla por sistema.

**Independent Test**: Diseñar en el papel el modelo de datos de dos workers hipotéticos usando solo lo escrito en `workers/README.md`, y verificar que no hace falta una tabla por sistema (Independent Test de US2 en `spec.md`).

### Implementation for User Story 2

- [X] T008 [US2] Escribir en `workers/README.md` el patrón de tabla central: columna de organización, columna `origen`, columna `id_externo`, columna `jsonb` para datos particulares, y la clave compuesta de idempotencia `(organización, origen, id_externo)` (FR-004, FR-011).
- [X] T009 [US2] Escribir en `workers/README.md` la aclaración de que un worker puede alimentar más de una tabla central — una por cada tipo de dato que su sistema externo exponga, a través de sus distintos conectores (FR-004b).
- [X] T010 [US2] Escribir en `workers/README.md` la aclaración de que la tabla central es una convención de diseño que cada implementación adapta a su propio dominio — no un esquema que el template provee directamente (FR-005).
- [X] T011 [US2] Verificar manualmente las preguntas 4, 4b, 4c, 5 y 11 de `contracts/workers-readme-contract.md` contra el texto recién escrito.

**Checkpoint**: User Stories 1 y 2 funcionan juntas y de forma independiente.

---

## Phase 5: User Story 3 - Alcance explícito de la convención (Priority: P3)

**Goal**: Que quien lea la convención entienda por qué vive en el template y qué queda deliberadamente fuera, sin tener que haber participado del proceso de diseño.

**Independent Test**: Revisar que el documento registra el origen de la convención y lista sin ambigüedad qué NO cubre (Independent Test de US3 en `spec.md`).

### Implementation for User Story 3

- [X] T012 [US3] Escribir en `workers/README.md` el alcance excluido: procesamiento en tiempo real (colas como Redis/BullMQ) y backend HTTP síncrono para un frontend — decisiones propias de cada implementación (FR-008).
- [X] T013 [US3] Escribir en `workers/README.md` el origen de la convención: surge de al menos dos automatizaciones de dominios de negocio independientes, sin nombrar ninguno de los dos (FR-009).
- [X] T014 [US3] Escribir en `workers/README.md` la remisión al manejo de secretos ya existente en el proyecto para las credenciales de cada conector, sin definir un mecanismo nuevo (FR-010).
- [X] T015 [US3] Revisar el texto completo agregado en `workers/README.md` y confirmar que no aparece ninguna marca, empresa, sistema externo concreto ni terminología propia de un dominio de negocio puntual (FR-007, SC-003).
- [X] T016 [US3] Verificar manualmente las preguntas 7, 8, 9 y 10 de `contracts/workers-readme-contract.md` contra el texto recién escrito.

**Checkpoint**: Las tres historias de usuario funcionan, de forma independiente y en conjunto.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Propósito**: Validación final de punta a punta, no específica de ninguna historia.

- [X] T017 Correr la validación completa de `quickstart.md` (las 13 preguntas de `contracts/workers-readme-contract.md`, más la búsqueda de términos prohibidos) sobre el `workers/README.md` final.
- [X] T018 Confirmar que la sección nueva se lee como una extensión del contrato de worker ya existente, no como una segunda fuente de verdad paralela (Paso 4 de `quickstart.md`).
- [X] T019 Actualizar el campo `**Status**` de `spec.md` de `Draft` a `Implemented`.
- [X] T020 [P] Actualizar `checklists/requirements.md` (sección Feature Readiness) dejando registrado que la implementación se completó y validó contra el contrato.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias — arranca de inmediato.
- **Foundational (Phase 2)**: depende de Setup — bloquea a las tres historias.
- **User Story 1 (Phase 3)**: depende de Foundational. Sin dependencia de otras historias — es el MVP.
- **User Story 2 (Phase 4)**: depende de Foundational. Editorialmente sigue a US1 (mismo archivo, se escribe en orden), pero es conceptualmente independiente — no reescribe nada de US1.
- **User Story 3 (Phase 5)**: depende de Foundational. Mismo caso que US2: sigue en el archivo a US1/US2 por orden de escritura, pero no depende de su contenido.
- **Polish (Phase 6)**: depende de que las tres historias estén completas.

### Notas sobre paralelismo

Al ser una sola feature de un único archivo (`workers/README.md`), casi ninguna tarea admite paralelismo real dentro de una historia — escribirlas a la vez generaría conflictos de edición sobre el mismo archivo. La única tarea marcada `[P]` (T020) toca un archivo distinto (`checklists/requirements.md`) y no depende del contenido específico de ninguna tarea de escritura previa, solo de que la implementación haya terminado.

---

## Implementation Strategy

### MVP primero (User Story 1 únicamente)

1. Completar Fase 1: Setup.
2. Completar Fase 2: Foundational.
3. Completar Fase 3: User Story 1.
4. **Parar y validar**: correr T007 y confirmar que las preguntas 1, 2, 3 y 6 del contrato están bien respondidas.
5. Esto ya es un incremento entregable — el contrato básico del worker queda documentado aunque las historias 2 y 3 no estén.

### Entrega incremental

1. Setup + Foundational → esqueleto listo.
2. User Story 1 → validar → esto ya es MVP.
3. User Story 2 → validar → tabla central documentada.
4. User Story 3 → validar → alcance explícito documentado.
5. Polish → validación final de punta a punta con `quickstart.md`.

Dado que las tres historias terminan en el mismo archivo, "entrega incremental" acá significa commits separados por historia dentro de la misma rama/PR, no despliegues independientes.
