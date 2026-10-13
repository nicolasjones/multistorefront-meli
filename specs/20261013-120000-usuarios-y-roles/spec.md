# Feature Specification: Acceso, organización y permisos · Usuarios y roles

**Feature Branch**: `epic/MSF-125-acceso-organizacion-y-permisos-usuarios-`

**Jira Epic**: MSF-125 — Acceso, organización y permisos · Usuarios y roles (spec `usuarios-y-roles`)

**Created**: 2026-10-13

**Status**: Ready for implementation — la especificación viene completa desde Jira. Las decisiones de "A revisar" son de planificación (horas, fechas) o de diseño pendiente de dibujar y no bloquean la implementación; ver *Pendientes de diseño*.

**Delivery scope**: `refine` (apps/web) y `supabase` (migraciones, RLS, Edge Function `invitar-miembro`, pgTAP). Sin `kestra`, `superset` ni `workers`.

**Prioridad / Hito**: P0 · Hito 1 (6 al 30 de octubre de 2026) · 44 h aprox. (F-USR-01 8 + F-USR-02 8 + F-ROL-01 12 + F-ROL-02 12 + F-ROL-03 4). Con 44 h las fechas 16 al 22 de octubre no alcanzan: replanificar junto con MSF-121.

**Dependencias**:
- Bloqueada por: MSF-119 (Acceso y organización) — F-ACC-01 crea `usuarios_organizacion.estado`, que F-USR-02 administra.
- Bloquea a: MSF-121 (Permisos por empresa; parte de `roles_organizacion`, `permisos_rol`, `private.nivel_seccion` y de los diálogos Invitar y Editar usuario), MSF-132 (Administración de usuarios y organización; F-USR-03 se agrega a la pantalla Usuarios) y MSF-148 (Perfil y permisos avanzados; F-ROL-05 extiende la pantalla de F-ROL-03).
- Entre historias: F-ROL-01 bloquea a F-ROL-03, F-USR-01, F-USR-02 y F-ROL-02.
- Ya no bloquea a MSF-138 (Empresas): se apoya en la audiencia administrador y `private.puede_escribir()` del template. El caso «un Operador abre Empresas por URL» (CA-EMP-01-4) se verifica cuando F-ROL-01 y F-ROL-03 estén mergeadas.
- Relacionada, sin bloqueo: registro de actividad transversal (F-AUD-01, Plataforma).

**Input**: Epic MSF-125. Objetivo: "Al terminar, un administrador invita, edita y suspende personas, y cada rol ve y puede hacer solo lo que le corresponde, tanto en pantalla como en la base de datos; el Administrador de cada organización ajusta qué puede y qué no puede hacer cada rol sin tocar código."

**Regla de fuentes** (literal de la épica): el prototipo validado por el cliente y los documentos mandan sobre Jira; ante conflicto entre documentos, manda el prototipo. Lo que se ve y cómo funciona lo definen el prototipo y los artefactos; la estética y los componentes salen del sistema de diseño (MSF-117, `docs/sistema-de-diseno.md`), **sin copiar HTML ni CSS** del prototipo. Lo que el prototipo no dibuja queda como *pendiente de dibujar*, sin inventarlo.

**Prototipo (solo lectura, rama `design/prototipo`, carpeta `design/pantallas/`)**: `Usuarios.dc.html` (listado, diálogos «Invitar usuario», «Editar usuario» y «Suspender usuario»), `Roles.dc.html` (6 roles, grilla editable de 16 secciones), `AccesoRestringido.dc.html` (rol Operador), `DefinirContrasena.dc.html` (Acceso · Definir contraseña), más `AdminSider.dc.html` para el menú. Los artboards se leen en la rama `design/prototipo` (PR #8, sin mergear).

## Qué trae el template y qué construye esta épica

**Template (se reutiliza)**: dos roles (`administrador`, `miembro`) en la tabla `roles_organizacion` (agregar un rol es una fila); gestión de miembros (Edge Function `invitar-miembro`, listar, cambiar rol, remover, `eventos_membresia`; specs 005 y 010); `accessControlProvider` de Refine; hooks `usePuedeEscribir` / `usePuedeGestionarMembresias`; navegación por audiencias; la grilla `GrillaPermisosPorRol.tsx` (por nombre — no verificado qué muestra; se revisa antes de reutilizarla).

**Esta épica construye (es una extensión, no una adecuación)**: cinco roles de negocio más (`operador`, `consulta`, `mostrador`, `deposito`, `administracion`) como filas de `roles_organizacion`; permisos por sección y por acción propios de cada organización (las políticas del template solo distinguen «puede escribir» de «no»): `permisos_rol`, `permisos_rol_accion`, `private.nivel_seccion(seccion)`, `private.puede_accion(seccion, accion)`; edición de la matriz por el Administrador de cada organización; invitaciones con vencimiento / reenvío / cancelación; estados de usuario y suspensión; pantalla de acceso restringido.

## Clarifications

Decisiones ya tomadas por Nicolás en la épica (no se reabren):

- El prototipo y los documentos mandan sobre Jira. La **matriz inicial** de F-ROL-01 es la de `Roles.dc.html`; sus 12 diferencias con el documento de requisitos están en MSF-258 como registro de cambios (el prototipo ya fue validado por el cliente).
- «Roles básicos» de F-ROL-01 se lee como **6 roles**. El documento de Funcionalidades (6/10) todavía habla de 3 roles.
- F-ROL-02 (matriz editable) se entrega en esta épica, Hito 1 (antes estaba en MSF-121 / Hito 2).
- La asignación de tiendas y rol por tienda de `Usuarios.dc.html` es de MSF-121 (Hito 2); allí el selector de rol por tienda debe ofrecer **los seis roles** (el prototipo dibuja solo Administrador, Operador y Consulta). Esta épica entrega los diálogos Invitar y Editar usuario con los seis roles.
- **Una sola pantalla de personas (instrucción de Nicolás, 2026-10-13)**: la pantalla Usuarios y la pantalla Miembros del template (`pages/miembros`) NO conviven como dos pantallas. Usuarios es la pantalla canónica y absorbe la de Miembros: reutiliza sus RPC (`listar_miembros_organizacion`, `cambiar_rol_miembro`, `remover_miembro`), la Edge Function `invitar-miembro` y sus patrones de UI (identidad visible, estados, tabla adaptable); `/miembros` y `/miembros/create` redirigen a `/usuarios` (FR-019).
- **Esquema de cada tabla (instrucción de Nicolás, 2026-10-13)**: lo genérico va a `public`, lo de dominio del producto a `dominio` (Principio VII, constitución 1.7.2). Cada tabla de esta spec está declarada en *Esquemas de datos* y la verificación se repite en plan, tareas, implementación y revisión.
- **Contrato para las demás épicas**: toda tabla de dominio de Catálogo, Stock, Ventas, etc. debe usar `private.nivel_seccion(seccion)` en sus políticas; ese contrato lo fija esta spec (FR-007, `docs/permisos-por-rol.md`).

## User Scenarios & Testing *(mandatory)*

Los escenarios se derivan del objetivo de la épica, de las historias previstas y de lo que dibuja el prototipo; no agregan alcance.

### User Story 1 - Roles básicos y permisos por organización (F-ROL-01, P0, talla L) 🎯 MVP

Como Administrador de una organización, quiero que existan los seis roles de negocio y que cada uno vea y pueda hacer solo lo que le corresponde por sección, tanto en pantalla como en la base de datos, para que nadie acceda a lo que su rol no incluye.

**Why this priority**: Es la base que bloquea a las otras cuatro historias y a MSF-121. Es la historia más riesgosa: reemplaza el control `puede_escribir` por permisos por sección y acción, por organización, en el panel y en las políticas.

**Independent Test**: pgTAP por rol (sesión con cada uno de los seis roles contra tablas con `private.nivel_seccion`) y prueba de UI de que el menú y las rutas respetan el nivel.

**Acceptance Scenarios**:

1. **Given** el template con `administrador` y `miembro`, **When** se aplica la migración, **Then** `roles_organizacion` contiene además `operador`, `consulta`, `mostrador`, `deposito` y `administracion` (filas nuevas, sin tocar las existentes).
2. **Given** una organización, **When** se crea (o ya existía), **Then** tiene su propia matriz con los valores iniciales de `Roles.dc.html` (ver *Matriz inicial*), independiente de la de otras organizaciones.
3. **Given** un usuario con un rol cuya sección está en «Sin acceso», **When** consulta una tabla de esa sección, **Then** la base de datos no le devuelve filas ni le permite escribir, aunque llame a la API directamente.
4. **Given** un usuario con nivel «Solo lectura» en una sección, **When** intenta crear, editar o borrar, **Then** la base de datos lo rechaza y la pantalla no ofrece esas acciones.
5. **Given** un usuario con nivel «Edición», **When** opera en su sección, **Then** puede leer y escribir (y las acciones eliminar, exportar y ver costos según sus valores propuestos, ver FR-006).
6. **Given** secciones sin acceso para un rol, **When** se renderiza el menú lateral, **Then** esas secciones **no aparecen** en el menú.
7. **Given** el rol Administrador, **When** se intenta restringirlo, **Then** conserva «Edición» en todas las secciones (no se puede restringir).
8. **Given** un usuario de la organización A, **When** consulta permisos o datos de la organización B, **Then** no ve nada (aislamiento por RLS).
9. **Given** el template y las tablas que ya usan `private.puede_escribir()`, **When** se aplica la épica, **Then** el comportamiento existente del template se conserva hasta que cada tabla migre al nuevo contrato (sin romper `pnpm test`).

### User Story 2 - Pantalla de acceso restringido (F-ROL-03, P0, talla S)

Como persona con un rol que no incluye una sección, quiero ver una pantalla clara cuando abro esa sección (p. ej. por URL), para entender por qué no accedo y qué hacer.

**Why this priority**: Cierra el ciclo de F-ROL-01 en pantalla; es chica. Depende de que el control de acceso niegue la sección.

**Independent Test**: E2E: un Operador abre Rentabilidad por URL y ve la pantalla; los datos no se cargan.

**Acceptance Scenarios**:

1. **Given** un Operador, **When** abre `Rentabilidad` (o cualquier sección sin acceso) por URL, **Then** ve la pantalla «No tenés acceso a esta sección» con el texto «Tu rol (Operador) no incluye Rentabilidad. Pedile acceso a un administrador.» (rol y sección reales del caso).
2. **Given** la pantalla de acceso restringido, **When** pulsa «Volver al inicio», **Then** vuelve al inicio.
3. ~~«Solicitar acceso» con confirmación «Solicitud enviada al administrador»~~ — **fuera de alcance por decisión del orquestador**: no hay canal de solicitud al administrador y una confirmación sin envío real sería engañosa. La pantalla indica que se pida el acceso a un administrador. Reabrir con spec propia si se define el canal.
4. **Given** una sección denegada, **When** se muestra la pantalla, **Then** no se solicita ni se muestra ningún dato de la sección.
5. **Given** la pantalla, **When** se usa con teclado y lector de pantalla, **Then** es operable y anuncia el motivo (Principio VI).

### User Story 3 - Invitar usuarios (F-USR-01, P0, talla M)

Como Administrador, quiero invitar a una persona por correo con uno de los seis roles, para que defina su contraseña y entre al panel.

**Why this priority**: Es la forma de sumar personas a la organización.

**Independent Test**: E2E de invitar desde el diálogo y completar «Definir contraseña»; pgTAP/integración de vencimiento a 7 días.

**Acceptance Scenarios**:

1. **Given** un Administrador, **When** abre «Invitar usuario», **Then** ve el campo Correo electrónico y la elección de Rol entre los seis roles, cada uno con su descripción y el enlace «Ver permisos de este rol →».
2. **Given** correo y rol válidos, **When** pulsa «Enviar invitación», **Then** se crea la invitación, la persona queda en estado «Invitación pendiente», recibe un enlace por correo para definir su contraseña y se confirma «Invitación enviada».
3. **Given** una invitación, **When** pasan 7 días sin aceptarla, **Then** vence y el enlace deja de servir.
4. **Given** una invitación pendiente o vencida, **When** el Administrador la reenvía, **Then** se emite un enlace nuevo con vencimiento de 7 días; **When** la cancela, **Then** el enlace deja de servir.
5. **Given** el enlace de invitación, **When** la persona abre «Definir contraseña», **Then** ve «Fuiste invitado como <rol>», con nueva contraseña (al menos 12 caracteres, mayúscula y minúscula, un número y un símbolo) y confirmación, y el aviso «Las contraseñas no coinciden» si difieren.
6. **Given** contraseña válida, **When** pulsa «Guardar y entrar», **Then** pasa a estado Activo y entra al panel con el rol invitado.
7. **Given** un correo que ya pertenece a una persona de otra organización, **When** se invita, **Then** se rechaza (una persona pertenece a una sola organización).
8. **Given** un usuario sin rol de gestión de usuarios, **When** intenta invitar por interfaz o por la API, **Then** es rechazado en la base de datos.
9. **Given** una invitación enviada, **Then** se emite el evento `usuario.invitado` (ver FR-012).

### User Story 4 - Listado, edición y suspensión de usuarios (F-USR-02, P0, talla M)

Como Administrador, quiero ver, editar y suspender a las personas de mi organización, para controlar quién entra al panel y con qué rol.

**Why this priority**: Completa el ciclo de vida del acceso; administra `usuarios_organizacion.estado` creada por MSF-119.

**Independent Test**: E2E de editar rol, suspender y reactivar; pgTAP de que un suspendido no accede.

**Acceptance Scenarios**:

1. **Given** el Administrador, **When** abre Usuarios, **Then** ve el listado con Usuario (nombre, correo), Tiendas y rol, Último acceso y Estado (Activo / Invitación pendiente / Suspendido), solo de su organización.
2. **Given** un usuario del listado, **When** abre «Editar usuario», **Then** ve nombre y correo, puede cambiar su rol entre los seis y puede «Restablecer contraseña» (envía un enlace para definir una nueva), y al guardar se confirma «Usuario guardado».
3. **Given** el cambio de rol de un usuario, **When** se guarda, **Then** se aplican de inmediato los permisos del nuevo rol (F-ROL-01) y se emite `usuario.rol_cambiado`.
4. **Given** un usuario activo, **When** pulsa «Suspender» y confirma el diálogo («<nombre> no va a poder entrar al panel hasta que lo reactives. Sus cambios anteriores se conservan en Actividad.»), **Then** pasa a Suspendido, deja de poder entrar y sus cambios anteriores se conservan; se confirma «Usuario suspendido» y se emite `usuario.suspendido`.
5. **Given** un usuario suspendido, **When** el Administrador pulsa «Reactivar», **Then** vuelve a Activo, se confirma «Usuario reactivado» y se emite `usuario.reactivado`.
6. **Given** un usuario suspendido con sesión abierta, **When** intenta operar, **Then** la base de datos le niega el acceso (no solo la UI).
7. **Given** que la organización tiene un único Administrador, **When** se intenta suspenderlo o cambiarle el rol, **Then** se rechaza (la organización conserva al menos un Administrador, como en la spec 005).
8. **Given** una persona sin permiso sobre «Usuarios y permisos», **When** abre Usuarios, **Then** ve la pantalla de acceso restringido (F-ROL-03).

### User Story 5 - Matriz de permisos editable por rol (F-ROL-02, P0, talla L)

Como Administrador de mi organización, quiero ajustar qué puede y qué no puede hacer cada rol por sección y por acción, sin tocar código, para adaptar el acceso a cómo trabaja mi empresa.

**Why this priority**: Es el segundo objetivo de la épica; parte de `permisos_rol` y `permisos_rol_accion` de F-ROL-01.

**Independent Test**: E2E de cambiar una celda y guardar; pgTAP de que el cambio se aplica a esa organización y no a otra, y de que un no-Administrador no puede modificarla.

**Acceptance Scenarios**:

1. **Given** el Administrador, **When** abre «Roles y permisos», **Then** ve los seis roles (con descripción y cantidad de usuarios, enlace «Ver →») y la grilla «Acceso por sección» con 16 secciones × 6 roles.
2. **Given** una celda de un rol distinto de Administrador, **When** hace clic, **Then** el valor rota Edición → Solo lectura → Sin acceso → Edición, y «Guardar cambios» se habilita.
3. **Given** la columna Administrador, **When** hace clic en una celda, **Then** no cambia y se avisa «El rol Administrador no se puede restringir».
4. **Given** cambios sin guardar, **When** pulsa «Guardar cambios», **Then** se persisten para esa organización, se confirma «Permisos guardados» y se aplican de inmediato en pantalla y en la base de datos; sin cambios, el botón queda deshabilitado.
5. **Given** que cada organización tiene su propia matriz, **When** el Administrador de A edita, **Then** la matriz de B no cambia; solo su Administrador puede cambiarla (otros roles y otras organizaciones son rechazados en la base de datos).
6. **Given** la matriz, **When** el Administrador edita las acciones **eliminar, exportar y ver costos** por rol y sección, **Then** se persisten en `permisos_rol_accion` y `private.puede_accion(seccion, accion)` las respeta. *(Extensión propuesta, con valores iniciales propuestos; pendiente de dibujar.)*
7. **Given** «Restablecer valores iniciales», **When** el Administrador lo confirma, **Then** la matriz de su organización vuelve a los valores iniciales. *(Pendiente de dibujar, igual que los diálogos de confirmación.)*
8. **Given** el texto de ayuda, **Then** indica que las secciones sin acceso no aparecen en el menú y que Proveedores se propone solo para Administrador y Administración (a confirmar con el cliente).

### Edge Cases

- Un usuario cuyo rol cambia mientras tiene la sesión abierta: los permisos se resuelven en cada consulta (RLS), no se cachean en el token.
- Una sección sin fila en `permisos_rol` para un rol (organización creada antes de la migración o sección nueva): se aplican los valores iniciales; nunca «acceso total» por omisión.
- Invitación a un correo que ya tiene una invitación pendiente en la misma organización: reutiliza/reenvía, no duplica.
- Aceptar una invitación vencida o cancelada: se rechaza con mensaje claro y se ofrece pedir una nueva.
- Superadmin de plataforma: conserva su comportamiento actual del template (opera la organización activa como Administrador).
- Cambio de rol de un `miembro` del template existente: sus permisos iniciales se definen en el plan (ver Assumptions).
- Tablas de dominio que aún no usan `private.nivel_seccion`: siguen con `private.puede_escribir()` hasta que su épica las migre.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** (F-ROL-01): `roles_organizacion` DEBE contener los seis roles de negocio (`administrador`, `operador`, `consulta`, `mostrador`, `deposito`, `administracion`) además de `miembro` del template, agregados como filas por migración aditiva.
- **FR-002** (F-ROL-01): Cada organización DEBE tener su propia matriz `permisos_rol` (organización × rol × sección → Edición / Solo lectura / Sin acceso), inicializada con los valores de `Roles.dc.html`.
- **FR-003** (F-ROL-01): El rol Administrador DEBE tener Edición en todas las secciones y no puede restringirse (garantizado en base de datos, no solo en UI).
- **FR-004** (F-ROL-01): `private.nivel_seccion(seccion)` DEBE devolver el nivel del usuario actual en la organización resuelta por `private.organizacion_id()`; sin acceso devuelve «ninguno».
- **FR-005** (F-ROL-01): El panel DEBE ocultar del menú lateral las secciones sin acceso y el `accessControlProvider` de Refine DEBE denegar rutas y acciones según el nivel de la sección.
- **FR-006** (F-ROL-01 / F-ROL-02): `permisos_rol_accion` y `private.puede_accion(seccion, accion)` DEBEN modelar las acciones eliminar, exportar y ver costos por organización, rol y sección. Es una **extensión propuesta** con valores iniciales propuestos.
- **FR-007** (F-ROL-01): El contrato `private.nivel_seccion(seccion)` y `private.puede_accion(seccion, accion)` DEBE quedar documentado (`docs/permisos-por-rol.md`) para que toda tabla de dominio de las demás épicas lo use en sus políticas RLS.
- **FR-008** (F-ROL-03): Una sección denegada DEBE mostrar la pantalla de acceso restringido con el rol y la sección reales, y «Volver al inicio» (sin «Solicitar acceso»: ver US2, criterio 3), sin cargar datos de la sección.
- **FR-009** (F-USR-01): El Administrador DEBE poder invitar por correo con uno de los seis roles; la invitación DEBE vencer a los 7 días y poder reenviarse y cancelarse. Una persona solo se incorpora al aceptar la invitación: NO hay alta directa de cuentas existentes, y el sistema NO DEBE revelar si un correo ya tiene cuenta (respuesta genérica «No se puede invitar a ese correo»).
- **FR-010** (F-USR-01): La persona invitada DEBE definir su contraseña desde el enlace (política: ≥12 caracteres, mayúscula y minúscula, número y símbolo; confirmación coincidente) y quedar Activa con el rol invitado.
- **FR-011** (F-USR-02): El listado DEBE mostrar usuario, tiendas y rol, último acceso y estado; el Administrador DEBE poder editar (rol, restablecer contraseña), suspender y reactivar. La suspensión DEBE impedir el acceso en la base de datos y conservar los cambios anteriores.
- **FR-012** (F-USR-01 / F-USR-02): Las operaciones DEBEN emitir los eventos `usuario.invitado`, `usuario.rol_cambiado`, `usuario.suspendido` y `usuario.reactivado` contra el contrato del registro de actividad (F-AUD-01); mientras no exista, se reutiliza `eventos_membresia` del template.
- **FR-013** (F-ROL-02): Solo el Administrador de cada organización DEBE poder editar la matriz de su organización (secciones y acciones) y guardarla; una edición NO DEBE afectar a otras organizaciones.
- **FR-014** (F-ROL-02): La grilla DEBE mostrar los 6 roles × 16 secciones, rotar Edición → Solo lectura → Sin acceso por clic, bloquear la columna Administrador y habilitar «Guardar cambios» solo con cambios pendientes.
- **FR-015** (F-ROL-02): DEBE existir «Restablecer valores iniciales» y diálogos de confirmación para los cambios sensibles *(pendiente de dibujar)*.
- **FR-016**: Las tablas nuevas DEBEN nacer con RLS por organización, migraciones aditivas y camino de reversión documentado en el plan; el test de aislamiento (pgTAP) DEBE recorrerlas.
- **FR-017**: Las pantallas DEBEN usar los patrones compartidos de carga, vacío, error y éxito del sistema de diseño (MSF-117), funcionar con teclado y lector de pantalla y a 320, 768 y 1440 px, y no mostrar identificadores técnicos como identidad visible.
- **FR-019** (F-USR-01 / F-USR-02): Usuarios DEBE ser la única pantalla de gestión de personas: reutiliza lo ya construido para Miembros (RPC, Edge Function, componentes) en vez de duplicarlo; el ítem «Miembros» sale del menú, y `/miembros` y `/miembros/create` DEBEN redirigir a `/usuarios` (compatibilidad de rutas, Principio VI) sin romper los tests existentes de Miembros, que se migran a la pantalla Usuarios.
- **FR-018**: Ningún secreto en Git; el navegador nunca usa la service-role key; la invitación y el cambio de estado pasan por Edge Function / RPC con verificación de rol.

### Navegación y UI (Principio VI)

| Pantalla | Ítem de menú | Icono | Audiencia | Ruta canónica |
|---|---|---|---|---|
| Usuarios (listado + diálogos Invitar / Editar / Suspender); absorbe la pantalla Miembros del template | «Usuarios y permisos» → Usuarios | usuarios (a definir en el sistema de diseño) | Quien tenga permiso sobre la sección «Usuarios y permisos» (inicial: solo Administrador) | `/usuarios` (`/miembros` y `/miembros/create` redirigen aquí) |
| Roles y permisos (grilla editable) | «Usuarios y permisos» → Roles y permisos | escudo/llave (a definir) | ídem | `/roles` |
| Acceso restringido | Sin ítem (se muestra en lugar de la sección denegada) | — | Cualquier usuario autenticado | Misma URL que intentó abrir |
| Definir contraseña | Sin ítem (pública con enlace de invitación) | — | Persona invitada | Ruta existente del template (`pages/acceso/definir-contrasena.tsx`, spec 006); se reutiliza y se ajusta a `DefinirContrasena.dc.html` sin cambiar su ruta |

El ítem y la agrupación exactos salen de `AdminSider.dc.html` y del sistema de diseño (MSF-117); no se redefinen aquí. Carga diferida de las pantallas fuera del recorrido principal (`React.lazy`).

### Esquemas de datos (Principio VII)

| Tabla | Esquema | Justificación | Cambio |
|---|---|---|---|
| `roles_organizacion` | `public` | Plataforma: catálogo de roles de acceso | Alterada: 5 filas nuevas (aditiva) |
| `usuarios_organizacion` | `public` | Plataforma: membresía | Sin cambio de esquema aquí; `estado` la crea MSF-119 y esta épica la administra |
| `permisos_rol` | `public` | Plataforma: autorización transversal por organización, rol y sección | Nueva, RLS por organización |
| `permisos_rol_accion` | `public` | Plataforma: autorización por acción | Nueva, RLS por organización |
| `invitaciones_organizacion` | `public` | Plataforma: ciclo de vida de acceso/membresía | Nueva, RLS por organización |
| `eventos_membresia` | `public` | Plataforma: auditoría de membresía (template) | Reutilizada |

Verificación de esquema repetida en plan (Constitution Check), tareas (T047) y revisión del PR.

Ninguna es de `dominio`: son mecanismos de acceso, no entidades de negocio del producto. Funciones nuevas en el esquema `private`.

### Key Entities

- **Rol**: fila de `roles_organizacion` (seis de negocio + `miembro`).
- **Permiso por sección**: organización × rol × sección → nivel (Edición / Solo lectura / Sin acceso).
- **Permiso por acción**: organización × rol × sección × acción (eliminar / exportar / ver costos) → permitido.
- **Invitación**: organización, correo, rol, estado (pendiente / aceptada / vencida / cancelada), vencimiento a 7 días.
- **Usuario de la organización**: membresía con rol y estado (Activo / Invitación pendiente / Suspendido).

### Matriz inicial (de `Roles.dc.html`)

E = Edición · L = Solo lectura · – = Sin acceso. Las 16 secciones y los valores son los del prototipo.

| Sección | Administrador | Operador | Consulta | Mostrador | Depósito | Administración |
|---|---|---|---|---|---|---|
| Inicio | E | E | L | L | L | L |
| Productos | E | E | L | L | L | L |
| Categorías | E | E | L | – | – | – |
| Stock | E | E | L | L | E | L |
| Cotización del dólar | E | L | L | L | – | E |
| Empresas | E | – | – | – | – | – |
| Mercado Libre | E | – | – | – | – | – |
| Rentabilidad | E | – | – | – | – | L |
| Usuarios y permisos | E | – | – | – | – | – |
| Actividad | E | L | – | – | – | L |
| Consultas | E | E | L | – | – | L |
| Ventas | E | E | L | E | L | E |
| Clientes | E | E | L | E | – | E |
| Proveedores | E | – | – | – | – | E |
| Reportes | E | – | – | – | – | E |
| Service técnico | E | E | L | L | – | L |

Descripciones de rol (prototipo): Administrador — todo el panel, no se puede restringir; Operador — productos, stock, ventas y clientes; Consulta — solo lectura; Mostrador — vende en el local: comprobantes y clientes; Depósito — arma y entrega pedidos, mueve stock; Administración — cobros, proveedores y reportes.

### Pendientes de diseño (no inventados)

- Edición de acciones (eliminar, exportar, ver costos), «Restablecer valores iniciales» y diálogos de confirmación: no están dibujados; deben dibujarse en el artboard Roles. Sus valores iniciales son propuestos.
- Proveedores solo para Administrador y Administración: a confirmar con el cliente.
- Selector de rol por tienda con seis roles (MSF-121): el prototipo dibuja tres.

## Success Criteria *(mandatory)*

- **SC-001**: Un Administrador completa invitar → definir contraseña → entrar con el rol invitado en una única corrida E2E.
- **SC-002**: Para cada uno de los seis roles, pgTAP verifica que ve y escribe solo las secciones que su matriz permite, y que otra organización no ve ni modifica nada.
- **SC-003**: Un usuario suspendido no accede (UI y base de datos) y al reactivarlo recupera su rol.
- **SC-004**: Un cambio en la matriz guardado por un Administrador se refleja en menú, rutas y políticas sin desplegar código, y solo en su organización.
- **SC-005**: `pnpm lint`, `pnpm build`, `pnpm test` y `pnpm docs:check` pasan; todos los escenarios de este documento están cubiertos por E2E o pgTAP.

## Assumptions

- La invitación vence a los 7 días.
- Cada persona pertenece a una sola organización; desde MSF-121 tiene un rol por empresa (F-ROL-04).
- La matriz arranca con los valores iniciales de F-ROL-01 y el Administrador de cada organización la edita (F-ROL-02); cada organización tiene su propia matriz.
- Los permisos del rol `miembro` del template se mantienen como «Solo lectura» donde hoy lee (sin acceso a Usuarios y permisos) hasta que se decida otra cosa; no se agrega alcance.
- MSF-119 aporta `usuarios_organizacion.estado`; los valores mostrados por el prototipo son Activo, Invitación pendiente y Suspendido y esta épica no redefine su semántica.
- Se parte del prototipo validado por el cliente y de los artefactos; lo no dibujado queda pendiente de dibujar.
- Migraciones aditivas; reversión documentada en `plan.md`.

## Trazabilidad Jira ↔ Historias de usuario ↔ Tareas

| Jira (historia) | Historia | Prioridad / Talla | FR | Tareas |
|---|---|---|---|---|
| MSF-125 (épica) | todas | P0 · 44 h | FR-001…FR-019 | T001–T047 |
| F-ROL-01 (clave Jira por crear: MSF-N) | US1 | P0 · L | FR-001…FR-007, FR-016, FR-017 | T001–T014 |
| F-ROL-03 | US2 | P0 · S | FR-008, FR-017 | T015–T019 |
| F-USR-01 | US3 | P0 · M | FR-009, FR-010, FR-012, FR-018 | T020–T028 |
| F-USR-02 | US4 | P0 · M | FR-011, FR-012, FR-018, FR-019 | T029–T036, T046 |
| F-ROL-02 | US5 | P0 · L | FR-006, FR-013…FR-015 | T037–T043 |
| Cierre / docs | transversal | — | FR-007, FR-016 | T044–T045, T047 |
