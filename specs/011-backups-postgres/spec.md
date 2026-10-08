# Feature Specification: Backups automáticos de la base de datos

**Feature Branch**: `011-backups-postgres`

**Created**: 2026-09-13

**Status**: Draft

**Input**: User description: "Backups automáticos de la base de datos,
transversales a cualquier producto derivado del template, orquestados con
Kestra. Hoy no existe ningún backup automatizado de la base de datos de
Supabase en el repo. Es una capacidad genérica (el template no conoce el
dominio de los datos, solo sabe que hay que respaldarlos) que cualquier
producto derivado necesita antes de operar con datos reales. Un mecanismo
corre en un horario programado (diario) y también se puede disparar
manualmente bajo demanda. Al arrancar queda registrado que el respaldo está
en progreso; el mecanismo exporta la base completa a un archivo y verifica
que no esté vacío ni corrupto antes de darlo por válido; al terminar el
registro queda actualizado con el resultado (completado, con tamaño y
ubicación del archivo, o error con el motivo), de forma que se pueda
auditar el historial de respaldos a lo largo del tiempo. Debe funcionar
igual en desarrollo local que en staging/VPS, aunque el destino de
almacenamiento del archivo pueda diferir. Fuera de alcance para esta
primera entrega: restaurar un respaldo y verificar que la restauración
funciona; políticas de retención/borrado de respaldos viejos; alertas o
notificaciones ante un fallo."

**Delivery scope**: kestra | supabase

## Clarifications

### Session 2026-09-13

- Q: ¿Qué tan a fondo hay que verificar que un backup "no esté corrupto"
  antes de marcarlo completado? → A: Verificación estructural liviana — el
  archivo no está vacío, tiene el formato esperado y no se cortó a mitad de
  camino. Nunca se intenta restaurarlo de prueba (eso es "restaurar",
  explícitamente fuera de alcance de esta entrega).
- Q: ¿Quién debería poder acceder al archivo de backup una vez guardado? →
  A: Acceso restringido — solo el mecanismo de backup y el superadmin (vía
  acceso operativo directo a la infraestructura) pueden llegar al archivo.
  Ningún rol de organización, ni siquiera indirectamente, dado que el
  archivo contiene una copia completa de `auth.users` y de los datos de
  todas las organizaciones a la vez.
- Q: Si el template llega a operar varios entornos (local, staging,
  producción) para un mismo producto, ¿cómo se organiza el historial de
  backups entre ellos? → A: Historial separado por entorno — cada entorno
  es una base de datos de Supabase completamente distinta (mismo patrón ya
  usado hoy en el template), así que su historial de respaldos vive
  naturalmente ahí, sin una columna de "entorno" ni una vista combinada
  entre entornos.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - El respaldo diario corre solo y deja un resultado verificable (Priority: P1)

Como responsable de operar cualquier producto derivado del template, no
tengo que acordarme de respaldar la base de datos: todos los días, sin que
nadie lo dispare a mano, se genera una copia completa y queda un registro
de si salió bien o mal.

**Why this priority**: Es el único valor de negocio real de esta
funcionalidad — sin esto, seguimos sin backups, que es el problema que la
motiva. Todo lo demás (disparo manual, historial) depende de que este
mecanismo exista primero.

**Independent Test**: Se puede probar dejando pasar el horario programado
(o adelantándolo en un entorno de prueba) y confirmando que aparece un
registro nuevo con estado completado, tamaño y ubicación del archivo
resultante.

**Acceptance Scenarios**:

1. **Given** que llega el horario programado del respaldo diario, **When**
   el mecanismo arranca, **Then** queda registrado de inmediato que el
   respaldo está en progreso, con el momento de inicio.
2. **Given** un respaldo en progreso que termina de exportar la base y pasa
   la verificación de que el archivo no está vacío ni corrupto, **When**
   se da por terminado, **Then** el registro queda en estado completado,
   con el tamaño y la ubicación del archivo resultante.
3. **Given** un respaldo programado que falla en cualquier punto (la
   exportación no arranca, se corta a mitad de camino, o el archivo
   resultante está vacío o corrupto), **When** se detecta el fallo,
   **Then** el registro queda en estado error, con el motivo del fallo
   descrito de forma legible.
4. **Given** que el respaldo de un día falló, **When** llega el horario
   programado del día siguiente, **Then** el mecanismo intenta un nuevo
   respaldo con normalidad, sin quedar bloqueado por el fallo anterior.

---

### User Story 2 - Disparar un respaldo bajo demanda (Priority: P2)

Como superadmin, antes de una operación riesgosa (por ejemplo, una
migración importante) o simplemente porque lo necesito en ese momento,
puedo pedir un respaldo ahora mismo, sin esperar al horario programado, y
usando el mismo mecanismo confiable que el automático.

**Why this priority**: Cubre el caso en el que esperar al horario
programado no alcanza; depende de que el mecanismo base (US1) ya exista,
porque reutiliza exactamente el mismo camino.

**Independent Test**: Como superadmin, disparar un respaldo manual en
cualquier momento del día y confirmar que sigue el mismo ciclo que uno
programado (en progreso → completado o error), quedando indistinguible en
el historial salvo por su origen (programado vs. manual).

**Acceptance Scenarios**:

1. **Given** que no hay ningún respaldo corriendo en este momento, **When**
   el superadmin dispara uno manual, **Then** el mecanismo lo ejecuta de
   inmediato, con el mismo comportamiento y las mismas verificaciones que
   uno programado.
2. **Given** que ya hay un respaldo en progreso (programado o manual),
   **When** alguien intenta disparar otro, **Then** el sistema lo rechaza
   explícitamente en vez de ejecutar dos respaldos al mismo tiempo sobre el
   mismo entorno.
3. **Given** un respaldo disparado manualmente, **When** se consulta su
   registro después, **Then** queda identificado como de origen manual, a
   diferencia de uno programado.

---

### User Story 3 - Auditar el historial de respaldos (Priority: P3)

Como superadmin, puedo revisar el historial completo de respaldos pasados
de un entorno — no solo el último — para confirmar que se vienen
ejecutando de forma confiable a lo largo del tiempo, o para encontrar
cuándo empezó a fallar si algo salió mal.

**Why this priority**: Es valor incremental sobre US1 y US2: el mecanismo
ya funciona y deja registros individuales sin esto; esta historia es sobre
poder mirarlos en conjunto en vez de uno por uno.

**Independent Test**: Con al menos un respaldo completado y uno con error
en el historial de un entorno, confirmar que ambos quedan disponibles para
revisión, con su resultado y motivo (si aplica) distinguibles entre sí.

**Acceptance Scenarios**:

1. **Given** varios respaldos ya ejecutados (programados y manuales,
   completados y con error), **When** el superadmin revisa el historial,
   **Then** puede ver todos, no solo el más reciente.
2. **Given** un respaldo con error en el historial, **When** el superadmin
   lo revisa, **Then** el motivo del fallo es legible sin necesitar revisar
   herramientas técnicas externas al mecanismo.

### Edge Cases

- ¿Qué pasa si se dispara un respaldo manual mientras el programado del día
  ya está corriendo? Se rechaza el segundo — nunca compiten dos respaldos
  al mismo tiempo sobre el mismo entorno.
- ¿Qué pasa si la base de datos no está disponible en el horario
  programado? Queda registrado como error con el motivo, y no impide el
  intento del día siguiente.
- ¿Qué pasa si el destino de almacenamiento se queda sin espacio a mitad de
  la exportación? Queda registrado como error explícito — nunca como un
  archivo completado que en realidad está incompleto.
- ¿Qué pasa si el archivo se genera pero no pasa la verificación
  estructural (vacío, formato inesperado, o cortado a mitad de camino)? El
  registro queda en error, nunca en completado — un archivo que no pasó la
  verificación no se considera un respaldo válido aunque exista en el
  destino de almacenamiento.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE generar automáticamente, en un horario
  programado diario, un respaldo completo de la base de datos de cada
  entorno, sin intervención humana.
- **FR-002**: El sistema DEBE permitir al superadmin disparar un respaldo
  bajo demanda, en cualquier momento, siguiendo el mismo mecanismo que el
  respaldo programado.
- **FR-003**: El sistema NO DEBE permitir dos respaldos simultáneos sobre
  el mismo entorno — un respaldo en progreso bloquea el disparo de otro
  hasta terminar.
- **FR-004**: Al arrancar cualquier respaldo (programado o manual), el
  sistema DEBE dejar registrado de inmediato que está en progreso, junto
  con su origen y momento de inicio.
- **FR-005**: Antes de dar un respaldo por válido, el sistema DEBE
  verificar que el archivo resultante no esté vacío, tenga el formato
  esperado y no se haya cortado a mitad de camino. Esta verificación es
  estructural (sobre el archivo en sí) — nunca implica restaurarlo de
  prueba, eso es una capacidad distinta y queda fuera de esta entrega.
- **FR-006**: Al terminar un respaldo, el sistema DEBE actualizar su
  registro con el resultado: completado (con tamaño y ubicación del
  archivo) o error (con el motivo del fallo, descrito de forma legible
  para quien lo revise después).
- **FR-007**: El sistema DEBE conservar el historial completo de respaldos
  pasados de cada entorno, no solo el más reciente, disponible para
  revisión por el superadmin.
- **FR-008**: Un respaldo fallido NO DEBE impedir que el siguiente respaldo
  programado se ejecute con normalidad.
- **FR-009**: El mecanismo DEBE comportarse de la misma forma en desarrollo
  local que en staging/producción, aunque el destino de almacenamiento del
  archivo resultante pueda ser distinto entre entornos.
- **FR-010**: El sistema NO DEBE requerir ningún conocimiento del dominio
  de negocio de los datos que respalda — debe funcionar igual sin importar
  qué producto derivado lo use.
- **FR-011**: El sistema DEBE restringir el acceso al archivo de cada
  respaldo únicamente al mecanismo de backup y al superadmin con acceso
  operativo directo a la infraestructura — ningún rol de organización
  (administrador o miembro) puede llegar a él, ni directa ni
  indirectamente, dado que contiene una copia completa de los datos de
  autenticación y de todas las organizaciones a la vez.

### Key Entities

- **Respaldo**: un intento puntual de generar una copia completa de la
  base de datos. Vive dentro de la propia base de datos del entorno que
  respalda — no hay un registro combinado entre entornos, porque cada
  entorno (local, staging, producción) es una base de Supabase
  independiente. Atributos relevantes: origen (programado o manual),
  momento de inicio, estado (en progreso, completado, error), tamaño y
  ubicación del archivo resultante (si completó), motivo del fallo (si
  falló). Entidad genérica: no conoce el dominio de los datos que
  respalda, y es reutilizable por cualquier producto derivado del
  template.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Durante 7 días consecutivos de operación normal, el 100% de
  los respaldos programados queda con un resultado registrado (completado
  o error) — ninguno se pierde sin dejar rastro.
- **SC-002**: Se puede determinar, en menos de 1 minuto y sin herramientas
  técnicas externas al mecanismo, si el último respaldo de un entorno salió
  bien y cuándo fue.
- **SC-003**: Disparar un respaldo bajo demanda no requiere ninguna
  intervención manual fuera del mecanismo ya existente (ningún script
  ad-hoc por caso).
- **SC-004**: Un respaldo con error queda identificable, junto con su
  motivo, sin necesidad de revisar logs técnicos fuera del historial de
  respaldos.

## Assumptions

- Fuera de alcance de esta entrega: restaurar un respaldo y verificar que
  la restauración funciona; políticas de retención o borrado de respaldos
  viejos (se conservan indefinidamente hasta que exista una); alertas o
  notificaciones ante un fallo (hoy un fallo solo queda registrado, nadie
  es avisado proactivamente). Cada uno queda como candidato a una spec
  futura, dependiente de esta.
- El respaldo cubre la base de datos completa (todas las tablas y esquemas
  existentes, incluida la autenticación) — nunca una lista de tablas
  puntuales, para que una tabla nueva de una spec futura quede cubierta
  automáticamente sin tener que actualizar este mecanismo. NO cubre los
  archivos subidos a almacenamiento de objetos (por ejemplo, fotos de
  perfil de la spec 008): esos son bytes fuera de la base de datos. Si hace
  falta respaldarlos, es una spec aparte.
- No se construye una pantalla en Refine en esta entrega — el historial de
  respaldos se consulta directamente en el mecanismo de registro. Si
  aparece la necesidad de verlo embebido en el producto, es una spec
  futura.
- El horario exacto del respaldo diario y el destino de almacenamiento
  concreto por entorno son decisiones de implementación, no de negocio —
  se resuelven en la fase de plan.
- Solo el superadmin puede disparar un respaldo manual y consultar el
  historial — mismo patrón ya usado para el acceso directo a otras
  herramientas internas del stack.
- Existe al menos un entorno con una base de datos real corriendo (local
  hoy; staging/producción cuando exista un producto derivado desplegado) —
  esta especificación no crea esa base, solo la respalda.
