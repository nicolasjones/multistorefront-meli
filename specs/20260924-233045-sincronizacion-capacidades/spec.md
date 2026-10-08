# Feature Specification: Sincronización de capacidades derivadas

**Feature Branch**: `20260924-233045-sincronizacion-capacidades`  
**Created**: 2026-09-24  
**Status**: Draft  
**Scope**: workers, Supabase, CI/documentación; sin Refine, Kestra ni Superset.

## User Scenarios & Testing

### User Story 1 - Crear un producto actualizado (Priority: P1)

Una persona crea un producto derivado desde el template y puede conocer, sin
comparar historiales Git, qué capacidades de plataforma incluye inicialmente.

**Independent Test**: un producto recién creado valida su registro contra el
catálogo del template sin resultados pendientes.

**Acceptance Scenarios**:

1. **Given** un catálogo publicado, **When** se inicia un producto desde él,
   **Then** el producto registra las mismas capacidades y versiones.
2. **Given** una capacidad no aplicable, **When** se declara su exclusión,
   **Then** queda con motivo y no se informa como pendiente.

### User Story 2 - Detectar una mejora pendiente (Priority: P2)

Una persona responsable de un producto derivado recibe evidencia concreta de
una capacidad de plataforma nueva o actualizada, sin que el sistema intente un
merge masivo ni trate SHA distintos como una falla.

**Independent Test**: con un catálogo remoto de prueba que contiene una versión
nueva, la verificación lista sólo esa capacidad y termina con estado no exitoso.

**Acceptance Scenarios**:

1. **Given** una capacidad posterior a la adoptada, **When** corre la
   verificación, **Then** informa nombre, versión y referencia de adopción.
2. **Given** catálogos iguales, **When** corre la verificación, **Then** no
   abre trabajo ni informa commits históricos como pendientes.

### User Story 3 - Operar sin exponer secretos (Priority: P3)

Una persona configura la lectura de un template privado sin versionar ni
mostrar el secreto; si falta autorización, recibe una instrucción sanitizada.

**Independent Test**: una ejecución sin credencial falla con el mensaje de
configuración, sin imprimir token, URL autenticada ni cabeceras.

## Edge Cases

- Un producto declara una versión desconocida o una capacidad duplicada.
- El catálogo remoto no puede leerse o tiene formato inválido.
- Un producto deliberadamente posterga una capacidad por incompatibilidad de
  dominio: debe registrarlo, no ocultarlo.

## Requirements

### Functional Requirements

- **FR-001**: El template DEBE publicar un catálogo versionado de capacidades
  reutilizables, con identificador estable, versión, descripción y referencia
  de adopción.
- **FR-002**: Un producto derivado DEBE conservar un registro versionado de
  capacidades adoptadas, excluidas o pendientes, incluyendo motivo cuando no
  adopta la versión vigente.
- **FR-003**: La verificación DEBE comparar catálogos por identificador y
  versión, nunca por pertenencia de commits o SHA.
- **FR-004**: La verificación DEBE producir una salida determinista y
  sanitizada para capacidades pendientes, catálogos inválidos y falta de
  autorización.
- **FR-005**: La automatización DEBE abrir o actualizar trabajo de seguimiento
  sólo para capacidades realmente pendientes; no DEBE hacer merge automático.
- **FR-006**: Las credenciales de lectura entre repositorios DEBEN provenir de
  secretos de CI y no pueden aparecer en archivos versionados ni registros.
- **FR-007**: El mecanismo DEBE permitir que cada producto mantenga dominio,
  datos, conectores y despliegue independientes.

### Key Entities

- **Capacidad de plataforma**: comportamiento reutilizable con versión estable.
- **Adopción de producto**: estado y versión de una capacidad en un derivado.
- **Resultado de sincronización**: evidencia de capacidades pendientes o al día.

## Success Criteria

- **SC-001**: Un producto nuevo queda al día con el catálogo inicial sin
  intervención manual adicional.
- **SC-002**: Una capacidad nueva se identifica sin falsos pendientes por
  commits que fueron reconciliados previamente.
- **SC-003**: El 100% de los resultados de error puede compartirse sin revelar
  credenciales.
- **SC-004**: Ninguna verificación modifica código de dominio ni crea merges.

## Assumptions

- Cada producto derivado configura un secreto de lectura con alcance mínimo al
  template privado antes de activar el control remoto.
- La adopción técnica se realiza mediante PR separado y validaciones propias
  del producto.
