# Implementation Plan: Observabilidad de plataforma para workers de navegador

**Branch**: `20260925-133820-observabilidad-workers-navegador` | **Date**: 2026-09-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/20260925-133820-observabilidad-workers-navegador/spec.md`

## Summary

El contrato de workers suma eventos JSON por etapa y reglas de evidencia
visual. Las plantillas de despacho montan una carpeta de evidencia solo cuando
está habilitada, publican las capturas por sftp como outputs (y las borran del
host) y publican el archivo de logs del despacho con `log.Fetch`, siempre en
`finally` y sin alterar el estado de negocio. Un flow `limpieza-evidencia`
purga diariamente el almacenamiento interno vencido sin tocar ejecuciones,
logs ni Supabase. Se publica como `worker-execution-cycle` 1.1.0. Decisiones
y spike en [research.md](./research.md).

## Technical Context

**Language/Version**: YAML de flows Kestra 1.3.35; POSIX `sh` en el comando
SSH; Node 24 ESM para validaciones.

**Primary Dependencies**: `plugin-fs` 2.11.1 (`ssh.Command`,
`sftp.Downloads`), core (`log.Fetch`, `execution.PurgeExecutions`,
`Schedule`).

**Storage**: almacenamiento interno de Kestra (capturas y logs publicados);
carpeta transitoria en el host de despacho. Sin cambios en Supabase.

**Testing**: `node --test` para el contrato estático de flows; E2E real con
Kestra, Supabase y host SSH fixture locales del template; regresión de
`test:kestra:secretos:e2e` y `test:kestra:runtime`.

**Target Platform**: Kestra en VPS; hosts de despacho Linux con Docker.

**Project Type**: plataforma de orquestación (flows + contrato de workers).

**Performance Goals**: publicar evidencia agrega segundos por despacho; tope
de 50 capturas por organización y despacho.

**Constraints**: rootfs `--read-only`; nada de evidencia en stderr; ningún
secreto en logs/outputs; la clave SSH sigue solo en `secret()`.

**Scale/Scope**: 2 plantillas, 1 flow nuevo, 1 contrato, 1 capacidad.

## Constitution Check

| Principio | Evaluación |
|---|---|
| I. Aislamiento multi-tenant | Carpeta por ejecución y organización; base `0700`; sin secretos en outputs. ✅ |
| II. Especificar antes | Spec, plan y tareas antes del código. ✅ |
| III. Idempotencia y auditoría | Limpieza idempotente verificada; auditoría de Supabase intacta; estados de negocio intactos. ✅ |
| IV. Despliegues independientes | Solo `infra/kestra/compose.yaml` y flows; sin Compose raíz. ✅ |
| V. Simplicidad operativa | Plugins ya presentes en la imagen; sin servicios nuevos. ✅ |
| VI. Panel operable | No agrega pantallas: la consulta es en Kestra. N/A |
| VII. Documentación | Contrato, guía de adopción, spec y `.env.example` en el mismo cambio. ✅ |

Sin violaciones. Re-evaluado tras el diseño: sin cambios.

## Project Structure

### Documentation (this feature)

```text
specs/20260925-133820-observabilidad-workers-navegador/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/observabilidad-workers.md
└── tasks.md
```

### Source Code (repository root)

```text
workers/CONTRATO.md                              # sección de observabilidad
infra/kestra/flows/plantilla-generico.yml        # evidencia + logs por organización
infra/kestra/flows/plantilla-dedicado.yml        # evidencia + logs
infra/kestra/flows/limpieza-evidencia.yml        # nuevo, programado
infra/kestra/compose.yaml                        # ENV_EVIDENCIA_* con defaults
.env.example                                     # variables documentadas
infra/kestra/fixtures/worker/entrypoint.sh       # eventos y capturas de prueba
infra/kestra/validar-evidencia-flows.test.mjs    # contrato estático
infra/kestra/validar-evidencia-e2e.mjs           # validación real
infra/kestra/e2e-comun.mjs                       # helpers compartidos con validar-secretos-e2e
template-capabilities.json / template-adoption.json
docs/adoptar-ciclo-ejecuciones.md                # sección de adopción
```

**Structure Decision**: todo vive en `infra/kestra/` y `workers/`; el E2E
nuevo reutiliza el fixture de la spec 014 extrayendo sus helpers a un módulo
común para no duplicar el aprovisionamiento.

### Producto por alcance

| Producto | Archivo | Validación | Destino |
|---|---|---|---|
| kestra | `infra/kestra/flows/*.yml`, `infra/kestra/compose.yaml` | `test:kestra:evidencia`, `test:kestra:evidencia:e2e`, `infra:config:kestra` | VPS |
| workers | `workers/CONTRATO.md` | E2E con worker fixture | VPS (cada producto) |

## Capacidades

- `worker-execution-cycle` 1.0.1 → **1.1.0** (MINOR: contrato aditivo) y se
  agrega `infra/kestra/flows/limpieza-evidencia.yml` a sus rutas.
- `worker-image-security` 1.0.0 → **1.0.1**: comparte `workers/CONTRATO.md`
  y el verificador exige el bump; el contrato de imagen no cambia.

## Despliegue y reversión

Crear en cada host de despacho `EVIDENCIA_DIR_HOST` propiedad del usuario
SSH (solo si se habilita evidencia). Sin migraciones: revertir el PR
restaura las plantillas; las capturas ya publicadas vencen con la limpieza o
se borran con una corrida manual de retención 0.

## Complexity Tracking

Sin violaciones que justificar.
