# Especificación: Documentación obligatoria de cambios

**Rama**: `021-documentacion-obligatoria`  
**Creada**: 2026-09-23  
**Estado**: Implementada  
**Alcance de entrega**: `kestra`, `supabase`, `workers`

## Objetivo

Evitar que cambios de plataforma, infraestructura, base de datos, workers o
tooling queden sin una decisión, contrato o evidencia escrita.

## Requisitos

- **FR-001**: Todo cambio relevante debe actualizar una spec, `docs/`,
  `AGENTS.md`, `CLAUDE.md` o la constitución en el mismo cambio.
- **FR-002**: CI debe ejecutar un control reproducible contra la base de la
  rama y fallar cuando no exista documentación equivalente.
- **FR-003**: El control no debe exigir documentación adicional cuando el cambio
  sólo modifica documentación o archivos fuera del alcance de plataforma.
- **FR-004**: La guía debe explicar qué registrar, cómo ejecutar el control y
  que los artefactos generados no sustituyen la fuente.

## Criterios de éxito

- **SC-001**: `pnpm docs:check` pasa sobre esta implementación.
- **SC-002**: El workflow de validación obtiene historial suficiente y ejecuta
  el control antes de las validaciones de aplicación.
- **SC-003**: La regla queda reflejada en la constitución, AGENTS y CLAUDE.
