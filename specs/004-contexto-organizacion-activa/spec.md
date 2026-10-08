# Feature Specification: Contexto de organización activa del superadmin

**Feature Branch**: `004-contexto-organizacion-activa`

**Created**: 2026-09-08

**Status**: Implemented

**Input**: User description: "Contexto de organización activa del superadmin:
hoy el superadmin puede entrar a una organización puntual
(`entrar_a_organizacion`, Historia 4 de la spec 003) pero no tiene forma de
salir de ese contexto ni ve en ningún lado en qué organización está parado.
Además, los recursos que dependen de una organización (Clientes hoy,
Miembros de la organización en una spec futura) le aparecen en el menú
aunque no tenga ninguna organización activa, mostrando listas vacías sin
explicación."

**Delivery scope**: supabase | refine

## Clarifications

### Session 2026-09-08

- Q: ¿Qué debe pasar si se invoca la salida de organización cuando el
  superadmin no tiene ninguna organización activa? → A: No-op silencioso
  — no falla, no hay nada que borrar ni que auditar.
- Q: Al entrar a otra organización teniendo ya una activa, ¿`entrar_a_organizacion`
  (spec 003) se modifica para registrar también la salida automática de la
  anterior? → A: Sí — la RPC se extiende para registrar salida de la
  anterior + entrada a la nueva (dos filas de auditoría), no solo la
  entrada.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sin organización activa, no aparecen pantallas que no aplican (Priority: P1)

Como superadmin que todavía no entró a ninguna organización (o que acaba de
salir de la que tenía activa), no veo en el menú ninguna pantalla que
dependa de una organización — solo veo Organizaciones. Si igual llego a una
de esas pantallas por URL directa, se me redirige al listado de
organizaciones en vez de mostrarme una lista vacía sin contexto.

**Why this priority**: Es el problema que motivó esta spec — hoy un
superadmin sin organización activa ve "Clientes" en el menú, entra, y se
encuentra con una lista vacía que no explica nada. Resolver esto no
depende de ninguna otra historia.

**Independent Test**: Loguearse como superadmin sin haber entrado nunca a
una organización (o habiendo salido de la última). Confirmar que el menú
no muestra "Clientes" y que navegar a `/clientes` por URL redirige a
`/organizaciones`.

**Acceptance Scenarios**:

1. **Given** un superadmin sin organización activa, **When** mira el menú
   de navegación, **Then** solo ve "Organizaciones" — ninguna pantalla que
   dependa de una organización aparece listada.
2. **Given** un superadmin sin organización activa, **When** navega
   directamente a la URL de una pantalla que depende de organización (por
   ejemplo `/clientes`), **Then** el sistema lo redirige al listado de
   organizaciones.

---

### User Story 2 - Ver y salir de la organización activa (Priority: P2)

Como superadmin que entró a una organización puntual, veo de forma
permanente en qué organización estoy operando mientras navego sus
pantallas, y puedo salir de ese contexto de forma explícita cuando termino
— sin tener que entrar a otra organización para "soltar" la actual.

**Why this priority**: Depende de que exista organización activa (parte
del comportamiento de la Historia 4 de la spec 003, ya construida), pero
agrega la visibilidad y el control que hoy faltan. Tiene menos urgencia que
la Historia 1 porque no genera una pantalla rota — solo falta de claridad.

**Independent Test**: Entrar a una organización, confirmar que el nombre
de esa organización aparece de forma visible en las pantallas que dependen
de ella, usar la acción de salir, y confirmar que el sistema vuelve al
estado sin organización activa (Historia 1).

**Acceptance Scenarios**:

1. **Given** un superadmin que entró a la organización X, **When** navega
   cualquier pantalla que depende de organización, **Then** ve de forma
   permanente el nombre de la organización X como la que está operando
   actualmente.
2. **Given** un superadmin con la organización X activa, **When** usa la
   acción de salir, **Then** deja de tener organización activa y el
   sistema se comporta como en la Historia 1.
3. **Given** un superadmin con la organización X activa, **When** entra a
   la organización Y, **Then** el contexto activo pasa a ser Y (el cambio
   de contexto en sí ya ocurre hoy vía `entrar_a_organizacion`) y quedan
   registrados ambos movimientos — salida de X y entrada a Y — como dos
   filas de auditoría, no solo la entrada.

### Edge Cases

- Un superadmin que nunca entró a ninguna organización tampoco debe ver
  ninguna pantalla dependiente de organización (mismo comportamiento que
  haber salido — no hay estado especial de "primera vez").
- Salir de la organización activa sin tener ninguna activa no debe ser
  posible desde la UI (la acción no se muestra si no hay contexto activo).
  Si se invoca igual por otra vía (por ejemplo, directo contra el RPC), es
  un no-op silencioso — no falla, no hay nada que borrar ni que auditar.
- Entrar a una organización teniendo ya otra activa reemplaza el contexto
  directamente, sin necesidad de salir antes — comportamiento de
  `entrar_a_organizacion` ya existente. Lo que se agrega en esta spec es
  que esa misma RPC registre también la salida automática de la
  organización anterior, no solo la entrada a la nueva.
- Un administrador o miembro de una organización nunca ve el menú
  reducido de la Historia 1 ni el indicador de la Historia 2 — ellos
  siempre pertenecen a una única organización fija, sin concepto de
  "activa" ni de "salir".

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE ocultar del menú de navegación toda pantalla
  que dependa de una organización (`clientes` hoy, y cualquiera que se
  agregue después con el mismo criterio) para un superadmin que no tenga
  una organización activa.
- **FR-002**: El sistema DEBE mostrar esas mismas pantallas, con los
  mismos permisos que ya tiene un administrador de esa organización, para
  un superadmin que sí tenga una organización activa — esto no cambia el
  comportamiento ya construido en la spec 003 (FR-012), solo condiciona su
  visibilidad en el menú.
- **FR-003**: El sistema DEBE rechazar y redirigir al listado de
  organizaciones cualquier intento de un superadmin sin organización
  activa de acceder por URL directa a una pantalla dependiente de
  organización, en vez de mostrar una lista vacía.
- **FR-004**: El sistema DEBE mostrar, en toda pantalla dependiente de
  organización, un indicador siempre visible con el nombre de la
  organización que el superadmin tiene activa.
- **FR-005**: El sistema DEBE ofrecer una acción explícita para que el
  superadmin salga de su organización activa, disponible únicamente
  cuando tiene una organización activa. Tras usarla, queda sin
  organización activa (comportamiento de FR-001/FR-003). Invocarla sin
  tener ninguna organización activa DEBE ser un no-op silencioso — no
  falla, no genera registro de auditoría.
- **FR-006**: El sistema DEBE registrar cada vez que un superadmin sale de
  una organización activa — quién, de qué organización, y cuándo — en la
  misma línea de tiempo de auditoría que ya registra las entradas
  (`superadmin_entradas`, FR-013 de la spec 003), no en una tabla
  separada.
- **FR-007**: Entrar a una organización teniendo ya otra activa DEBE
  registrar dos eventos de auditoría — la salida automática de la
  organización anterior y la entrada a la nueva — no solo la entrada. Esto
  extiende el comportamiento de `entrar_a_organizacion` (spec 003, FR-013);
  el cambio de contexto en sí (cuál organización queda activa) no cambia.
- **FR-008**: Ningún comportamiento de esta spec DEBE aplicar a
  administrador ni miembro de una organización — ellos no tienen concepto
  de organización activa, siempre ven sus propias pantallas.

### Key Entities

- **Organización activa**: la organización puntual que un superadmin
  eligió operar (`superadmin_organizacion_activa`, ya existente desde la
  spec 003). Esta spec le agrega la posibilidad de vaciarse explícitamente
  (salir) y la hace visible en la UI.
- **Registro de entrada/salida de superadmin**: extiende el registro de
  auditoría ya existente (`superadmin_entradas`) para incluir también el
  evento de salida, manteniendo una sola línea de tiempo por superadmin.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un superadmin sin organización activa nunca ve en su menú
  una pantalla que dependa de organización.
- **SC-002**: Un superadmin nunca se encuentra con una lista vacía sin
  explicación al intentar acceder a una pantalla dependiente de
  organización sin tener una activa — siempre es redirigido en su lugar.
- **SC-003**: En cualquier pantalla dependiente de organización, un
  superadmin puede identificar en menos de un vistazo en qué organización
  está operando, sin necesidad de consultar ninguna otra pantalla.
- **SC-004**: El 100% de las entradas y salidas de organización de un
  superadmin quedan registradas con quién, cuál organización, y cuándo.

## Assumptions

- El mecanismo de entrada (`entrar_a_organizacion`) no cambia en qué
  organización queda activa ni en sus validaciones existentes — solo se
  extiende para además auditar la salida automática de la organización
  anterior (FR-007). La tabla `superadmin_organizacion_activa` no cambia
  de estructura.
- "Pantalla que depende de una organización" es, por ahora, únicamente
  `clientes`; el mecanismo se diseña para que sumar una pantalla nueva a
  esa categoría (por ejemplo, una futura gestión de miembros) no requiera
  repetir esta lógica desde cero.
- No se construye en esta spec ninguna gestión de membresías (invitar,
  remover, cambiar rol) — eso corresponde a una spec futura.
