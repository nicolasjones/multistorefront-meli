# Feature Specification: Acceso, organización y permisos · Administración de usuarios y organización

**Feature Branch**: `epic/MSF-132-acceso-organizacion-y-permisos-administr`

**Jira Epic**: MSF-132 — Acceso, organización y permisos · Administración de usuarios y organización (spec `administracion-de-usuarios-y-organizacion`)

**Created**: 2026-10-14

**Status**: Ready for implementation — la especificación viene completa desde Jira. Las decisiones de "A revisar" son de diseño pendiente de dibujar (Etapa 2) y no bloquean; ver *Pendientes de diseño*.

**Delivery scope**: `refine` (apps/web) y `supabase` (migración, RPC, pgTAP). Sin `kestra`, `superset` ni `workers`.

**Prioridad / Hito**: P1 · Etapa 2 (desde enero de 2027) · 6 h aprox. (F-ORG-03 4 h + F-USR-03 2 h). El alta de empresas (F-EMP-03) salió a MSF-475.

**Dependencias**:
- Bloqueada por: MSF-125 (Usuarios y roles) — F-USR-03 se agrega a la pantalla Usuarios y respeta el estado Suspendido de F-USR-02; y MSF-138 (Empresas) — F-ORG-03 lista las empresas.
- Bloquea a: ninguna épica. Sin links Blocks entre las historias.
- Relacionada, sin bloqueo: MSF-475 (Alta de empresas, F-EMP-03; ya no es de esta épica) y MSF-119 (F-ACC-02, recuperación de contraseña del template, que F-USR-03 reutiliza).

**Input**: Epic MSF-132. Objetivo (inferido de sus historias): «El administrador completa la gestión del equipo y del negocio: datos de la organización y ayuda con contraseñas».

**Regla de fuentes**: lo que se ve y cómo funciona lo definen la épica de Jira y el prototipo; la estética y los componentes salen del sistema de diseño (MSF-117, `docs/sistema-de-diseno.md`), **sin copiar HTML ni CSS**. El prototipo (rama `design/prototipo`, solo lectura) **no trae pantalla** para F-ORG-03 ni F-USR-03: se dibujan al entrar en la Etapa 2. Lo no dibujado queda como *pendiente de dibujar*, sin inventarlo.

## Qué trae el template y qué construye esta épica

**Template / épicas previas (se reutiliza)**:
- Alta de organizaciones solo por superadmin (Edge Function `crear-organizacion`, `pages/organizaciones/{list,create}`); correos de Supabase Auth y recuperación de contraseña (`pages/acceso/solicitar-recuperacion`, `definir-contrasena`, F-ACC-02).
- Pantalla Usuarios (MSF-125, `pages/usuarios/list.tsx`): diálogo «Editar usuario» con botón «Restablecer contraseña» (`resetPasswordForEmail` con `passwordDefinitionRedirectUrl('recuperacion', …)`), suspender/reactivar (`usuarios_organizacion.estado`).
- Empresas (MSF-138, `dominio.empresas`, `pages/empresas`).
- `private.organizacion_id()`, `private.puede_escribir()`, `private.es_administrador_de()`; secciones de la matriz de permisos.

**Esta épica construye (construcción chica sobre el patrón CRUD del template)**:
- F-ORG-03: edición de los datos de **su propia** organización por su administrador (el template no trae edición por el administrador, logo ni zona horaria) y listado de las empresas de la organización.
- F-USR-03: cerrar el flujo «el administrador restablece la contraseña de otro usuario» sobre la pantalla Usuarios, reusando el correo de recuperación del template y respetando el estado Suspendido.

## Modelo y supuestos

- Se heredan los supuestos del componente: español de Argentina, moneda base ARS, dos empresas en el lanzamiento (sin asumir que son exactamente dos: 1..N, ver spec Empresas).
- «Datos y configuración de la organización» incluye lo que el template **no** trae: nombre editable, **logo** y **zona horaria** *(campos exactos pendientes de dibujar; se implementan solo estos tres más el listado de empresas)*.
- Una persona pertenece a una sola organización (`usuarios_organizacion.user_id` PK): «su organización» es la que resuelve `private.organizacion_id()`.
- F-USR-03 **no** crea un mecanismo nuevo de contraseñas: el administrador dispara el correo de recuperación y la persona define su contraseña. El administrador nunca ve ni fija la contraseña.

### Esquema de datos (Constitución, Principio VII)

| Objeto | Esquema | Justificación | RLS / acceso |
|--------|---------|---------------|--------------|
| `organizaciones` (columnas nuevas `logo_path`, `zona_horaria`) | **`public`** | Organización es entidad de plataforma/transversal, no de dominio del producto. | Ya tiene RLS (select de la propia). La escritura NO se abre por política: pasa por una RPC con control de administrador. |
| Bucket de Storage `logos-organizacion` (si se usa Storage para el logo) | `storage` (plataforma) | Archivo de la organización. | Políticas por prefijo `organizacion_id`; escritura solo administrador de esa organización. |
| `dominio.empresas` | **`dominio`** (ya existe, MSF-138) | Solo se lee; no se altera. | Sin cambios. |

No se crean tablas nuevas. Toda RPC nueva de `public` lleva `revoke execute … from public, anon` y `grant execute … to authenticated` explícitos (regla de `CLAUDE.md` y `docs/acceso-ingreso.md`).

## User Scenarios & Testing

### US1 — Datos y configuración de la organización (F-ORG-03, P1, talla S)

El administrador abre la configuración de su organización, edita nombre, logo y zona horaria, guarda, y ve el listado de las empresas de la organización.

**Independent Test**: pgTAP de la RPC y de RLS + prueba de componente + E2E del flujo editar/guardar.

**Escenarios de aceptación** *(derivados del objetivo de la épica; el texto fino se afina al dibujar la pantalla)*:
1. **Given** un administrador con organización activa, **When** abre la pantalla de la organización, **Then** ve los datos actuales (nombre, logo, zona horaria) y la lista de sus empresas (San Javucho y Mundo JC en el lanzamiento).
2. **Given** esos datos, **When** edita y guarda, **Then** se persisten, se confirma con el patrón de éxito compartido y la nueva información se ve al recargar.
3. **Given** un dato inválido (nombre vacío, zona horaria inexistente, logo de tipo/tamaño no admitido), **When** guarda, **Then** se rechaza con un mensaje claro y nada cambia.
4. **Given** un usuario que no es administrador (o suspendido), **When** abre la ruta por URL o llama a la RPC, **Then** no puede editar (acceso restringido en pantalla y rechazo en la base).
5. **Given** dos organizaciones, **When** el administrador de una edita, **Then** la otra no se modifica ni se ve.
6. **Given** una organización con 0, 1 o N empresas, **When** abre la pantalla, **Then** el listado funciona sin asumir cantidad (vacío, uno o varios).

### US2 — Restablecer la contraseña de otro usuario (F-USR-03, P1, talla S)

El administrador, desde la pantalla Usuarios, envía a otra persona el enlace para definir una contraseña nueva.

**Independent Test**: prueba de componente de la pantalla Usuarios + E2E del flujo hasta definir contraseña (reusa F-ACC-02).

**Escenarios de aceptación**:
1. **Given** un usuario activo de la organización, **When** el administrador pulsa «Restablecer contraseña», **Then** se envía el correo de recuperación del template a esa persona y se confirma «Enviamos el enlace para restablecer la contraseña».
2. **Given** el correo recibido, **When** la persona abre el enlace, **Then** define su contraseña con el flujo `definir-contrasena` existente (sin pantalla nueva).
3. **Given** un usuario **Suspendido** (F-USR-02), **When** el administrador intenta restablecer, **Then** no se envía el enlace y se explica que debe reactivarlo primero.
4. **Given** un fallo al enviar, **When** se pulsa, **Then** se muestra un error dentro del diálogo, sin revelar más que «no pudimos enviar el enlace».
5. **Given** que quien opera no es administrador, **Then** la acción no se ofrece.
6. **Given** el propio usuario del administrador, **Then** la acción no se ofrece aquí (su contraseña se cambia en «Cuenta», que ya existe).

## Requirements

- **FR-001** (F-ORG-03): El administrador DEBE poder ver y editar nombre, logo y zona horaria de **su** organización.
- **FR-002** (F-ORG-03): La escritura DEBE pasar por una RPC `public` que valida rol administrador activo de esa organización, normaliza y valida los datos (nombre no vacío, zona horaria válida de la base de zonas de Postgres, logo con tipo y tamaño acotados) y rechaza al resto; sin política UPDATE directa sobre `organizaciones`.
- **FR-003** (F-ORG-03): La pantalla DEBE listar las empresas de la organización (lectura de `dominio.empresas` por RLS), sin asumir cuántas son, y enlazar a la edición existente de Empresas; el alta de empresas NO se hace acá (MSF-475).
- **FR-004** (F-ORG-03): Un administrador NO DEBE poder leer ni modificar otra organización (RLS + RPC; pgTAP lo prueba). El logo se aísla por organización.
- **FR-005** (F-USR-03): «Restablecer contraseña» DEBE reutilizar el correo de recuperación del template (F-ACC-02) y el flujo `definir-contrasena`; sin mecanismo nuevo ni contraseñas visibles para el administrador.
- **FR-006** (F-USR-03): DEBE respetar el estado Suspendido: no se ofrece ni se envía el enlace a un suspendido.
- **FR-007** (F-USR-03): Solo el administrador DEBE verlo en la pantalla Usuarios; para uno mismo no se ofrece.
- **FR-008** (ambas): Mensajes en español de Argentina, patrones compartidos de carga/vacío/error/éxito, teclado y lector de pantalla, anchos 320/768/1440 px, sin identificadores técnicos visibles por defecto (Principio VI).
- **FR-009** (ambas): Migraciones aditivas con camino de reversión documentado; sin secretos en Git ni service-role en el navegador.
- **FR-010** (ambas): Documentación funcional actualizada en el mismo cambio (`docs/`), y `pnpm docs:check` verde.

### Navegación (Principio VI) — propuesta, a confirmar al dibujar

- F-ORG-03: ruta canónica `/organizacion` (singular: la organización activa; distinta de `/organizaciones`, que es superadmin), audiencia administrador, con contexto de organización activa (`RequiereOrganizacionActiva`). Ubicación e icono en el menú: junto a Empresas/Usuarios, *pendiente de dibujar*. Sin rutas anteriores que preservar.
- F-USR-03: sin ruta nueva; vive en `/usuarios` (una sola pantalla de gestión de personas por producto).

## Pendientes de diseño (no bloquean)

- No hay artboard para F-ORG-03 ni F-USR-03 (se dibujan al entrar en Etapa 2); se implementa con el sistema de diseño y se marca en el PR.
- El objetivo de la fila de planificación está inferido de las historias.
- Si F-ORG-03 necesita algo del alta de empresas, se resuelve en la spec de MSF-475.

## Out of scope

- Alta de empresas (F-EMP-03, MSF-475); edición de empresas (ya en MSF-138).
- Cambiar la contraseña propia (ya existe en Cuenta) y reestructurar el flujo de recuperación (F-ACC-02).
- Registro de actividad (F-AUD-01, Plataforma), roles/permisos avanzados (MSF-148), alta de organizaciones (superadmin, template).

## Success Criteria

- **SC-001**: un administrador edita y guarda los datos de su organización y los ve al recargar; otra organización no cambia (pgTAP + E2E).
- **SC-002**: un no administrador o suspendido no puede editar por UI ni por RPC (pgTAP).
- **SC-003**: el administrador envía el correo de restablecimiento a un usuario activo y no a uno suspendido (Vitest + E2E).
- **SC-004**: `pnpm lint && pnpm build && pnpm test && pnpm docs:check` sin errores.

## Matriz de trazabilidad Jira ↔ US ↔ FR ↔ tareas

| Historia Jira | US | Prioridad · Talla | FR | Tareas |
|---------------|----|-------------------|----|--------|
| F-ORG-03 | US1 | P1 · S (4 h) | FR-001–FR-004, FR-008–FR-010 | T001–T012 |
| F-USR-03 | US2 | P1 · S (2 h) | FR-005–FR-010 | T013–T019 |
| (transversal) | — | — | FR-010 | T020–T021 |
