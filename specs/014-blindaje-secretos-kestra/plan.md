# Implementation Plan: Blindaje de secretos en la orquestación

**Branch**: `014-blindaje-secretos-kestra` | **Date**: 2026-09-15 | **Spec**: [spec.md](./spec.md)

**Input**: Especificación de la funcionalidad en `specs/014-blindaje-secretos-kestra/spec.md`.

## Summary

Eliminar el paso de secretos descifrados por outputs, expresiones y comandos
persistidos de Kestra. Los flows conservarán solamente identificadores no
sensibles; el worker, autenticado como el rol de ejecución de su organización,
obtendrá su credencial desde una función SQL de mínimo privilegio. La conexión
SSH deja de depender de una contraseña resuelta por ejecución y usa una clave
de orquestación referenciada mediante `secret()` de Kestra. Toda causa enviada
a alertas se sanitiza antes de salir de Kestra o persistirse en Supabase.

## Technical Context

**Language/Version**: YAML de Kestra 1.3.35; SQL PostgreSQL/Supabase; Node.js + TypeScript para workers futuros.

**Primary Dependencies**: Kestra OSS, plugins JDBC PostgreSQL y SSH, Supabase Vault/PostgreSQL, Docker remoto.

**Storage**: PostgreSQL (metadatos de orquestación, Vault y alertas); repositorio e internal storage de Kestra para ejecuciones; configuración secreta local del servidor de cada organización.

**Testing**: pgTAP en `supabase/tests/database`; pruebas de contrato estáticas de los flows/workers; recorrido local de Kestra con credenciales centinela.

**Target Platform**: Docker local y VPS Linux con Kestra y servidores Docker por organización.

**Project Type**: Monorepo de plataforma web, orquestación y workers de ejecución puntual.

**Performance Goals**: Mantener la concurrencia configurada de Kestra y no agregar una consulta remota por encima de la obtención que el worker ya necesita para autenticarse.

**Constraints**: Ningún secreto de organización puede estar en inputs, outputs, logs, errorLogs, metadatos, comandos renderizados ni archivos temporales de Kestra; se cubren variantes literal, URL y Base64. Los registros históricos no se modifican.

**Scale/Scope**: Ambas plantillas de flow (`genérico` y `dedicado`), sus reintentos y la convención de todos los workers de integración; no cubre procesos ajenos al template.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio / gate | Resultado antes de diseño | Evidencia de cumplimiento |
|---|---|---|
| I. Aislamiento multi-tenant | Pasa condicionado | La nueva función limita la credencial a la conexión de la organización autenticada y no expone una tabla; se prueba el rechazo entre organizaciones. |
| II. Especificar antes de implementar | Pasa | Requisitos FR-001 a FR-008 y aclaraciones están trazados en este plan y sus contratos. |
| III. Idempotencia y auditoría | Pasa condicionado | Reintentos aplican el mismo canal sin secreto; alertas conservan categoría y referencias, con motivo sanitizado. |
| IV. Despliegues independientes | Pasa | Cambios localizados en `infra/kestra`, `supabase` y `workers`; sin Compose raíz. |
| V. Simplicidad operativa | Pasa | Se reutilizan Vault, el rol de worker y la infraestructura existente; no se agrega un gestor secreto nuevo. |
| Technology and Quality Gates | Pasa condicionado | La migración será aditiva y documentará reversión; `pnpm lint`, `pnpm build`, `pnpm infra:config` y pruebas relevantes se ejecutarán en implementación. |

No hay violaciones que requieran excepción constitucional.

## Project Structure

### Documentation (this feature)

```text
specs/014-blindaje-secretos-kestra/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    └── ejecucion-segura.md
```

### Source Code (repository root)
```text
infra/kestra/
├── compose.yaml
└── flows/
    ├── plantilla-generico.yml
    ├── plantilla-dedicado.yml
    └── alertas.yml

supabase/
├── migrations/
│   └── <timestamp>_blindaje_secretos_orquestacion.sql
└── tests/database/
    └── orquestacion_multi_organizacion.test.sql

workers/
└── README.md

.env.example
```

**Structure Decision**: Entrega transversal sin frontend: los flows dejan de
transportar secretos, Supabase expone el acceso efímero restringido al worker y
la convención de `workers/` define el contrato de consumo y sanitización.

## Complexity Tracking

No aplica: no hay violaciones constitucionales.
