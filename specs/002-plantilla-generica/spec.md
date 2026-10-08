# Feature Specification: Plantilla genérica de producto de automatización

**Feature Branch**: `002-plantilla-generica`

**Created**: 2026-09-07

**Status**: Implemented

**Input**: User description: "Convertir el repo estudio-automation en automation-platform-template: una base reutilizable para productos de automatización multi-tenant. Alcance de esta spec: renombrar el proyecto de \"estudio-automation\" a \"automation-platform-template\" en todo el código, infraestructura Docker, documentación y el repo de GitHub (ya renombrado a Agenmatica/automation-platform-template), eliminando todo el lenguaje específico de \"estudios contables\" para que el template quede genérico. Incluye reescribir la constitución (título, Principio I en términos de aislamiento multi-tenant genérico en vez de \"seguridad contable\"), actualizar CLAUDE.md/AGENTS.md con las reglas nuevas acordadas en la conversación (commits en castellano, criterio de cuándo hace falta spec, licencias permisivas/código entregable, CI self-hosted), y reconstruir el runner self-hosted contra el repo renombrado. No incluye todavía las tablas de organizaciones/usuarios_organizacion ni la consola de superadmin (eso queda para specs separadas después)."

**Delivery scope**: transversal — esta spec es infraestructura/gobierno, no entrega funcionalidad de negocio en `refine | supabase | kestra | superset | workers`, así que no ocupa una fila específica de la tabla de `specs/README.md`.

## Clarifications

### Session 2026-09-07

- Q: Si algo falla a mitad del rename, ¿hace falta poder revertir a un estado limpio anterior, o alcanza con corregir hacia adelante? → A: Corregir hacia adelante, con commits incrementales por grupo lógico (paquetes → infra Docker → docs/constitución → runner), cada uno validado antes de seguir. No hace falta un mecanismo de rollback formal.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Repo sin lenguaje de un solo dominio (Priority: P1)

Como desarrollador de Agenmatica, quiero que el repo no tenga ningún nombre
ni lenguaje específico de "estudio contable" para poder usarlo como punto de
partida de cualquier producto de automatización nuevo sin limpiar
referencias a mano cada vez.

**Why this priority**: Sin esto, cada producto nuevo hereda referencias
incorrectas (nombres de proyecto Docker, textos de UI, principios de la
constitución) que hay que encontrar y corregir manualmente — el objetivo
central de tener una base reutilizable se pierde.

**Independent Test**: Clonar el repo, correr `pnpm install`, `pnpm lint`,
`pnpm build`, `pnpm test` y `pnpm infra:config`, y confirmar que ninguna
referencia a "estudio-automation" o "estudios contables" aparece en el
código, la documentación, ni en la salida de esos comandos.

**Acceptance Scenarios**:

1. **Given** el repo con el rename aplicado, **When** se busca el texto
   "estudio" en todo el código y la documentación, **Then** no aparece
   ninguna referencia al nombre viejo del proyecto ni a "estudio contable"
   (fuera del historial de commits previos, que no se reescribe).
2. **Given** los 5 productos Docker locales (`refine`, `kestra`, `superset`,
   `playwright`, `runner`) más Supabase, **When** se corre `pnpm dev:<producto>`
   / `pnpm dev:supabase`, **Then** cada proyecto Docker se levanta con el
   prefijo nuevo (`automation-platform-template-<producto>-dev`).

---

### User Story 2 - Gobierno del proyecto en términos genéricos (Priority: P2)

Como desarrollador, quiero que la constitución y las reglas de
`CLAUDE.md`/`AGENTS.md` describan principios de multi-tenancy y
automatización en general (no reglas específicas de contabilidad), para que
sirvan como gobierno de cualquier producto construido sobre esta base — y
que incorporen las reglas ya acordadas en esta sesión que hoy no están
escritas en ningún lado.

**Why this priority**: La constitución es lo que un agente (o una persona)
lee antes de implementar cualquier cosa nueva. Si sigue hablando de
"estudios contables", cualquier producto no-contable construido encima
arranca con reglas que no aplican, o las ignora.

**Independent Test**: Leer la constitución completa y confirmar que ningún
principio menciona "contable"; confirmar que sí describe el criterio de
aislamiento multi-tenant genérico, el criterio de cuándo una capacidad
necesita spec, y el principio de código entregable con licencias
permisivas.

**Acceptance Scenarios**:

1. **Given** la constitución actualizada, **When** se busca la palabra
   "contable", **Then** no aparece en ningún principio.
2. **Given** `CLAUDE.md` y `AGENTS.md`, **When** se comparan, **Then**
   contienen las mismas reglas de proyecto (solo difiere el encabezado que
   referencia Claude Code vs. Codex).
3. **Given** las reglas nuevas acordadas en esta sesión (commits en
   castellano, capacidad-vs-spec, licencias permisivas, CI self-hosted),
   **When** se revisan `CLAUDE.md`/`AGENTS.md`, **Then** las cuatro están
   presentes y son consistentes con cómo se trabajó durante la sesión.

---

### User Story 3 - Infraestructura de CI/runner alineada al nombre nuevo (Priority: P3)

Como desarrollador, quiero que el repo de GitHub y el runner self-hosted de
CI reflejen el nombre nuevo del proyecto, para que no haya inconsistencia
entre lo documentado y lo que realmente corre en producción de CI.

**Why this priority**: Es el eslabón que, si queda desalineado, hace que la
documentación mienta sobre dónde corre el CI — de menor impacto que el
contenido/gobierno (US1/US2), pero necesario para que el rename esté
completo de punta a punta.

**Independent Test**: Revisar en GitHub que el repo se llama
`Agenmatica/automation-platform-template`, que los 3 runners registrados
aparecen `online` bajo ese nombre (sin registros huérfanos del nombre
viejo), y que un push a `main` dispara una corrida de CI exitosa.

**Acceptance Scenarios**:

1. **Given** el repo ya renombrado en GitHub, **When** se reconstruye
   `infra/runner`, **Then** las 3 réplicas se registran contra
   `Agenmatica/automation-platform-template` y ninguna queda registrada
   contra el nombre viejo.
2. **Given** el runner reconstruido, **When** se hace push a `main`,
   **Then** los 3 jobs del workflow (`application`, `infrastructure`,
   `database`) terminan en éxito.

---

### Edge Cases

- ¿Qué pasa con los commits y branches ya existentes que mencionan
  "estudio-automation" en su historial? No se reescriben — el rename es
  hacia adelante, el historial previo queda como está.
- ¿Qué pasa si alguien tiene Supabase local o el runner corriendo con la
  configuración vieja al momento del rename? Hay que bajarlos
  (`pnpm dev:down:*`) y volver a levantarlos después del cambio — es un
  paso manual, no automático.
- ¿Qué pasa si un paso falla a mitad del rename (por ejemplo, el runner no
  logra re-registrarse tras haber tocado ya los archivos de código)? Se
  corrige hacia adelante, no se revierte — por eso el trabajo se hace en
  commits incrementales por grupo lógico, cada uno validado antes de pasar
  al siguiente, para que un fallo quede acotado a un grupo y no a todo el
  cambio junto.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE reemplazar toda referencia a
  `estudio-automation` / `@estudio/web` / "Estudio Automation" por
  `automation-platform-template` / `@platform/web` en: `package.json` (raíz
  y `apps/web`), todos los `infra/*/compose.yaml` (+ `infra/refine/Dockerfile`,
  `infra/runner/entrypoint.sh`), `supabase/config.toml`,
  `scripts/deploy-vps.sh`, `docs/architecture.md`, `docs/deployment.md`,
  `README.md`, `apps/web/src/App.tsx`, `.github/workflows/validate.yml`, y
  `supabase/tests/database/extensions.test.sql`.
- **FR-002**: La constitución DEBE reescribir el Principio I en términos de
  aislamiento multi-tenant genérico (usar "organización" en vez de
  "estudio"), sin lenguaje específico de contabilidad, y DEBE actualizar la
  lista de proyectos Docker del Principio IV con los nombres nuevos.
- **FR-003**: `CLAUDE.md` y `AGENTS.md` DEBEN incorporar, de forma idéntica
  entre ambos archivos: la regla de commits con título claro en castellano;
  el criterio de cuándo una capacidad/herramienta necesita spec (una
  extensión o imagen sin caso de uso de negocio no la necesita; la
  funcionalidad real que la use, sí); el principio de que lo entregado es
  código versionado con licencias que no restrinjan el uso comercial (y que
  los dashboards de Superset se exportan a YAML, no quedan solo en la UI); y
  la nota de que el CI corre en runners self-hosted, no en `ubuntu-latest`.
- **FR-004**: El repositorio remoto de GitHub DEBE llamarse
  `Agenmatica/automation-platform-template`, y el remoto git local (`origin`)
  DEBE apuntar a esa URL. *(Ya completado antes de esta spec.)*
- **FR-005**: El runner self-hosted (`infra/runner/`) DEBE reconstruirse y
  volver a registrarse contra el repo renombrado, sin dejar registros
  huérfanos bajo el nombre viejo.
- **FR-006**: Los proyectos Docker locales (`infra/<producto>/compose.yaml`,
  `supabase/config.toml`) DEBEN usar el prefijo `automation-platform-template-`
  en lugar de `estudio-automation-`; los proyectos Docker de VPS
  (`scripts/deploy-vps.sh`, `docs/deployment.md`) DEBEN usar el prefijo
  corto `platform-` en lugar de `estudio-`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Cero referencias a "estudio-automation" o "estudio contable"
  quedan en el código o la documentación tras el cambio (verificable con una
  búsqueda de texto sobre el repo).
- **SC-002**: Los cuatro comandos de validación (`pnpm lint`, `pnpm build`,
  `pnpm test`, `pnpm infra:config`) pasan sin errores después del rename.
- **SC-003**: El CI corre exitosamente (los 3 jobs en verde) contra el repo
  renombrado, en el runner self-hosted, en menos de 5 minutos totales.
- **SC-004**: `README.md` no contiene ninguna palabra del glosario
  contable-específico ("estudio contable", "CUIT", "razón social") en su
  título ni en su primer párrafo — verificable con `git grep`, mismo
  mecanismo que SC-001.

## Assumptions

- El nombre `automation-platform-template` y la decisión de renombrar
  también el repo de GitHub ya fueron tomados por el usuario; no son
  decisiones abiertas de esta spec.
- El historial de commits/branches previos con el nombre viejo no se
  reescribe.
- Las tablas de negocio (`organizaciones`, `usuarios_organizacion`) y la
  consola de superadmin quedan explícitamente fuera de esta spec — son
  specs separadas posteriores ("Fundación multi-tenant" y "Consola de
  superadmin").
- Se asume que nadie más clonó el repo con el nombre/remoto viejo todavía,
  por lo que no hace falta coordinar el rename con otros colaboradores.
