# Feature Specification: Acceso, organización y permisos · Perfil y permisos avanzados

**Feature Branch**: `epic/MSF-148-acceso-organizacion-y-permisos-perfil-y-`

**Jira Epic**: MSF-148 — Acceso, organización y permisos · Perfil y permisos avanzados (spec `perfil-y-permisos-avanzados`)

**Created**: 2026-10-16

**Status**: Ready for implementation — la especificación viene completa desde Jira. Lo de «A revisar» es verificación de aceptación o diseño no dibujado; no bloquea (ver *Pendientes*).

**Delivery scope**: `refine` (apps/web) y `supabase` (migración, RPC, Edge Function, pgTAP). Sin `kestra`, `superset` ni `workers`.

**Prioridad / Hito**: P2 · Etapa 3 · fuera del alcance de diciembre · 10 h aprox. (F-PRF-01 ~2 h + F-ROL-05 ~8 h).

**Dependencias**:
- Bloqueada por: MSF-125 (Usuarios y roles) — F-ROL-05 agrega el botón «Solicitar acceso» a la pantalla de acceso restringido de F-ROL-03. Ya no depende de MSF-138 (Empresas).
- Bloquea a: ninguna épica.
- Entre historias: ninguna. F-PRF-01 no depende de nada.
- Relacionada, sin bloqueo: MSF-224 (Plataforma · Notificaciones, ayuda y exportación total). Si trae antes un mecanismo de correo de negocio, F-ROL-05 lo reutiliza.

**Input**: Epic MSF-148. Objetivo (inferido de sus historias): cada usuario edita su perfil y puede pedir acceso a una sección desde la pantalla de acceso restringido.

**Regla de fuentes**: la estética y los componentes salen del sistema de diseño (MSF-117, `docs/sistema-de-diseno.md`); el prototipo es solo referencia visual y no se copia HTML ni CSS. Prototipo (rama `design/prototipo`, `design/pantallas/`): `AccesoRestringido.dc.html` (rol Operador) y `AdminHeader.dc.html` (barra superior: selector de empresa y menú de cuenta). *Nota*: al generar esta spec la rama `design/prototipo` no existía en el remoto (`git fetch origin design/prototipo` falla), así que los artboards no se pudieron leer; el comportamiento se apoya en la épica y en la pantalla ya implementada por F-ROL-03 (`apps/web/src/pages/acceso-restringido/AccesoRestringido.tsx`).

## Qué trae el template y qué construye esta épica

**Template / ya construido (se reutiliza, no se rehace)**:
- Perfil propio: nombre, apellido y foto (spec 008, `apps/web/src/pages/cuenta/perfil.tsx`).
- Cambio de contraseña (`apps/web/src/pages/cuenta/cambiar-contrasena.tsx`), con verificación de la contraseña actual (`verifyCurrentPassword`) y política de contraseña en `apps/web/src/lib/passwordPolicy.ts` (≥ 12 caracteres con mayúscula, minúscula, número y símbolo).
- Pantalla de acceso restringido (F-ROL-03, MSF-125) con «Volver al inicio»; el guard `RequiereAccesoSeccion` la muestra en lugar de la sección denegada.

**Esta épica construye**: F-PRF-01 es solo verificación de aceptación y ajuste de textos/reglas de contraseña (sin desarrollo nuevo). F-ROL-05 es lo único que se construye: el botón «Solicitar acceso», el registro del pedido del día y un correo de negocio al administrador (el template solo envía los correos de Supabase Auth y no trae tabla de notificaciones).

## Clarifications

Decisiones ya tomadas por Nicolás (no se reabren):

- Esta épica queda fuera del alcance de diciembre (Etapa 3).
- F-PRF-01 queda cubierta por el template: solo verificación de aceptación.
- F-ROL-05 sube de S a M (~8 h) porque el template no manda correos de negocio: hay que armar la función de envío y el registro del pedido del día.
- MSF-162 (precedente): «usemos lo que ya está hoy, no vamos a rehacer nada» — por eso F-PRF-01 no reconstruye perfil ni contraseña.
- Una sola pantalla de personas por producto: no se crea una pantalla nueva de gestión; «Solicitar acceso» vive en la pantalla de acceso restringido existente.

## User Scenarios & Testing *(mandatory)*

Los escenarios se derivan del objetivo, las historias y los supuestos de la épica; no agregan alcance.

### User Story 1 - Perfil propio (F-PRF-01, P2, talla S) 🎯

Como usuario autenticado, quiero editar mi perfil (nombre, apellido y foto) y cambiar mi contraseña, para mantener mis datos de cuenta al día.

**Why this priority**: es lo que el objetivo promete primero («cada usuario edita su perfil»); ya está construido, solo se verifica.

**Independent Test**: Vitest sobre `perfil` y `cambiar-contrasena` (ya existen sus `.test.tsx`; se completan los casos que falten).

**Acceptance Scenarios**:

1. **Given** un usuario autenticado, **When** edita nombre, apellido o foto en su perfil y guarda, **Then** los cambios se persisten y se reflejan (comportamiento de la spec 008, verificado).
2. **Given** el formulario de cambio de contraseña, **When** el usuario no ingresa la contraseña actual o es incorrecta, **Then** el cambio se rechaza con un mensaje claro y la contraseña no cambia.
3. **Given** una contraseña nueva de menos de 12 caracteres o sin mayúscula, minúscula, número o símbolo, **When** se intenta guardar, **Then** se rechaza con el texto de la regla.
4. **Given** una contraseña nueva válida y la actual correcta, **When** se guarda, **Then** la contraseña cambia.

### User Story 2 - Solicitar acceso desde la pantalla restringida (F-ROL-05, P2, talla M)

Como persona cuyo rol no incluye una sección, quiero pedir acceso desde la pantalla de acceso restringido, para que el administrador de mi organización se entere sin que yo tenga que avisarle por otro medio.

**Why this priority**: es la única construcción nueva de la épica; depende de F-ROL-03 (MSF-125).

**Independent Test**: pgTAP de la tabla y la RPC (aislamiento, un pedido por día) + Vitest del botón y su confirmación; el envío de correo se prueba con un transporte simulado.

**Acceptance Scenarios**:

1. **Given** un Operador que abre una sección sin acceso, **When** ve la pantalla de acceso restringido, **Then** además de «Volver al inicio» ve el botón «Solicitar acceso».
2. **Given** esa pantalla, **When** pulsa «Solicitar acceso», **Then** se registra el pedido (persona, organización, sección, día), se envía un correo al administrador de la organización y se muestra la confirmación «Solicitud enviada al administrador».
3. **Given** que la persona ya pidió acceso a esa sección el mismo día, **When** vuelve a pulsar el botón, **Then** no se duplica el registro ni se reenvía el correo y se muestra la misma confirmación.
4. **Given** el pedido registrado, **When** falla el envío del correo, **Then** el pedido queda guardado, la persona ve un error con opción de reintentar y el reintento no duplica el registro.
5. **Given** dos organizaciones distintas, **When** una persona pide acceso en una, **Then** el administrador de la otra no ve ni recibe nada (aislamiento por organización).
6. **Given** una persona sin sesión o sin membresía en la organización, **When** invoca el pedido, **Then** se rechaza.

### Edge Cases

- Organización sin administrador activo: el pedido se registra y se informa que no hay a quién notificar (no se pierde el registro).
- Sección fuera del catálogo de secciones del panel: se rechaza.
- Pedido para una sección a la que la persona ya tiene acceso: se rechaza o se ignora sin enviar correo.
- Superadmin: no ve la pantalla restringida (opera como administrador, F-ROL-03).

## Requirements *(mandatory)*

### Functional Requirements

**F-PRF-01 (US1)**
- **FR-001**: El perfil propio (nombre, apellido y foto) funciona según la spec 008; se verifica con test, sin reconstruirlo.
- **FR-002**: El cambio de contraseña exige la contraseña actual y la valida contra Supabase Auth antes de actualizar.
- **FR-003**: La contraseña nueva cumple la regla de ≥ 12 caracteres con mayúscula, minúscula, número y símbolo (`passwordPolicy.ts`, regla de F-ACC-02). La regla está **a confirmar con el cliente**; se centraliza para poder ajustarla en un solo lugar.
- **FR-004**: Se ajustan los textos de perfil y cambio de contraseña (claridad y consistencia con el resto del panel).

**F-ROL-05 (US2)**
- **FR-005**: La pantalla de acceso restringido ofrece el botón «Solicitar acceso» junto a «Volver al inicio».
- **FR-006**: Al solicitar, se muestra la confirmación «Solicitud enviada al administrador»; los errores usan el patrón compartido de error con reintento.
- **FR-007**: Cada pedido se registra en una tabla nueva (persona, organización, sección, día) con un único registro por persona, sección y día; reintentar el mismo día no duplica.
- **FR-008**: Se envía un correo de negocio a los administradores de la organización con quién pide y qué sección; el envío es idempotente respecto del registro del día y falla de forma visible y reintentable.
- **FR-009**: Seguridad y aislamiento: la tabla tiene RLS por organización; la RPC se ejecuta solo con `authenticated` (`revoke … from public, anon` + `grant … to authenticated`), valida membresía y sección en el servidor y nunca usa la service-role en el navegador; el correo se envía desde servidor.
- **FR-010**: La confirmación y el botón cumplen el Principio VI (teclado, lector de pantalla, 320/768/1440 px, estados compartidos).

**Transversal**
- **FR-011**: Documentación funcional actualizada (`docs/`) con el flujo de solicitud de acceso y el mecanismo de correo; `pnpm docs:check` verde.

### Esquemas de datos (Principio VII)

| Tabla | Esquema | Justificación | Cambio |
|---|---|---|---|
| `solicitudes_acceso` | `public` | Plataforma: ciclo de vida de acceso/permisos de una persona en la organización; no es una entidad de negocio del producto | Nueva, RLS por organización, migración aditiva |
| `usuarios_organizacion`, `roles_organizacion`, `permisos_rol` | `public` | Plataforma (MSF-125) | Solo lectura desde la RPC; sin cambio |

Ninguna tabla es de `dominio`. Verificación de esquema repetida en plan (Constitution Check), tareas (T014), implementación y revisión del PR. El pgTAP de aislamiento (`rls_en_toda_tabla`) debe recorrerla.

**Reversión** (migración posterior, no en el mismo PR): eliminar la función `public.solicitar_acceso(text)` y luego la tabla `public.solicitudes_acceso`.

### Success Criteria

- **SC-001**: Los escenarios 1–4 de US1 están cubiertos por Vitest.
- **SC-002**: Los escenarios 1–6 de US2 están cubiertos por pgTAP (tabla/RPC/aislamiento) y Vitest (botón, confirmación, reintento).
- **SC-003**: `pnpm lint && pnpm build && pnpm test` y `pnpm docs:check` sin errores; migración aditiva con RLS.

## Pendientes y decisiones abiertas (no bloquean)

- **Regla de contraseña**: 12 caracteres con 4 clases, a confirmar con el cliente (FR-003).
- **Pantalla de perfil sin dibujar**: no hay artboard; se usa la pantalla del template con componentes del sistema de diseño.
- **Transporte de correo**: el template no lo trae. Si MSF-224 entrega uno antes, se reutiliza; si no, F-ROL-05 arma una función de envío mínima en `supabase/functions/_shared/` con credenciales por variables de entorno (solo `.env.example`). Proveedor concreto a elegir (ver *Guía*).
- **Texto del correo** y destinatarios exactos (todos los administradores activos de la organización) no están dibujados: se implementan con textos simples y se marcan en el PR.
