# Implementation Plan: Ciclo de Ejecuciones de Workers

**Branch**: `016-ciclo-ejecuciones-workers` | **Date**: 2026-09-20 | **Spec**: [spec.md](./spec.md)

**Input**: Especificación en `specs/016-ciclo-ejecuciones-workers/spec.md` (alcance `refine | supabase | kestra | workers`).

## Summary

Capacidad genérica del template para que cualquier worker sea idempotente,
recuperable y observable sin reinventar locks ni historiales: dos tablas de
plataforma en `public` (`capacidades_ejecucion`, `ejecuciones_worker`) con
índice único parcial que garantiza como máximo una ejecución activa por
organización y capacidad (R1), cierre perezoso por timeout auditable (R2),
evidencia en Supabase Storage privado con consulta "último éxito" (R3),
sanitización en origen + filtro por forma en cierre (R4, patrón spec 014),
permisos por funciones `SECURITY DEFINER` reutilizando roles existentes sin
claims falsificables (R5), contrato Kestra JDBC reutilizable sin flows de
dominio nuevos (R6, FR-012) y guía de adopción con reconciliación solo
aditiva (R7). Refine expone historial y evidencia solo a admin/superadmin de
la organización dueña.

## Technical Context

**Language/Version**: SQL PostgreSQL/Supabase (migraciones); YAML Kestra
1.3.35 (contrato, sin flows nuevos de dominio); TypeScript/React con Refine
existente (`apps/web`); Node.js + TypeScript solo como contrato documentado
de workers (sin runtime nuevo).

**Primary Dependencies**: Supabase Postgres + Vault (ya en uso) + Storage
(primer uso, servicio incluido en el stack); Kestra OSS con plugins JDBC
PostgreSQL y SSH ya usados (`plantilla-generico.yml`); rol
`kestra_orquestacion` y roles `worker_<organizacion_id>` existentes
(spec 013); Refine existente. Nada nuevo que instalar.

**Storage**: Postgres esquema `public` (tablas de plataforma, no `dominio`):
`capacidades_ejecucion`, `ejecuciones_worker`, más funciones `SECURITY
DEFINER` y registro de adopción. Supabase Storage bucket privado nuevo
`evidencias-ejecuciones` con prefijo por organización; las filas guardan solo
rutas, nunca bytes ni secretos.

**Testing**: pgTAP en `supabase/tests/database` para RLS de tablas nuevas y
rechazo entre organizaciones (SC-003), unicidad de activa concurrente
(SC-001), timeout identificable (SC-002) y preservación de último éxito ante
falla (SC-004); pruebas de sanitización por forma (FR-009); recorrido local
vía `quickstart.md` para el contrato Kestra y las pantallas Refine (mismo
patrón que specs 011/013, sin tests automatizados de flows).

**Target Platform**: Docker local y VPS Linux con el servidor central
(Supabase, Kestra, Refine) más servidores Docker por organización
alcanzables por SSH (patrón spec 013, sin cambios).

**Project Type**: Extensión de plataforma multi-componente (patrón del
template) — toca Supabase + Kestra (contrato) + Refine + `workers/README.md`.

**Performance Goals**: SC-001: 100% de intentos concurrentes misma
organización+capacidad deja como máximo una activa (índice parcial, sin
serialización global); cierre por timeout en la misma transacción que el
nuevo inicio (R2), sin barrendero periódico.

**Constraints**: Migraciones aditivas con reversión documentada en la spec
(Technology Gates); RLS en toda tabla expuesta + prueba pgTAP; ningún secreto,
sesión ni variante codificada común en motivo/detalle/evidencia (FR-009);
ningún `INSERT/UPDATE/DELETE` directo de `authenticated` (solo vía funciones);
service-role nunca en el navegador (descarga por URL firmada); FR-012: sin
tablas, proveedores, selectores ni flows de producto concreto; reutilizar
`conexiones`, Vault, roles worker y `kestra_orquestacion` sin ampliar sus
privilegios más allá de `EXECUTE` sobre las funciones nuevas.

**Scale/Scope**: 3 tablas nuevas + 3 funciones (`iniciar_ejecucion_worker`,
`cerrar_ejecucion_worker`, `registrar_adopcion_ciclo`) + 1 bucket Storage con sus
políticas; 2 pantallas Refine (`ejecuciones`: lista + detalle/evidencia);
extensión de `workers/README.md` (contrato iniciar/cerrar/adjuntar);
1 guía `docs/adoptar-ciclo-ejecuciones.md`; 0 flows `.yml` nuevos de dominio.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio / gate | Resultado antes de diseño | Evidencia de cumplimiento |
|---|---|---|
| I. Aislamiento multi-tenant | Pasa condicionado | `organizacion_id` + RLS en ambas tablas; lectura solo admin/superadmin de la dueña; worker deriva su org del rol de sesión (R5); Storage con prefijo por org. Se prueba con pgTAP entre organizaciones (SC-003). |
| II. Especificar antes de implementar | Pasa | FR-001–FR-012 y SC-001–SC-005 trazados a `research.md` R1–R7, `data-model.md` y `contracts/`. |
| III. Idempotencia y auditoría | Pasa | Índice parcial (una activa), timeout auditado, cierre final inmutable, motivo sanitizado, último éxito preservado. |
| IV. Despliegues independientes | Pasa | Sin Compose raíz ni servicio nuevo; Storage es servicio existente de Supabase; cada org sigue con su propio host. |
| V. Simplicidad operativa | Pasa | Sin Redis/cron/subflow nuevo; cierre perezoso, consulta último-éxito en vez de tabla resumen, snippet JDBC en vez de plantilla yml. |
| Technology and Quality Gates | Pasa condicionado | Migración aditiva + reversión documentada; `pnpm lint`, `pnpm build`, `pnpm infra:config`, `pnpm test` en implementación; pgTAP para RLS. |
| Delivery Workflow | Pasa | Rama `016-ciclo-ejecuciones-workers` contra `main`; cierre con merge `--no-ff`, sin squash/rebase. |

Sin violaciones que requieran excepción constitucional.

## Project Structure

### Documentation (this feature)

```text
specs/016-ciclo-ejecuciones-workers/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── ciclo-ejecuciones.md
│   └── adopcion-reconciliacion.md
├── checklists/
│   └── requirements.md
└── tasks.md              # Phase 2 output (/speckit-tasks command)
```

### Source Code (repository root)

```text
supabase/migrations/
└── <timestamp>_ciclo_ejecuciones_workers.sql   # tablas, índice parcial, funciones, RLS, políticas Storage

supabase/tests/database/
└── ciclo_ejecuciones_workers.test.sql          # pgTAP: aislamiento, concurrencia, timeout, último éxito, sanitización

infra/kestra/flows/                             # SIN cambios en esta spec (contrato documentado en contracts/)
                                                # los flows existentes invocan iniciar/cerrar por JDBC (R6)

apps/web/src/pages/ejecuciones/
├── list.tsx        # historial por organización+capacidad (admin/superadmin)
└── show.tsx        # detalle + descarga de evidencia por URL firmada

workers/README.md   # + subsección contrato iniciar/cerrar/adjuntar + sanitización (FR-010, R4)

docs/adoptar-ciclo-ejecuciones.md  # guía de adopción + reconciliación aditiva (US3/FR-011)

.env.example        # sin variables nuevas previstas (se reutilizan KESTRA_ORQUESTACION_* y Vault)
```

**Structure Decision**: Extiende componentes existentes (Supabase, contrato
Kestra, Refine, `workers/README.md`, docs) sin proyecto ni servicio nuevo.
Tablas en `public` (plataforma, como `conexiones`/`alertas`), nunca en
`dominio` (datos de negocio de cada producto). Ningún flow `.yml` de dominio
nuevo por FR-012.

## Complexity Tracking

No aplica: sin violaciones constitucionales.
