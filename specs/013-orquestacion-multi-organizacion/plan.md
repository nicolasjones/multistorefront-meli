# Implementation Plan: Orquestación de Workers Multi-Organización

**Branch**: `013-orquestacion-multi-organizacion` | **Date**: 2026-09-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/013-orquestacion-multi-organizacion/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Arquitectura de despliegue y orquestación para que cada organización corra sus
workers de integración en su propio servidor, mientras Supabase/Kestra/Refine/
Superset siguen siendo instancias únicas y compartidas. Kestra (edición
open-source) despacha por SSH hacia el servidor de cada organización — no usa
Worker Groups (Enterprise). Dos niveles de flow (genérico paralelo con tope de
concurrencia configurable, dedicado por excepción). Credenciales de negocio y
de infraestructura cifradas vía Supabase Vault, accesibles solo mediante
funciones `SECURITY DEFINER` que validan permisos antes de descifrar. Un rol
de Postgres dedicado por organización para que su worker escriba datos sin
depender de RLS basado en un claim que el propio worker podría falsificar.
Alertas centralizadas (subflow reusado) que distinguen falla técnica de falla
de credencial, con reintentos acotados antes de alertar. Aprovisionamiento de
servidor nuevo documentado como procedimiento manual. Imagen de worker
construida una vez (CI ya existente) y distribuida vía registro de
contenedores, sin paso de despliegue activo por organización.

## Technical Context

**Language/Version**: Sin lenguaje nuevo. SQL (migraciones Postgres) para el
esquema nuevo; YAML para los flows de Kestra (mismo patrón que
`infra/kestra/flows/respaldo-postgres.yml`, spec 011); TypeScript/React
(Refine, ya existente) para las pantallas de gestión de conexiones y
servidores.

**Primary Dependencies**: Kestra (ya existente) con su plugin de SSH para el
despacho remoto y su bloque `retry`/`errors` nativo para reintentos y
alertas; extensión `supabase_vault` de Postgres (disponible en la imagen de
Supabase, no usada todavía en este repo — primer uso, ver research.md R3);
Refine (ya existente) para las pantallas de administración.

**Storage**: Postgres/Supabase, esquema `public` (son tablas de plataforma,
no de dominio — no usan el esquema `dominio` habilitado en el chore previo).
Tablas nuevas: `servidores_organizacion`, `conexiones`,
`excepciones_flow_generico`, `alertas`. Un rol de Postgres nuevo por
organización (creado al aprovisionar su servidor) más un único rol de
servicio para Kestra (`kestra_orquestacion`, mismo patrón que
`kestra_backups` de la spec 011).

**Testing**: pgTAP para RLS de las tablas nuevas (Technology Gates de la
constitución); validación manual de los flows de Kestra vía `quickstart.md`
(mismo patrón que la spec 011, que tampoco tiene tests automatizados de
flows). La verificación de la lógica de normalización de conectores con
fixtures (FR-017/FR-018) es una convención para cada implementación futura,
no código de esta spec — se documenta como extensión de
`workers/README.md` (spec 012).

**Target Platform**: Servidor central (donde ya corren Supabase, Kestra,
Refine, Superset) más un servidor Docker por organización, alcanzable por
SSH desde el servidor central.

**Project Type**: Extensión de plataforma multi-componente (ya el patrón del
template) — no es un proyecto nuevo, toca Supabase + Kestra + Refine.

**Performance Goals**: El tope de concurrencia del flow genérico es
configurable (clarificado en `spec.md`) — esta spec no fija un número; el
default concreto se documenta en `research.md` R6 como punto de partida
razonable, ajustable sin cambiar código.

**Constraints**: No usar Kestra Worker Groups (Enterprise, FR-002); el rol de
Kestra hacia Supabase no debe crecer con cada organización (FR-008); las
migraciones son aditivas (Technology Gates); ninguna credencial en texto
plano fuera de Vault (FR-006/FR-007).

**Scale/Scope**: 4 tablas nuevas + funciones `SECURITY DEFINER` asociadas, 1
rol de servicio (`kestra_orquestacion`) + 1 rol por organización, 2-3 flows
de Kestra (genérico, subflow de alertas, plantilla de dedicado), 2 pantallas
nuevas en Refine (servidores, conexiones), 1 procedimiento documentado
(aprovisionamiento) en `docs/deployment.md`, 1 extensión de
`workers/README.md` (testing con fixtures).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio / Gate | Evaluación |
|---|---|
| I. Aislamiento multi-tenant por diseño | Cumplido — `servidores_organizacion`, `conexiones`, `excepciones_flow_generico` y `alertas` llevan `organizacion_id` y RLS (admin/superadmin para gestión, ver FR-009/FR-010). El acceso del worker a las tablas de dominio de su propia organización usa un rol de Postgres dedicado por organización en vez de un claim confiable únicamente por convención (research.md, decisión sobre roles por organización). |
| II. Especificar antes de implementar | Cumplido — esta es la spec (clarificada) que precede al cambio. |
| III. Automatizaciones idempotentes y auditables | Cumplido — cada ejecución queda registrada por Kestra; las alertas quedan auditadas en la tabla `alertas` (tipo, organización, motivo, momento); el estado de conexión (activa/error/credencial inválida) es el registro de auditoría mínimo por conexión. |
| IV. Un monorepo, despliegues independientes | Cumplido — el servidor de cada organización es su propio Compose/host, independiente del servidor central; ninguna organización nueva toca el Compose de otra. |
| V. Simplicidad operativa | Cumplido — SSH en vez de Worker Groups Enterprise (sin costo de licencia); aprovisionamiento manual documentado en vez de una herramienta nueva (FR-014); imagen de worker construida una vez y distribuida vía registro de contenedores ya cubierto por el CI existente, sin infraestructura de despliegue activo nueva. |
| Technology and Quality Gates (stack base, migraciones aditivas) | Cumplido — migración aditiva (crea tablas/roles/funciones, no destruye nada); RLS con prueba pgTAP para cada tabla nueva expuesta. |
| Delivery Workflow (PR al crear rama, merge `--no-ff`) | Cumplido — rama `013-orquestacion-multi-organizacion`, PR #19 abierto contra `main` desde `/speckit-specify` (mergeado en fase de spec; el trabajo de plan/tasks/implement de esta spec continúa en un PR nuevo, mismo patrón ya usado en la spec 012 tras el cierre temprano de su PR de spec). |

**Resultado**: PASS sin excepciones. No aplica Complexity Tracking — cada
pieza nueva (rol por organización, Vault, SSH) es la forma más simple
encontrada de cumplir un requisito ya aprobado en la spec, no una capa
agregada por preferencia técnica.

**Re-chequeo post-diseño (tras Fase 1)**: al diseñar `data-model.md` se
confirmó que las cuatro tablas nuevas (`servidores_organizacion`,
`conexiones`, `excepciones_flow_generico`, `alertas`) llevan RLS y que el
acceso del worker a datos de dominio se resuelve por rol de Postgres
dedicado, no por un claim propio (R5) — el Principio I queda cubierto sin
depender de que cada implementación futura lo recuerde por su cuenta.
`contracts/` y `quickstart.md` no introducen ningún servicio, dependencia
ni migración fuera de lo ya listado en Technical Context. Resultado final:
PASS sin excepciones.

## Project Structure

### Documentation (this feature)

```text
specs/013-orquestacion-multi-organizacion/
├── plan.md                          # This file (/speckit-plan command output)
├── research.md                      # Phase 0 output
├── data-model.md                    # Phase 1 output
├── quickstart.md                    # Phase 1 output
├── contracts/                       # Phase 1 output
│   ├── gestion-conexiones-y-servidores.md
│   ├── orquestacion-kestra.md
│   └── alertas.md
├── checklists/
│   └── requirements.md
└── tasks.md                         # Phase 2 output (/speckit-tasks command)
```

### Source Code (repository root)

```text
supabase/migrations/
└── <timestamp>_orquestacion_multi_organizacion.sql   # tablas, roles, funciones SECURITY DEFINER, RLS, pgTAP

infra/kestra/flows/
├── plantilla-generico.yml            # plantilla de flow genérico por tipo de conector (FR-003/FR-004/FR-005)
├── plantilla-dedicado.yml            # plantilla de flow dedicado por organización (excepción)
└── alertas.yml                       # subflow centralizado de alertas (FR-011/FR-012), reusado por los dos anteriores

apps/web/src/pages/servidores/        # alta y estado de servidores de organización (admin/superadmin)
apps/web/src/pages/conexiones/        # gestión de conexiones por organización (admin/superadmin), lectura de estado

docs/deployment.md                    # + sección "Servidores de organización": aprovisionamiento (FR-014) y continuidad ante restauración de backup en otro proyecto (FR-019)

workers/README.md                     # + subsección de testing con fixtures grabados para normalización (FR-017/FR-018), extendiendo el contrato de worker ya existente (spec 012) sin duplicarlo

.env.example                          # + KESTRA_ORQUESTACION_DB_URL/PASSWORD (mismo patrón que KESTRA_BACKUPS_*, spec 011)
```

**Structure Decision**: Extiende componentes ya existentes (Supabase,
Kestra, Refine, docs, `workers/README.md`) en vez de crear un proyecto o
servicio nuevo — coherente con que esta spec es una capacidad de
plataforma, no un producto aparte. Las tablas nuevas van en `public`
(esquema de plataforma), no en `dominio`: son mecanismo del template
(conexiones, servidores, alertas), no datos de negocio de un producto
derivado.

## Complexity Tracking

*No aplica — el Constitution Check no registró violaciones que requieran
justificación.*
