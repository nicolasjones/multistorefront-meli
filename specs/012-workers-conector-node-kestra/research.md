# Research: Convención de Workers de Integración (Node + Kestra)

No quedaron `[NEEDS CLARIFICATION]` sin resolver en el Technical Context — las tres ambigüedades detectadas se resolvieron en `/speckit-clarify` (ver `## Clarifications` en `spec.md`). Este documento consolida esas decisiones y las que ya estaban implícitas en el pedido original, en el formato Decisión/Justificación/Alternativas.

## R1 — Dónde vive la convención

**Decisión**: Se extiende `workers/README.md`, no se crea un documento nuevo.

**Justificación**: Ese archivo ya es el lugar establecido para el contrato de worker en este template ("cada worker futuro vive en su propia carpeta con Dockerfile, contrato de entrada, salida idempotente, healthcheck y pruebas"). Esta convención es una extensión de ese mismo contrato, no un concepto aparte.

**Alternativas consideradas**: Un documento nuevo en `docs/` (rechazado — fragmenta la fuente de verdad del contrato de worker en dos lugares); anotarlo solo en la constitución (rechazado — la constitución es de principios de gobernanza, no de contratos técnicos de una carpeta puntual).

## R2 — Runtime por defecto

**Decisión**: Node.js + TypeScript, como recomendación por defecto, no como obligación.

**Justificación**: Ya es el lenguaje del resto del monorepo (`apps/web`), y los dos casos reales que motivaron esta convención llegaron a la misma elección de forma independiente. Node encaja mejor por sinergia de tooling (mismo `pnpm lint`/`build`/`test`, mismo runner de CI que ya instala Node), dejando Python como opción válida solo si la carga de trabajo de un worker puntual lo justifica.

**Alternativas consideradas**: Python (rechazado como default — el runner de CI no lo tiene instalado hoy y no hay sinergia de tooling con `apps/web`; sigue siendo válido caso por caso); forzar un único lenguaje sin excepciones (rechazado — contradice el principio de que cada worker es autónomo en su elección si el caso lo justifica).

## R3 — Relación Kestra/worker

**Decisión**: Kestra programa, reintenta y alerta; el worker ejecuta el trabajo técnico. No hay redundancia entre ambos.

**Justificación**: Es el patrón estándar de la industria (Airflow con `DockerOperator`/`KubernetesPodOperator`, Temporal con workflow/activity, Argo Workflows) — el orquestador nunca contiene la lógica pesada, siempre la delega a un proceso externo. Confirmado además por los dos casos reales: ambos describen exactamente este split sin haberlo acordado entre sí.

**Alternativas consideradas**: Que el worker incluya su propio scheduler (rechazado — duplicaría lo que Kestra ya resuelve: historial de ejecuciones, reintentos con backoff, triggers de schedule/webhook); que Kestra ejecute la lógica directamente vía `Script`/`Commands` tasks sin un worker aparte (válido solo para automatizaciones simples de una o dos tareas — hay una escalera de tres niveles de complejidad creciente: task nativo → script inline → worker dedicado; esta convención aplica al tercer nivel).

## R4 — Patrón de tabla central

**Decisión**: Columna de organización dueña del dato + `origen` + `id_externo` como clave compuesta de idempotencia (los tres, no un subconjunto), más una columna `jsonb` para los datos particulares de cada fuente. Documentado como técnica, no como esquema fijo.

**Justificación**: `/speckit-clarify` había confirmado que `id_externo` solo no alcanza (ningún sistema externo controla el espacio de IDs de otro). Durante el diseño de Fase 1 (`data-model.md`) se detectó que `(origen, id_externo)` tampoco alcanza en un template multi-tenant: dos organizaciones distintas pueden conectar cada una su propia cuenta del mismo sistema externo, y cada una le asigna sus propios `id_externo` — pueden coincidir en número sin ser el mismo dato. Sin la organización en la clave, un worker podría pisar o confundir datos entre organizaciones, y la tabla no tendría columna para aplicar RLS (Principio I de la constitución, que no tiene excepción para datos importados por un worker). La alternativa de una tabla por sistema fue además descartada en los dos casos reales porque obliga a que todo lo que consuma esos datos conozca cada estructura por separado.

**Alternativas consideradas**: Tabla por sistema externo (rechazada — no escala sin duplicar lógica de consumo); `id_externo` solo (rechazada en clarify — colisión entre fuentes distintas); `(origen, id_externo)` sin organización (rechazada durante el diseño de Fase 1 — colisión entre organizaciones distintas que comparten sistema externo, y sin columna para RLS).

**Precisión adicional (post-diseño)**: "mismo dominio" no significa "todo el dominio de negocio en una tabla" — significa un mismo *tipo de registro*. Los mismos sistemas externos integrados pueden producir varios tipos de dato distintos entre sí; cada tipo es su propia tabla central, con la misma técnica repetida (FR-004b). Un conector no está atado a una sola tabla de destino.

## R5 — Credenciales de conectores

**Decisión**: Remitir al principio de manejo de secretos ya existente en el proyecto (nunca en Git, solo en gestores de variables o vault por entorno), sin definir un mecanismo de almacenamiento nuevo específico para conectores.

**Justificación**: Confirmado por `/speckit-clarify`. Ya existe una regla transversal del proyecto para esto (CLAUDE.md: "No guardes secretos en Git; actualiza únicamente los archivos `.env.example`"); inventar un mecanismo paralelo específico de conectores duplicaría gobernanza sin necesidad.

**Alternativas consideradas**: Una tabla de credenciales cifradas como parte de esta convención (rechazada — es exactamente el tipo de decisión de modelo de datos que corresponde a cada implementación según su propio caso, no algo que el template deba fijar de antemano).

## R6 — Healthcheck en workers de ejecución puntual

**Decisión**: Para un worker que corre como proceso puntual disparado por Kestra, el healthcheck se cumple con el código de salida/estado que Kestra ya registra — no se requiere un endpoint HTTP separado.

**Justificación**: Confirmado por `/speckit-clarify`. El contrato de worker ya existente en `workers/README.md` exige healthcheck en términos generales, pero fue escrito antes de que existiera un caso concreto; los dos casos reales que motivaron esta convención son ambos de ejecución puntual (Kestra dispara, el worker corre y termina), no servicios persistentes.

**Alternativas consideradas**: Exigir un endpoint `/health` HTTP tradicional para todo worker (rechazada — no tiene sentido para un proceso que no queda corriendo esperando requests; sí aplicaría si alguna implementación construye un worker que además es un servicio persistente, caso que queda fuera de esta convención por FR-008).

## R7 — Automatización de navegador

**Decisión**: Reutilizar la infraestructura de Playwright ya existente en el template (`infra/playwright`), sin imagen ni servicio nuevos.

**Justificación**: El template ya tiene Playwright corriendo (hoy para E2E, roadmap ítem #8). Es la misma herramienta que un conector necesitaría para automatización de navegador cuando un sistema externo no ofrece API — no hay razón para duplicar esa infraestructura.

**Alternativas consideradas**: Una imagen de Playwright separada por worker (rechazada — infraestructura duplicada sin necesidad; el principio de simplicidad operativa aplica igual acá).
