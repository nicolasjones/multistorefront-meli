# Feature Specification: Publicación segura de flows

**Feature Branch**: `20260924-221340-publicacion-segura-flows`

**Created**: 2026-09-24

**Status**: Draft

**Input**: User description: "Hacer port-back del publicador seguro de flows de Kestra."

**Delivery scope**: kestra

## User Scenarios & Testing

### User Story 1 - Publicar un flow nuevo sin intervención manual (Priority: P1)

Quien opera un producto derivado puede publicar un flow que aún no existe sin
que la operación quede bloqueada ni deba repetirla desde la interfaz.

**Why this priority**: La primera publicación es el caso que hoy puede dejar
inutilizable la instancia local de orquestación.

**Independent Test**: Contra una instancia local autenticada, publicar un flow
de prueba inexistente y comprobar que queda disponible.

**Acceptance Scenarios**:

1. **Given** un flow válido inexistente, **When** la persona lo publica,
   **Then** queda disponible una única revisión del flow.
2. **Given** que la consulta previa informa que el flow no existe, **When** se
   publica, **Then** no se intenta una actualización sobre un destino ausente.

---

### User Story 2 - Actualizar un flow existente (Priority: P2)

Quien opera la plataforma puede publicar una nueva versión de un flow ya
existente sin crear un duplicado.

**Why this priority**: Mantiene el flujo operativo habitual para cambios de
flows versionados.

**Independent Test**: Publicar dos veces el mismo flow válido y comprobar que
la segunda operación actualiza la revisión disponible.

**Acceptance Scenarios**:

1. **Given** un flow existente, **When** se publica una revisión válida,
   **Then** el flow conserva su identidad y refleja la revisión nueva.

### Edge Cases

- La consulta previa responde un estado distinto de existente o inexistente.
- La instancia rechaza el contenido del flow al crear o actualizar.
- La instancia no responde dentro del tiempo operativo definido.

## Requirements

### Functional Requirements

- **FR-001**: La publicación DEBE consultar el estado del flow antes de
  modificarlo.
- **FR-002**: La publicación DEBE crear el flow sólo cuando la consulta indique
  que no existe.
- **FR-003**: La publicación DEBE actualizar el flow sólo cuando la consulta
  indique que existe.
- **FR-004**: La publicación DEBE fallar con un error sanitizado si la consulta
  o la operación final no obtiene una respuesta aceptada.
- **FR-005**: La publicación NO DEBE registrar ni devolver credenciales,
  contenidos sensibles ni cuerpos de respuesta operativos.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Un flow válido inexistente queda disponible con una única
  ejecución de publicación.
- **SC-002**: Un flow válido existente puede actualizarse sin crear un segundo
  flow con la misma identidad.
- **SC-003**: El 100% de las respuestas no reconocidas termina con un error
  sanitizado antes de intentar modificar el flow.

## Assumptions

- La instancia ya cuenta con autenticación local configurada fuera del
  repositorio.
- El template mantiene un único publicador versionado y los productos derivados
  lo reciben mediante la sincronización normal con `upstream/main`.
- Los flows y sus reglas de negocio siguen siendo responsabilidad de cada
  producto derivado.
