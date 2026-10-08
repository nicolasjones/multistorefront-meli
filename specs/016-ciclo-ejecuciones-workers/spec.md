# Feature Specification: Ciclo de Ejecuciones de Workers

**Feature Branch**: `016-ciclo-ejecuciones-workers`

**Created**: 2026-09-20

**Status**: Draft

**Delivery scope**: refine | supabase | kestra | workers

**Input**: User description: "Ciclo genérico de ejecuciones de workers: auditoría, concurrencia, evidencia y conciliación segura para productos derivados."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ejecutar una automatización sin duplicar su efecto (Priority: P1)

Una persona que opera un producto derivado necesita iniciar o programar una
automatización de integración y confiar en que habrá una sola ejecución activa
para la misma organización y capacidad, con un resultado auditable al terminar.

**Why this priority**: Es la base común para que cualquier worker sea
idempotente, recuperable y observable sin que cada producto invente su propio
lock e historial.

**Independent Test**: Se inicia una ejecución autorizada y se comprueba que
queda registrada; un segundo intento concurrente para la misma organización y
capacidad se rechaza sin crear un registro adicional.

**Acceptance Scenarios**:

1. **Given** una conexión habilitada y una capacidad registrada para una
   organización, **When** se inicia una ejecución autorizada, **Then** se
   registra una única ejecución en curso con su origen, actor cuando aplica y
   hora de inicio.
2. **Given** una ejecución vigente para la misma organización y capacidad,
   **When** se intenta iniciar otra, **Then** se informa que ya hay una en
   curso y no se duplica el trabajo.
3. **Given** una ejecución que superó su tiempo máximo acordado, **When** se
   intenta una nueva, **Then** la anterior queda cerrada con un motivo de
   timeout y la nueva puede comenzar.

---

### User Story 2 - Consultar el resultado y la evidencia de una ejecución (Priority: P2)

Un administrador de la organización necesita conocer quién inició una
automatización, su estado, duración, error sanitizado y la evidencia de su
último resultado exitoso, sin acceder a datos de otras organizaciones.

**Why this priority**: La operación segura requiere explicar fallas y permitir
recuperación sin exponer secretos ni mezclar organizaciones.

**Independent Test**: Un administrador consulta el historial y evidencia de
su organización; un miembro sin permiso de auditoría y usuarios de otra
organización no pueden verlos.

**Acceptance Scenarios**:

1. **Given** una ejecución exitosa con archivos de evidencia, **When** un
   administrador autorizado consulta su historial, **Then** puede acceder al
   resultado y a la evidencia asociada.
2. **Given** una ejecución posterior que falla, **When** se consulta el
   historial, **Then** la falla queda registrada sin reemplazar la evidencia
   del último resultado exitoso.
3. **Given** un miembro sin permiso de auditoría o de otra organización,
   **When** intenta consultar ejecuciones o evidencias ajenas, **Then** no
   recibe filas ni archivos.

---

### User Story 3 - Adoptar el mecanismo en un producto derivado existente (Priority: P3)

Una persona responsable de un producto derivado que ya resolvió este problema
necesita adoptar la capacidad del template sin recrear objetos existentes ni
interrumpir sus automatizaciones de dominio.

**Why this priority**: El template solo aporta valor si puede volver a los
productos de forma segura y trazable, incluso cuando una implementación real
originó el patrón.

**Independent Test**: Se sigue la guía de adopción sobre un producto con un
historial compatible y se verifica que no se crean objetos duplicados ni se
modifica su dominio.

**Acceptance Scenarios**:

1. **Given** un producto que ya tiene un ciclo compatible de ejecuciones,
   **When** adopta esta capacidad, **Then** conserva su historial existente y
   registra la versión de template de la que proviene.
2. **Given** una diferencia compatible entre el producto y el contrato del
   template, **When** se realiza la adopción, **Then** se aplica una
   reconciliación aditiva y documentada.
3. **Given** una automatización o tabla propia del dominio del producto,
   **When** se adopta el mecanismo, **Then** esa automatización o tabla no se
   traslada al template ni se reemplaza automáticamente.

### Edge Cases

- Una ejecución termina dos veces o intenta cerrarse con un estado no final.
- El disparo manual pide una capacidad que no está habilitada para su conexión.
- La evidencia no se puede guardar después de que el trabajo de negocio ya
  terminó.
- Una ejecución falla con un mensaje que contiene una credencial, una sesión o
  una variante codificada de un secreto.
- Un producto derivado tiene nombres o firmas históricas incompatibles con el
  contrato del template.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: La plataforma DEBE registrar cada ejecución de worker con la
  organización dueña, conexión, capacidad, origen, estado, horas de inicio y
  cierre, actor cuando sea un disparo manual y un detalle extensible.
- **FR-002**: La plataforma DEBE garantizar como máximo una ejecución activa
  por organización y capacidad, sin impedir ejecuciones de capacidades distintas
  de esa misma organización.
- **FR-003**: La plataforma DEBE cerrar de manera identificable una ejecución
  que excede el tiempo máximo de su capacidad antes de permitir un nuevo
  intento.
- **FR-004**: La plataforma DEBE permitir iniciar ejecuciones solo para una
  capacidad registrada y habilitada para la conexión; no DEBE aceptar tipos o
  capacidades arbitrarias enviados por un cliente.
- **FR-005**: La plataforma DEBE registrar el cierre exitoso o fallido de una
  ejecución, su motivo sanitizado y su detalle final, y no DEBE permitir que
  un cierre posterior altere una ejecución ya cerrada.
- **FR-006**: La plataforma DEBE conservar el archivo original y la evidencia
  de la última ejecución exitosa de cada organización y capacidad; una falla
  posterior no DEBE borrar ni sustituir esas referencias.
- **FR-007**: Los administradores de la organización y los superadmins DEBEN
  poder consultar historial y evidencia solo dentro del alcance que les
  corresponde; otros usuarios no DEBEN poder modificar directamente una
  ejecución ni acceder a su evidencia.
- **FR-008**: Un worker autorizado DEBE poder iniciar y cerrar únicamente
  ejecuciones de su propia organización, sin recibir ni exponer secretos de
  otras organizaciones.
- **FR-009**: Ningún registro de ejecución, detalle, error, evidencia ni
  salida operativa DEBE conservar credenciales, sesiones o sus representaciones
  codificadas comunes en texto recuperable.
- **FR-010**: La capacidad DEBE ofrecer un contrato reutilizable para que los
  workers inicien, cierren y adjunten evidencia sin copiar lógica de
  concurrencia o auditoría en cada producto.
- **FR-011**: La adopción en un producto derivado existente DEBE documentar la
  versión de origen y tratar diferencias mediante una reconciliación aditiva;
  no DEBE recrear objetos compatibles ni eliminar datos históricos.
- **FR-012**: Esta entrega NO DEBE incorporar tablas, reglas de negocio,
  proveedores externos, selectores de navegador ni flows dedicados de un
  producto concreto.

### Key Entities *(include if feature involves data)*

- **Ejecución**: registro auditable de un intento de automatización para una
  organización, conexión y capacidad, con estado, origen, actor, tiempos,
  detalle y referencias de evidencia.
- **Capacidad de ejecución**: automatización identificable que una conexión
  puede ejecutar, con un tiempo máximo y reglas de autorización aplicables.
- **Evidencia de ejecución**: archivo original o material de diagnóstico
  asociado al último resultado exitoso y aislado por organización.
- **Reconciliación de producto**: ajuste aditivo y documentado que permite a un
  producto adoptar una evolución del contrato del template sin perder su
  historial ni su dominio.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de los intentos concurrentes de una misma organización y
  capacidad deja como máximo una ejecución activa.
- **SC-002**: El 100% de las ejecuciones que exceden su tiempo máximo quedan
  identificadas como timeout antes de que un nuevo intento autorizado continúe.
- **SC-003**: En las pruebas de aislamiento, el 100% de los intentos de lectura
  o modificación fuera de la organización o permiso autorizado son rechazados.
- **SC-004**: Una ejecución fallida posterior conserva accesible la evidencia
  del último éxito en el 100% de los escenarios de prueba.
- **SC-005**: Un producto derivado compatible puede adoptar el mecanismo sin
  crear tablas o historiales duplicados y con una referencia verificable a la
  versión del template.

## Assumptions

- El template conserva sus mecanismos actuales de organizaciones, conexiones,
  RLS, roles de worker y gestión de secretos; esta entrega los reutiliza.
- Cada producto define sus capacidades de negocio y el acceso de sus usuarios,
  pero adopta el contrato común de ciclo de ejecución cuando corresponda.
- La primera adopción de reconciliación será sobre el producto que originó el
  patrón, sin modificar su tabla de dominio ni su conector externo.
- La retención de archivos y el tiempo máximo por capacidad se definirán en la
  planificación según los límites operativos existentes; no se infiere una
  política de retención nueva en esta spec.
