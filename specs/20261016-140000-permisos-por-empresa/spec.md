# Feature Specification: Acceso, organización y permisos · Permisos por empresa

**Feature Branch**: `epic/MSF-121-acceso-organizacion-y-permisos-permisos-`

**Componente**: Acceso

**Jira Epic**: MSF-121 — Acceso, organización y permisos · Permisos por empresa (spec `permisos-por-empresa`)

**Created**: 2026-10-16

**Status**: Draft — alcance dado por la épica y respuestas de Nicolás (2026-10-16); sin requisitos nuevos.

**Delivery scope**: `refine` (apps/web) y `supabase` (migraciones + pgTAP). Sin `kestra`, `superset` ni `workers`.

**Prioridad / Hito**: P0 · Hito 2 (2 al 20 de noviembre de 2026) · alcance diciembre · 22 h aprox. (F-ROL-04, 06 y 07).

**Dependencias**:
- Bloqueada por: MSF-125 (Usuarios y roles: `roles_organizacion`, `permisos_rol`, `private.nivel_seccion` de F-ROL-01; diálogos Invitar y Editar usuario de F-USR-01/02) y MSF-138 (Empresas: tabla `dominio.empresas`). Ambas ya están en `main`.
- Bloquea a: MSF-139, MSF-156 y MSF-182 (reglas por empresa en Ventas, Inicio y Service técnico) y a MSF-275 (historial de Ventas: consume el nivel de acceso a la sección Ventas en su RLS).
- Entre historias: F-ROL-04 bloquea a F-ROL-06 y F-ROL-07.
- Relacionada, sin bloqueo: F-EMP-05 (MSF-138, enlace «Cambiar a» que no cambia la empresa activa) y F-AUD-01 (eventos de actividad).

**Prototipo**: `Usuarios.dc.html`, `SelectorEmpresa.dc.html` y `AdminHeader.dc.html` (rama `design/prototipo`, solo referencia visual). La rama no estaba publicada en `origin` al redactar esta spec (`git fetch origin design/prototipo` falla): los artboards no se pudieron consultar y no se modifican ni se commitean. La estética sale del sistema de diseño (MSF-117).

## Objetivo

Una persona administra varias tiendas con un rol distinto en cada una, elige con cuál trabaja desde la barra superior, y el panel y la base de datos aplican los permisos de esa empresa. La matriz editable (F-ROL-02) es de MSF-125.

## Decisiones de Nicolás (2026-10-16)

- **Clientes es compartida** entre tiendas (usa el rol más alto).
- Las secciones no listadas (Inicio, Empresas, Mercado Libre, Rentabilidad, Usuarios y permisos, Actividad, Service técnico) **conservan el rol de organización de hoy**.
- **«Rol más alto»** = mejor nivel por sección (`edicion` > `lectura` > `ninguno`).
- **No hay Administrador limitado a una tienda**: los roles por empresa son los cinco distintos de Administrador.
- Se autoriza recrear el worktree y la rama para commitear y pushear.

## Supuestos (a confirmar con el cliente, según la épica)

- `usuarios_empresas(user_id, empresa_id, rol_id)` define el rol por empresa (`operador`, `consulta`, `mostrador`, `deposito`, `administracion`). El Administrador de la organización accede siempre a todas las empresas.
- Secciones compartidas (rol más alto entre las empresas del usuario): `productos`, `categorias`, `stock`, `clientes`, `proveedores`, `cotizacion_dolar` (Cotización). Secciones por empresa (rol de la empresa activa): `ventas`, `consultas`, `reportes`.
- Un usuario sigue perteneciendo a una sola organización (`usuarios_organizacion.user_id` sigue siendo clave primaria).
- La empresa activa se guarda en `usuario_empresa_activa`, no en la URL.
- Un usuario no Administrador **sin ninguna empresa asignada** se comporta como hoy (rol de organización en todas las secciones); la restricción por empresa empieza al asignarle empresas. *Interpretación para no romper a los usuarios existentes; confirmar.*
- Un usuario con empresas asignadas pero **sin empresa activa válida** tiene `ninguno` en las secciones por empresa (nunca acceso por defecto); al asignarle su primera empresa se fija como activa.
- Lo que el template ya trae y se reutiliza: `usuarios_organizacion`, `contexto_panel_actual()`, `GrillaPermisosPorRol.tsx`, `PermisosPanelProvider`, `accessControlProvider`, `SelectorEmpresa` (F-EMP-05, ruta de empresa) y el registro de actividad.

## Historias

| ID | Nombre | Prioridad | Talla |
|----|--------|-----------|-------|
| F-ROL-04 | Rol por empresa | P0 | M |
| F-ROL-06 | Selector de empresa activa | P0 | M |
| F-ROL-07 | Asignar empresas y rol por empresa desde Usuarios | P0 | M |

### US1 — Rol por empresa (F-ROL-04)

Modelo de datos y resolución de permisos: cada usuario puede tener un rol distinto en cada empresa, y la base aplica el nivel que corresponde.

**Escenarios de aceptación**

1. **Dado** un Operador en la empresa A y Consulta en la B, con la A activa, **cuando** consulta/edita Ventas de A, **entonces** puede editar; con la B activa, solo leer y la base rechaza escribir.
2. **Dado** ese mismo usuario, **cuando** abre Productos (compartida), **entonces** tiene `edicion` (mejor nivel entre sus empresas) sin importar la activa.
3. **Dado** el Administrador de la organización, **cuando** accede, **entonces** ve todas las empresas sin filas en `usuarios_empresas`.
4. **Dado** una sección no listada (p. ej. Rentabilidad), **entonces** rige el rol de organización del usuario.
5. **Dado** una empresa de otra organización, **cuando** se intenta asignarla o activarla, **entonces** se rechaza.
6. **Dado** un intento de asignar el rol `administrador` (o `miembro`) por empresa, **entonces** la base lo rechaza.

### US2 — Selector de empresa activa (F-ROL-06)

Desde la barra superior, el usuario ve las empresas a las que tiene acceso y elige con cuál trabaja.

**Escenarios de aceptación**

1. **Dado** un usuario con 2+ empresas, **cuando** abre el selector, **entonces** ve solo las suyas (el Administrador, todas las de la organización) con la activa marcada.
2. **Dado** que elige otra, **cuando** confirma, **entonces** `usuario_empresa_activa` se actualiza, el panel recarga permisos y los botones de edición reflejan el rol de la nueva empresa.
3. **Dado** una pantalla con cambios sin guardar, **cuando** elige otra empresa, **entonces** se pide confirmación; si cancela, no cambia.
4. **Dado** que cierra sesión y vuelve (u otro dispositivo), **entonces** conserva su empresa activa.
5. **Dado** una empresa que no le corresponde, **cuando** llama a la RPC, **entonces** se rechaza.
6. **Dado** un usuario con una sola empresa, **entonces** el selector es solo una etiqueta, sin cambio.

### US3 — Asignar empresas y rol por empresa desde Usuarios (F-ROL-07)

Un Administrador define, desde los diálogos Invitar y Editar usuario, en qué empresas trabaja una persona y con qué rol en cada una.

**Escenarios de aceptación**

1. **Dado** un Administrador, **cuando** edita un usuario y asigna empresa A = Operador y B = Consulta, **entonces** se guarda de forma atómica y la lista de Usuarios muestra tiendas y rol por tienda.
2. **Dado** el diálogo de Editar usuario, **entonces** ofrece los seis roles (Administrador y los cinco por empresa); elegir Administrador indica que accede a todas las empresas y no pide asignaciones.
3. **Dado** que invita a un usuario, **cuando** elige empresas y roles, **entonces** quedan aplicados al aceptar la invitación.
4. **Dado** un no Administrador, **cuando** intenta asignar, **entonces** se rechaza (403).
5. **Dado** que quita todas las empresas de un usuario, **entonces** vuelve al rol de organización (supuesto arriba).

## Requisitos funcionales

**F-ROL-04**
- **FR-001**: Tabla `usuarios_empresas(user_id, empresa_id, rol_id)` con clave `(user_id, empresa_id)`, RLS por organización (lectura: el propio usuario y los Administradores de su organización; escritura solo por RPC de F-ROL-07).
- **FR-002**: `rol_id` solo admite `operador`, `consulta`, `mostrador`, `deposito`, `administracion`, garantizado por la base (no solo la UI); la empresa debe pertenecer a la misma organización que el usuario.
- **FR-003**: El Administrador de la organización accede siempre a todas sus empresas, sin filas.
- **FR-004**: Tabla `usuario_empresa_activa(user_id, empresa_id)` (una fila por usuario), RLS: lectura propia; sin escritura directa (solo la RPC de F-ROL-06).
- **FR-005**: Helpers `private` para empresas accesibles, empresa activa válida y rol en una empresa, con `search_path` fijo y `grant execute` explícito a `authenticated`.
- **FR-006**: `private.nivel_seccion` resuelve: secciones compartidas = mejor nivel entre los roles del usuario en sus empresas; secciones por empresa = rol de la empresa activa; el resto y los usuarios sin empresas = rol de organización; superadmin y Administrador siguen en `edicion`. Sin sesión, sin membresía o sección desconocida → `ninguno`.
- **FR-007**: `private.puede_accion` sigue la misma resolución que `nivel_seccion` (misma empresa/rol de referencia).
- **FR-008**: Aislamiento verificado con pgTAP: dos organizaciones y dos empresas (Operador en una, Consulta en la otra) sobre tablas representativas de Ventas, Consultas y Productos.

**F-ROL-06**
- **FR-009**: RPC `public.cambiar_empresa_activa(p_empresa_id)`: valida acceso del usuario a esa empresa; `grant execute … to authenticated` y `revoke … from public, anon`.
- **FR-010**: Selector en la barra superior con las empresas accesibles y la activa marcada; etiqueta fija si hay una sola.
- **FR-011**: Confirmación al cambiar con cambios sin guardar.
- **FR-012**: Tras cambiar, el panel invalida la caché de permisos (`invalidarCachePermisos()`) y los botones de edición reflejan el nuevo nivel.
- **FR-013**: La empresa activa persiste en base, no en la URL. No se cambia el enlace «Cambiar a» de F-EMP-05 ni el comportamiento del `SelectorEmpresa` por ruta; el límite queda documentado.
- **FR-014**: El cambio registra `usuario.empresa_activa_cambiada` en la misma transacción.

**F-ROL-07**
- **FR-015**: RPC `public.asignar_empresas_usuario` (solo Administrador de la organización; reemplazo atómico de las asignaciones del usuario; `grant`/`revoke` explícitos).
- **FR-016**: Diálogos Invitar y Editar usuario con empresas y rol por empresa; Editar ofrece los seis roles; la lista de Usuarios muestra tiendas y rol por tienda.
- **FR-017**: La invitación puede llevar las asignaciones, que se aplican al aceptarla.
- **FR-018**: La asignación registra `usuario.empresas_asignadas` en la misma transacción y fija la primera empresa como activa si no hay una.

**Éxito**
- **SC-001**: pgTAP de FR-008 en verde (F-ROL-04).
- **SC-002**: E2E de asignar, cambiar de empresa y comprobar los botones de edición (Tarea de cierre).
- **SC-003**: Documentación funcional actualizada y `pnpm docs:check` en verde (Tarea de cierre).
- **SC-004**: `pnpm lint && pnpm build && pnpm test` sin errores.

## Esquemas (Principio VII — verificación en spec)

| Tabla | Esquema | Justificación |
|-------|---------|---------------|
| `usuarios_empresas` (nueva) | `public` | Membresía/acceso, transversal, como `usuarios_organizacion` |
| `usuario_empresa_activa` (nueva) | `public` | Contexto de sesión del usuario: plataforma |
| `empresas` (existente) | `dominio` | Entidad del negocio; solo se referencia, no se altera |
| `roles_organizacion`, `permisos_rol`, `permisos_rol_accion`, `usuarios_organizacion`, `registro_actividad` (existentes) | `public` | Plataforma; no se alteran (salvo reemplazo de las funciones `private`) |

Toda tabla nueva con RLS por organización; `anon` sin privilegios; la prueba de aislamiento recorre `public` + `dominio`. Migraciones aditivas; reversión en `plan.md`.

## Fuera de alcance

- Matriz de permisos editable (MSF-125, F-ROL-02).
- Reglas por empresa en las tablas de Ventas, Consultas, Reportes, Inicio y Service técnico (MSF-139, MSF-156, MSF-182). El historial de Ventas (MSF-275) no define reglas: solo consume el nivel de acceso resultante.
- Un usuario en varias organizaciones.
- Cambiar el enlace de F-EMP-05.
- Administrador limitado a una tienda.

## Casos borde

- Empresa pausada/inactiva o quitada mientras es la activa del usuario: deja de ser válida → `ninguno` en secciones por empresa hasta que elija otra.
- Carrera entre quitar una asignación y cambiar de empresa: la RPC valida dentro de la transacción.
- Usuario suspendido o removido: sus asignaciones no le dan acceso (`nivel_seccion` exige membresía vigente).
