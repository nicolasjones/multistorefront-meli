# Feature Specification: Separación local por producto

**Feature Branch**: `001-separacion-local-por-producto`

**Created**: 2026-09-06

**Status**: Implemented

**Delivery scope**: refine | supabase | kestra | superset

## User Scenarios & Testing

### User Story 1 - Operar un producto sin levantar los demás (Priority: P1)

Como desarrollador, puedo iniciar o detener cada producto de forma independiente
para concentrarme en la capacidad que estoy construyendo.

**Independent Test**: iniciar Superset no crea ni arranca contenedores de
Kestra, Refine o Supabase.

**Acceptance Scenarios**:

1. **Given** Docker Desktop está disponible, **When** ejecuto el comando de
   un producto, **Then** sólo aparece su proyecto Docker y sus dependencias.
2. **Given** un producto está detenido, **When** inicio otro, **Then** sus
   redes y volúmenes permanecen aislados.

### User Story 2 - Mantener un flujo SDD entendible (Priority: P1)

Como desarrollador que usa Claude Code o Codex, puedo saber qué producto toca
una funcionalidad antes de modificar código o infraestructura.

**Independent Test**: una spec declara el alcance de entrega y su plan apunta
a los archivos y validaciones de cada producto afectado.

## Requirements

- **FR-001**: Cada producto local debe tener un identificador Docker propio.
- **FR-002**: No debe existir un Compose raíz que combine productos.
- **FR-003**: Supabase debe conservar su proyecto local separado mediante
  Supabase CLI.
- **FR-004**: Las instrucciones de Claude Code y Codex deben exigir declarar
  el alcance de entrega de cada spec.
- **FR-005**: El despliegue de VPS debe ejecutar Kestra y Superset como
  proyectos Compose independientes.

## Success Criteria

- **SC-001**: Las tres configuraciones Compose validan individualmente.
- **SC-002**: Supabase inicia con el identificador local por producto.
- **SC-003**: Refine y Superset responden en sus URLs locales sin publicar
  otros productos.
