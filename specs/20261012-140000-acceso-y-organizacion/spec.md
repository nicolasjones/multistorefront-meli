# Feature Specification: Acceso, organización y permisos · Acceso y organización

**Feature Branch**: `epic/MSF-119-acceso-organizacion-y-permisos-acceso-y-`

**Componente**: Acceso

**Jira Epic**: MSF-119 — Acceso, organización y permisos · Acceso y organización (spec `acceso-y-organizacion`)

**Created**: 2026-10-12

**Status**: Ready for implementation — la especificación viene completa desde Jira. Los puntos de "A revisar" (valores a confirmar con el cliente, límite de intentos de Supabase Auth vs. tabla `intentos_acceso`, vencimiento por inactividad en el plan contratado) son decisiones de implementación con camino alternativo ya previsto en la propia épica y no bloquean.

**Delivery scope**: `refine`, `supabase`. Sin `kestra`, `superset` ni `workers`.

**Prioridad / Hito**: P0 · Hito 1 (6 al 30 de octubre de 2026) · ~14 h (4 + 2 + 4 + 4) · Bloqueada por: ninguna (primera épica del componente) · Bloquea a: MSF-125 (Usuarios y roles) y MSF-162 (Organizaciones nuevas).

**Input**: Epic MSF-119. Objetivo: "Al terminar, una persona invitada entra al panel, recupera su contraseña, cierra sesión y solo ve los datos de su organización."

**Naturaleza de la épica**: adecuación, no construcción. El template ya trae login por correo y contraseña con Supabase Auth, rutas protegidas, invitación, definir y recuperar contraseña (spec 006), cambio de contraseña y de correo, perfil, `organizaciones` / `usuarios_organizacion` con RLS, `private.organizacion_id()`, `private.puede_escribir()` y pruebas pgTAP de aislamiento (spec 003). Esta épica solo adecua textos, reglas y menú de cuenta, y agrega lo que el template NO trae: estado de usuario (activo / suspendido), «Mantener la sesión iniciada», bloqueo por intentos fallidos, vencimiento de sesión por inactividad, reglas de contraseña del producto y la prueba que exige RLS en toda tabla nueva.

**Regla de fuentes**:

- Comportamiento y datos: mandan los requisitos y escenarios de esta spec.
- Qué se ve: el prototipo es referencia visual; la estética sale del sistema de diseño (MSF-117, `docs/sistema-de-diseno.md`). No copiar HTML/CSS del prototipo.
- Cómo se construye: mandan el template (Refine + MUI + Supabase) y sus specs 003 y 006.
- El prototipo muestra más que esta épica (p. ej. el selector de empresa de la barra superior): implementar solo lo que piden los requisitos.

**Prototipo (solo lectura, rama `design/prototipo`, `design/pantallas/`)**: página "Panel administrativo", artboards `Login.dc.html` (correo, contraseña, «Mantener la sesión iniciada», mensaje genérico de error y aviso de bloqueo), `RecuperarContrasena.dc.html` (pedido del enlace, confirmación neutra y aviso de enlace vencido), `DefinirContrasena.dc.html` (contraseña nueva con sus reglas) y `AdminHeader.dc.html` (menú del usuario con «Cerrar sesión»). F-ORG-01 no tiene pantalla: vive en la base de datos.

## Supuestos (todos a confirmar con el cliente)

- **S1** Bloqueo tras 5 intentos fallidos con 15 minutos de espera.
- **S2** Contraseña de al menos 12 caracteres con mayúscula, minúscula, número y símbolo (coincide con spec 006).
- **S3** Enlaces de recuperación de un solo uso que vencen a la hora (coincide con spec 006).
- **S4** La sesión vence a las 12 horas de inactividad, o a los 30 días si se eligió «Mantener la sesión iniciada».
- **S5** Un usuario pertenece a una sola organización (`user_id` es PK de `usuarios_organizacion`); en el lanzamiento hay una organización con dos empresas.

## Esquema de cada tabla (Constitución VII)

El esquema se decide por la naturaleza de la tabla, no por defecto. Todas las tablas que esta épica crea o altera son de plataforma / autenticación, por lo tanto viven en `public` (no en `dominio`):

| Tabla | Acción | Esquema | Justificación |
|---|---|---|---|
| `usuarios_organizacion` | altera (agrega `estado`) | `public` | Membresía y acceso: plataforma transversal. |
| `intentos_acceso` (condicional) | crea | `public` | Soporte de autenticación (bloqueo por intentos): plataforma. |

La épica no crea tablas de dominio del producto. La regla de aislamiento (F-ORG-01) aplica a `public` y a `dominio`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ingreso con correo y contraseña (F-ACC-01, P0, talla S)

Como persona invitada, quiero ingresar al panel con mi correo y contraseña, con la opción «Mantener la sesión iniciada», para trabajar sin repetir el ingreso en cada visita.

**Why this priority**: Es la puerta de entrada de todo el producto y crea la columna `usuarios_organizacion.estado` de la que dependen F-ACC-03 y MSF-125.

**Independent Test**: Con un usuario activo, ingresar con credenciales válidas y llegar al panel; con credenciales inválidas ver el mensaje genérico; tras 5 fallos ver el aviso de bloqueo; con un usuario suspendido ser rechazado.

**Acceptance Scenarios**:

1. **Given** un usuario activo con membresía, **When** ingresa con correo y contraseña correctos, **Then** accede al panel de su organización.
2. **Given** un correo o contraseña incorrectos, **When** intenta ingresar, **Then** ve un mensaje genérico que no revela si el correo existe ("Revisá el correo y la contraseña e intentá de nuevo").
3. **Given** 5 intentos fallidos consecutivos (S1), **When** intenta de nuevo, **Then** ve el aviso de bloqueo y no puede ingresar hasta pasados 15 minutos, aun con credenciales correctas.
4. **Given** un usuario con `estado = suspendido`, **When** ingresa con credenciales correctas, **Then** el ingreso es rechazado con el mismo tipo de mensaje no revelador y no se crea sesión utilizable.
5. **Given** el formulario de ingreso, **When** se marca «Mantener la sesión iniciada», **Then** la sesión queda configurada para vencer a los 30 días (S4); sin marcarla, vence por inactividad (US3).
6. **Given** una persona sin sesión, **When** abre una ruta protegida, **Then** es llevada al ingreso.

### User Story 2 - Recuperar y definir contraseña (F-ACC-02, P0, talla S)

Como persona con acceso, quiero recuperar mi contraseña por correo y definir una nueva que cumpla las reglas, para volver a entrar si la olvido o si fui invitada.

**Why this priority**: Sin recuperación una persona invitada puede quedar fuera sin intervención de un administrador.

**Independent Test**: Pedir el enlace, abrirlo, definir una contraseña válida y volver a ingresar; reabrir el mismo enlace y ver el aviso de vencido.

**Acceptance Scenarios**:

1. **Given** la pantalla de recuperación, **When** se envía cualquier correo (exista o no), **Then** se muestra siempre la misma confirmación neutra ("Si existe una cuenta para ese correo, vas a recibir el enlace…").
2. **Given** un enlace de recuperación o invitación vigente, **When** se abre, **Then** se muestra el formulario «Definí tu contraseña» con sus reglas (12 caracteres, mayúscula y minúscula, número, símbolo) y confirmación de contraseña.
3. **Given** una contraseña que no cumple las reglas o una confirmación distinta, **When** se envía, **Then** se explica qué falta y la contraseña no cambia.
4. **Given** un enlace ya usado o con más de 1 hora (S3), **When** se abre, **Then** se muestra el aviso de enlace vencido y se puede pedir uno nuevo.
5. **Given** una contraseña definida correctamente, **When** se guarda, **Then** la persona entra al panel y puede ingresar luego con la nueva contraseña.

### User Story 3 - Cierre y vencimiento de sesión (F-ACC-03, P0, talla S)

Como persona usuaria, quiero cerrar sesión desde el menú de cuenta y que la sesión venza sola por inactividad, para que nadie use mi panel en un equipo desatendido.

**Why this priority**: Cierra el ciclo de acceso y aplica la suspensión a sesiones ya abiertas. Depende de US1 (columna `estado`).

**Independent Test**: Abrir el menú de cuenta y cerrar sesión; simular inactividad de 12 h y verificar que la sesión no sirve; suspender a un usuario con sesión abierta y verificar que se corta.

**Acceptance Scenarios**:

1. **Given** una sesión abierta, **When** se elige «Cerrar sesión» en el menú del usuario de la barra superior, **Then** la sesión termina y la persona vuelve al ingreso; usar «atrás» no muestra datos.
2. **Given** una sesión sin «Mantener la sesión iniciada», **When** pasan 12 horas sin actividad (S4), **Then** la sesión vence y se pide ingresar de nuevo.
3. **Given** una sesión con «Mantener la sesión iniciada», **When** pasan 30 días (S4), **Then** la sesión vence; antes de eso persiste entre visitas.
4. **Given** un usuario con sesión abierta, **When** su `estado` pasa a `suspendido`, **Then** su sesión se corta y no puede seguir leyendo datos.

### User Story 4 - Aislamiento por organización (F-ORG-01, P0, talla S)

Como persona usuaria, quiero ver únicamente los datos de mi organización, para que la información de otras organizaciones nunca me sea accesible.

**Why this priority**: Es la regla de seguridad de la que dependen todas las épicas de dominio y MSF-162 (F-ORG-02).

**Independent Test**: Suite pgTAP que, con usuarios de dos organizaciones, verifica que cada uno ve solo lo suyo, y que recorre el catálogo de tablas de todos los esquemas expuestos (`public` y `dominio`) verificando que todas tienen RLS.

**Acceptance Scenarios**:

1. **Given** usuarios de dos organizaciones distintas, **When** cada uno consulta o escribe en tablas de dominio, **Then** solo ve y modifica filas de su `organizacion_id`.
2. **Given** una tabla nueva en cualquier esquema expuesto (`public` o `dominio`), **When** corre la prueba de catálogo, **Then** falla si no tiene RLS activado (y política por organización con `private.organizacion_id()`), de modo que no se pueda entregar una tabla expuesta sin RLS.
3. **Given** un usuario sin membresía (o suspendido), **When** consulta tablas de dominio, **Then** no ve ninguna fila.
4. **Given** la regla de aislamiento, **When** una épica de dominio crea una tabla, **Then** encuentra documentado cómo aplicarla (`organizacion_id` + política con `private.organizacion_id()` / `private.puede_escribir()`).

### Edge Cases

- Mensajes de error y recuperación nunca revelan si un correo existe (enumeración de usuarios).
- El bloqueo por intentos no debe permitir bloquear indefinidamente a un tercero ni registrar contraseñas intentadas.
- Reabrir un enlace consumido no deja sesión parcial.
- Un usuario suspendido que pide recuperación recibe la misma confirmación neutra y no obtiene acceso.
- Superadmin: conserva el comportamiento del template (spec 003); el estado `suspendido` aplica a `usuarios_organizacion`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** (F-ACC-01): El ingreso por correo y contraseña usa Supabase Auth; las rutas protegidas redirigen al ingreso sin sesión.
- **FR-002** (F-ACC-01): Los fallos de ingreso muestran un mensaje genérico idéntico para correo inexistente y contraseña incorrecta.
- **FR-003** (F-ACC-01): Tras 5 intentos fallidos se bloquea el ingreso 15 minutos (S1) y se muestra el aviso de bloqueo. Se prueba primero el límite de Supabase Auth; si sus tiempos no son configurables o no bloquea por correo, se agrega la tabla `intentos_acceso` (con RLS) y la historia pasa a talla M.
- **FR-004** (F-ACC-01): Se agrega `usuarios_organizacion.estado` (`activo` | `suspendido`, por defecto `activo`) mediante migración aditiva; un usuario `suspendido` no puede ingresar ni leer datos de la organización.
- **FR-005** (F-ACC-01): El formulario ofrece «Mantener la sesión iniciada»; su valor determina la duración de la sesión (FR-009).
- **FR-006** (F-ACC-02): La recuperación de contraseña responde siempre con confirmación neutra; los enlaces son de un solo uso y vencen a la hora (S3).
- **FR-007** (F-ACC-02): Definir contraseña exige las reglas del producto (S2: 12+ caracteres, mayúscula, minúscula, número, símbolo) con indicación visible de cada regla y confirmación; un enlace vencido o usado muestra aviso y permite pedir otro. Reutiliza el flujo de la spec 006 y es compartido con F-USR-01 (MSF-125).
- **FR-008** (F-ACC-03): El menú de cuenta de la barra superior incluye «Cerrar sesión», que termina la sesión y redirige al ingreso.
- **FR-009** (F-ACC-03): La sesión vence a las 12 h de inactividad, o a los 30 días si se eligió «Mantener la sesión iniciada» (S4). Antes de implementar se confirma que el plan de Supabase contratado permite `inactivity_timeout`/`timebox`; si no, se documenta la alternativa en `plan.md`.
- **FR-010** (F-ACC-03): Pasar un usuario a `suspendido` corta su sesión abierta y rechaza nuevos accesos (usa la columna de FR-004).
- **FR-011** (F-ORG-01): Toda tabla de dominio filtra por `organizacion_id` con RLS usando `private.organizacion_id()` y `private.puede_escribir()` (template, spec 003); un usuario no suspendido solo ve datos de su organización.
- **FR-012** (F-ORG-01): Una prueba pgTAP recorre el catálogo de tablas de todos los esquemas expuestos (`public` y `dominio`) y falla si alguna no tiene RLS activado; se documenta la regla para tablas de dominio.
- **FR-013**: Las migraciones son aditivas (la columna `estado` y, si hace falta, `intentos_acceso` nacen con RLS por organización); ambas son de plataforma/auth y viven en `public` (ver "Esquema de cada tabla"); camino de reversión documentado en `plan.md`.
- **FR-014**: Las pantallas de acceso usan el sistema de diseño (MSF-117) y cumplen la Constitución VI: estados de carga/error/éxito compartidos, teclado y lector de pantalla, anchos 320/768/1440 px, sin identificadores técnicos visibles.
- **FR-015**: La documentación funcional de la épica se actualiza en `docs/` (reglas de acceso, supuestos, regla de aislamiento para tablas de dominio).

### Key Entities

- **usuarios_organizacion** (existente, `public`): membresía única por usuario; se le agrega `estado` (`activo` | `suspendido`).
- **intentos_acceso** (condicional, `public`): registro de intentos fallidos por correo para el bloqueo, solo si el límite de Supabase Auth no alcanza.
- **Sesión** (Supabase Auth): duración por inactividad / «Mantener la sesión iniciada».

## Success Criteria *(mandatory)*

- **SC-001**: Una persona invitada completa invitación → definir contraseña → ingreso → cierre de sesión en el E2E.
- **SC-002**: pgTAP demuestra que ninguna fila de otra organización es visible o modificable, y que ninguna tabla de `public` ni de `dominio` queda sin RLS.
- **SC-003**: Los 5 intentos fallidos bloquean el ingreso 15 minutos y el mensaje no distingue entre correo inexistente y contraseña errónea.
- **SC-004**: Un usuario suspendido no puede ingresar y su sesión abierta se corta.
- **SC-005**: `pnpm lint`, `pnpm build`, `pnpm test` y `pnpm docs:check` pasan.

## Dependencias y trazabilidad entre épicas

- F-ACC-01 bloquea a F-ACC-03 (columna `estado`). MSF-125 (F-USR-02) administra después el estado desde pantalla; MSF-162 (F-ORG-02) se apoya en FR-011/FR-012.
- F-ACC-02 y F-USR-01 (MSF-125) comparten el flujo de la spec 006; sin orden obligatorio.
- Las referencias legacy "acceso-usuarios-roles" equivalen a MSF-119 + MSF-125.

## Matriz de trazabilidad Jira ↔ US ↔ FR ↔ tareas

| Jira / ID | Historia | FR | Tareas | Verificación |
|---|---|---|---|---|
| MSF-119 / F-ACC-01 | US1 | FR-001..005, 013, 014 | T001–T007 | Vitest + pgTAP + E2E |
| MSF-119 / F-ACC-02 | US2 | FR-006, 007, 014 | T008–T011 | Vitest + E2E |
| MSF-119 / F-ACC-03 | US3 | FR-008..010 | T012–T015 | Vitest + pgTAP + E2E |
| MSF-119 / F-ORG-01 | US4 | FR-011, 012 | T016–T019 | pgTAP |
| MSF-119 (transversal) | — | FR-013, 015 | T020–T021 | `pnpm docs:check`, lint, build, test |
