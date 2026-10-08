# Feature Specification: Analítica embebida por organización

**Feature Branch**: `007-analitica-embebida`

**Created**: 2026-09-09

**Status**: Implemented

**Input**: User description: "Integrar Superset como una funcionalidad más del
producto para mostrar analítica a cada organización, embebida dentro de
Refine y no como una herramienta aparte. El superadmin es quien crea y
administra reportes, datasets y charts en Superset; cada reporte puede
asignarse a una, varias, o todas las organizaciones, y cada organización solo
ve sus propios datos dentro de esos reportes compartidos. Además de a qué
organizaciones se asigna un reporte, se controla qué roles internos de cada
organización pueden verlo — administrador siempre tiene acceso incondicional,
y el resto de los roles se define por un default global que cada
organización puede ajustar para la suya."

**Delivery scope**: refine | supabase | superset

## Clarifications

### Session 2026-09-09

- Q: ¿Quién puede crear o editar reportes, datasets y charts? → A: Únicamente
  el superadmin. Ningún administrador ni miembro de organización tiene esa
  capacidad, ni acceso a Superset en absoluto.
- Q: ¿Un mismo reporte puede pertenecer a más de una organización? → A: Sí, a
  una, varias, o todas — y cada una ve únicamente los datos de su propia
  organización dentro de ese reporte compartido.
- Q: ¿Cómo accede el superadmin a crear/editar reportes? → A: Directo en
  Superset, con su propia URL y login — igual que ya accede a otras
  herramientas internas del stack (Kestra, Supabase Studio). No se embebe la
  edición dentro de Refine.
- Q: ¿Quién controla qué roles de una organización ven un reporte asignado?
  → A: El superadmin define un default global al registrar el reporte; el
  administrador de cada organización puede ajustarlo para la suya. La
  organización hereda ese default una sola vez, al momento de asignarse el
  reporte — cambios posteriores al default global no se propagan a
  organizaciones ya asignadas.
- Q: ¿El rol administrador puede quedar excluido de ver algún reporte? → A:
  No — administrador tiene acceso incondicional a cualquier reporte asignado
  a su organización; no es una opción configurable.
- Q: ¿Qué ve una organización sin ningún reporte asignado? → A: Un mensaje
  explícito indicando que no tiene reportes configurados, no una pantalla
  vacía sin explicación.
- Q: ¿Qué debe ver una persona si intenta abrir un reporte y el servicio de
  analítica no responde en ese momento? → A: Un mensaje específico
  ("Analítica no disponible en este momento"), sin detalles técnicos del
  fallo — no un error genérico ni un reintento automático.
- Q: Si se desasigna un reporte de una organización y luego se le vuelve a
  asignar, ¿conserva la personalización de roles que tenía antes? → A: No —
  arranca de cero, copiando el default vigente del reporte en ese momento,
  igual que cualquier asignación nueva (FR-004). No se conserva ningún
  estado de una relación ya desasignada.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - El superadmin registra y asigna reportes (Priority: P1)

Como superadmin, registro en el producto un reporte que ya armé en Superset,
defino qué roles lo ven por defecto, y lo asigno a una o más organizaciones,
para que empiecen a verlo sin que nadie tenga que tocar código ni configurar
nada por fuera del producto.

**Why this priority**: Sin esto no existe ningún reporte que una
organización pueda ver — es la base de la que dependen las demás historias.

**Independent Test**: Como superadmin, registrar un reporte existente de
Superset, definir su visibilidad por rol por defecto, y asignarlo a una
organización. Confirmar que la organización queda con ese reporte disponible
y con la visibilidad heredada correctamente.

**Acceptance Scenarios**:

1. **Given** un reporte ya creado en Superset, **When** el superadmin lo
   registra en el catálogo y define que lo vean los roles administrador y
   miembro, **Then** el reporte queda disponible para asignar, con esa
   visibilidad como su default.
2. **Given** un reporte registrado, **When** el superadmin lo asigna a la
   organización X, **Then** X queda con ese reporte disponible y con la
   visibilidad por rol copiada desde el default en ese momento.
3. **Given** un reporte ya asignado a la organización X, **When** el
   superadmin asigna el mismo reporte también a la organización Y,
   **Then** Y queda con acceso igual que X, sin afectar la configuración de
   X.
4. **Given** un reporte con default "administrador y miembro", **When** el
   superadmin cambia el default a "solo administrador" después de que X ya
   estaba asignada, **Then** la visibilidad de X no cambia — el ajuste solo
   aplica a asignaciones nuevas.
5. **Given** un reporte asignado a X, **When** el superadmin lo desasigna y
   luego lo vuelve a asignar, **Then** la visibilidad por rol de X se
   inicializa nuevamente desde el default vigente del reporte en ese
   momento, sin conservar la personalización que X tenía antes de ser
   desasignada.

---

### User Story 2 - Miembros y administradores visualizan sus reportes (Priority: P2)

Como miembro o administrador de una organización, veo dentro del producto —
sin salir de Refine ni saber que Superset existe — los reportes que le
fueron asignados a mi organización, mostrando únicamente los datos de mi
propia organización.

**Why this priority**: Es el valor que un cliente real recibe de esta
funcionalidad; depende de que exista al menos un reporte asignado (Historia
1).

**Independent Test**: Con un reporte ya asignado a la organización X y
visible para el rol del usuario, entrar como miembro de X y confirmar que el
reporte se ve embebido en el producto, con datos correspondientes solo a X.
Repetir con un usuario de otra organización y confirmar que no lo ve ni
puede acceder a los datos de X por ningún medio.

**Acceptance Scenarios**:

1. **Given** un reporte asignado a la organización X y visible para el rol
   de la persona que consulta, **When** esa persona abre la sección de
   analítica del producto, **Then** ve el reporte embebido con los datos de
   X únicamente.
2. **Given** el mismo reporte asignado también a la organización Y,
   **When** una persona de Y lo abre, **Then** ve el mismo reporte pero con
   los datos de Y, nunca los de X.
3. **Given** una organización sin ningún reporte asignado, **When** alguien
   de esa organización entra a la sección de analítica, **Then** el sistema
   le informa que no tiene reportes configurados, sin mostrar una pantalla
   vacía sin explicación.
4. **Given** un reporte no asignado a la organización de quien consulta,
   **When** esa persona intenta acceder a él por cualquier vía (incluyendo
   conocer o adivinar su identificador), **Then** el acceso es rechazado sin
   revelar ningún dato del reporte.
5. **Given** un reporte asignado a X pero cuyo default de rol no incluye al
   rol de quien consulta (y esa persona no es administrador), **When**
   intenta acceder, **Then** el acceso es rechazado.
6. **Given** el servicio de analítica no responde, **When** una persona
   intenta abrir un reporte, **Then** ve un mensaje específico indicando que
   la analítica no está disponible en este momento, sin detalles técnicos
   del fallo.

---

### User Story 3 - El administrador ajusta la visibilidad por rol de su organización (Priority: P3)

Como administrador de una organización, puedo cambiar, solo para mi propia
organización, qué roles internos ven cada reporte que nos fue asignado —
partiendo de lo que heredamos por defecto — sin afectar a otras
organizaciones ni al default que definió el superadmin.

**Why this priority**: Es un ajuste fino sobre la Historia 2; sin esta
historia, cada organización sigue funcionando con lo heredado por defecto,
que ya es un comportamiento correcto y usable.

**Independent Test**: Como administrador de la organización X, con un
reporte ya asignado visible para administrador y miembro, quitarle
visibilidad al rol miembro. Confirmar que un miembro de X deja de verlo,
mientras que otra organización con el mismo reporte no se ve afectada.

**Acceptance Scenarios**:

1. **Given** un reporte asignado a X con el rol miembro habilitado,
   **When** el administrador de X le quita la visibilidad al rol miembro,
   **Then** los miembros de X dejan de ver ese reporte, pero los
   administradores de X lo siguen viendo.
2. **Given** el mismo reporte asignado también a la organización Y,
   **When** el administrador de X cambia la visibilidad por rol de su
   organización, **Then** la configuración de Y no se modifica.
3. **Given** cualquier configuración de roles que el administrador intente
   guardar, **When** intenta quitarle la visibilidad al rol administrador,
   **Then** el sistema no lo permite — administrador conserva acceso
   incondicional.

### Edge Cases

- Un rol de organización nuevo, agregado al catálogo de roles después de que
  un reporte ya tenga visibilidad definida, arranca sin acceso a ningún
  reporte existente hasta que alguien lo habilite explícitamente — ni el
  default global ni las asignaciones ya hechas lo incluyen de forma
  retroactiva.
- Quitarle a una organización la asignación de un reporte, o restringirle un
  rol, no interrumpe al instante una visualización que esa persona ya tenga
  abierta — el rechazo aplica desde la siguiente solicitud de acceso.
- Si el mismo reporte queda asignado a todas las organizaciones existentes,
  cada una sigue viendo solo sus propios datos — la asignación amplia no
  cambia el aislamiento de datos.
- Un superadmin que borra o renombra un reporte directamente en Superset sin
  reflejar ese cambio en el catálogo interno deja una entrada inconsistente;
  mantenerlas sincronizadas es responsabilidad de quien administra Superset,
  no una validación automática de esta funcionalidad.
- Si el servicio de analítica no responde al abrir un reporte, el sistema
  muestra un mensaje específico de no disponibilidad en vez de un error
  genérico, una pantalla rota, o un reintento automático silencioso.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE permitir únicamente al superadmin registrar un
  reporte (asociado a un dashboard existente de Superset) en un catálogo
  interno.
- **FR-002**: El sistema DEBE permitir al superadmin definir, por reporte,
  qué roles de organización lo ven por defecto, además de administrador
  (que queda cubierto por FR-006, no por esta configuración).
- **FR-003**: El sistema DEBE permitir al superadmin asignar, y también
  desasignar, un reporte registrado de una, varias, o todas las
  organizaciones.
- **FR-004**: Al asignarse un reporte a una organización, el sistema DEBE
  copiar en ese momento la visibilidad por rol definida como default en ese
  reporte. Cambios posteriores al default global NO DEBEN alterar
  organizaciones que ya tengan el reporte asignado.
- **FR-005**: El sistema DEBE permitir al administrador de una organización
  modificar, solo para su propia organización, qué roles ven cada reporte
  que le fue asignado, sin afectar a otras organizaciones ni al default
  global.
- **FR-006**: El sistema DEBE otorgar al rol administrador acceso
  incondicional a cualquier reporte asignado a su organización, sin que
  ninguna pantalla permita restringírselo.
- **FR-007**: El sistema DEBE mostrar a cada persona únicamente los reportes
  asignados a su organización cuyo rol esté habilitado para verlos (o que
  sea administrador).
- **FR-008**: El sistema DEBE mostrar cada reporte embebido dentro del
  producto, sin redirigir a una pantalla de login de Superset ni exponer
  sus credenciales al usuario final. El dominio de Superset puede ser
  visible como parte del propio mecanismo de embebido (un iframe siempre
  revela su origen) — lo que no debe existir es una ruta de acceso directo
  y separada a Superset para el usuario final (eso ya lo cubre FR-013).
- **FR-009**: El sistema DEBE limitar los datos visibles dentro de un
  reporte a los de la organización de quien lo consulta, incluso cuando el
  mismo reporte está asignado a más de una organización.
- **FR-010**: El sistema DEBE verificar, del lado del servidor y en cada
  solicitud de acceso a un reporte, que la organización y el rol de quien lo
  pide están efectivamente habilitados — sin confiar en ningún dato provisto
  por quien hace la solicitud.
- **FR-011**: El sistema DEBE informar explícitamente cuando una
  organización no tiene ningún reporte asignado, en vez de mostrar una
  pantalla vacía sin explicación.
- **FR-012**: El sistema DEBE registrar quién asignó o desasignó un reporte
  a una organización, y quién modificó la visibilidad por rol de una
  organización, con cuándo ocurrió cada cambio.
- **FR-013**: El sistema NO DEBE otorgar a ningún administrador ni miembro
  de organización acceso directo a Superset (edición de reportes, datasets,
  charts, o consultas) — su único acceso es la visualización embebida de
  reportes ya asignados.
- **FR-014**: Un rol de organización agregado al catálogo de roles después
  de que un reporte ya tenga visibilidad definida DEBE arrancar sin acceso a
  ese reporte hasta que se lo habilite explícitamente.
- **FR-015**: El sistema DEBE mostrar un mensaje específico indicando que la
  analítica no está disponible en este momento cuando el servicio de
  analítica no responde a un pedido de reporte, sin exponer detalles
  técnicos del fallo.
- **FR-016**: Al reasignarse un reporte previamente desasignado de una
  organización, el sistema DEBE inicializar su visibilidad por rol desde el
  default vigente del reporte en ese momento (mismo comportamiento que
  FR-004), sin conservar ninguna personalización previa de esa organización.

### Key Entities

- **Reporte**: entrada del catálogo interno que referencia un dashboard real
  de Superset, con un nombre para mostrar y su visibilidad por rol por
  defecto.
- **Asignación de reporte a organización**: qué organizaciones tienen acceso
  a un reporte determinado; puede crearse y quitarse. Quitarla no conserva
  la personalización de roles que la organización tenía — una reasignación
  posterior arranca desde el default vigente del reporte.
- **Visibilidad por rol de una organización**: qué roles internos de una
  organización puntual pueden ver un reporte que le fue asignado; se
  inicializa desde el default del reporte al momento de la asignación y
  luego es independiente.
- **Rol de organización**: catálogo ya existente (`administrador`,
  `miembro`, y los que se agreguen a futuro); esta funcionalidad lo reutiliza
  sin modificarlo.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Una persona de una organización encuentra y abre un reporte
  asignado a la suya sin ayuda externa, desde el mismo menú del producto que
  ya usa para todo lo demás.
- **SC-002**: Ninguna organización puede ver, bajo ninguna circunstancia,
  datos de otra organización dentro de un reporte compartido.
- **SC-003**: El superadmin puede poner un reporte nuevo a disposición de
  una organización sin ninguna intervención técnica adicional ni despliegue
  de código.
- **SC-004**: El 100% de las asignaciones de reportes y cambios de
  visibilidad por rol quedan auditados con quién, qué organización, y
  cuándo.
- **SC-005**: Una organización sin reportes asignados recibe siempre una
  explicación clara, nunca una pantalla vacía sin contexto.

## Assumptions

- La creación y edición de reportes, datasets y charts ocurre directamente
  en Superset (o vía archivos de configuración versionados), fuera de este
  producto — esta funcionalidad cubre el catálogo, la asignación, la
  visibilidad por rol y la visualización embebida, no la autoría en sí.
- La duración de cada sesión de visualización de un reporte sigue un
  estándar corto y renovable, sin intervención del usuario; no es una
  decisión de negocio a especificar acá.
- `roles_organizacion` (spec 003) sigue siendo el catálogo de roles de
  referencia; esta funcionalidad no lo modifica, solo lo consume.
- Mantener sincronizado el catálogo interno de reportes con lo que
  efectivamente existe en Superset (si se borra o renombra algo directo en
  Superset) es responsabilidad operativa de quien administra Superset, no
  una validación automática de esta funcionalidad.
