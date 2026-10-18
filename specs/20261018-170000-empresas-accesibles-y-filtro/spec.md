# Feature Specification: Empresas accesibles en el selector y en el filtro de Clientes

**Feature Branch**: `feat/empresas-accesibles-filtro`

**Jira Epic**: sin épica nueva — refinamiento de MSF-121 (permisos por empresa, F-ROL-06/F-EMP-05)
y MSF-180 (Clientes, F-CLI-11).

**Created**: 2026-10-18

**Status**: Implementada (PR contra `dokploy`).

**Delivery scope**: `refine` (`apps/web`) y `supabase` (`private.empresas_accesibles`, RPC del
selector y pgTAP). Sin `kestra`, `superset` ni `workers`.

**Input** (pedido del usuario): «En la barra superior veo “Prueba San Javucho · Organización ·
Superadmin”. Para el superadmin está bien ver la organización y sus empresas; pero un usuario que no
es superadmin no debería ver la organización sino sus empresas, y la aplicación debe responder como
el prototipo.» Respuestas a las preguntas de alcance: barra superior; sólo las empresas **accesibles**
para un no-superadmin; y el filtro de Clientes **sigue la empresa activa**.

## Por qué

`private.empresas_accesibles()` resolvía sólo por membresía (`usuarios_organizacion`). Un superadmin
no tiene fila de membresía, así que `empresas_para_selector()` le devolvía `[]`: el selector de
empresa activa de la barra superior quedaba vacío aunque `private.nivel_seccion` le da edición sobre
su organización activa. Al mismo tiempo, la fila «Tienda» de Clientes tomaba `dominio.empresas` por
RLS (todas las de la organización, incluidas las que un miembro no puede usar) y no seguía la
empresa activa, contra lo que el prototipo declara («Si elegís una empresa en la barra superior, se
filtra por esa tienda»; `gc_co` inicializa `tFilt`).

## Historias y criterios de aceptación

### US1 · El selector de la barra superior respeta el rol

- **US1-CA1** El superadmin ve la **organización** y, además, las empresas de su **organización
  activa** (`superadmin_organizacion_activa`); puede activar cualquiera de ellas.
- **US1-CA2** Un usuario **no** superadmin ve sus empresas accesibles en el selector de empresa
  activa (el Administrador, todas las activas de su organización; un miembro, las asignadas). Fuera
  de una pantalla de empresa **no** ve la etiqueta de organización.
- **US1-CA3** Nadie ve empresas de otra organización: el superadmin sólo las de su organización
  activa; el resto, las de la suya.

### US2 · El filtro por tienda de Clientes ofrece las empresas accesibles y sigue la empresa activa

- **US2-CA1** La fila «Tienda» lista las empresas **accesibles** (no todas las de la organización por
  RLS): el Administrador ve todas las activas de su organización, un miembro las asignadas y el
  superadmin las de su organización activa.
- **US2-CA2** Al entrar, el filtro arranca en la **empresa activa** de la barra superior (como el
  prototipo); «Todas las tiendas» la ignora.
- **US2-CA3** Si la empresa activa cambia (y no se eligió un chip), el filtro de la pantalla la sigue.
- **US2-CA4** Elegir un chip cambia sólo el filtro de la pantalla (listado, ranking y exportación); no
  cambia la empresa activa persistida y manda sobre la activa de la barra.
- **US2-CA5** Si el catálogo no carga, la pantalla sigue sin filtro de tienda (comportamiento previo).

### US3 · «Todas mis empresas» (vista combinada) en el selector de la barra superior

- **US3-CA1** El selector ofrece **«Todas mis empresas»** además de las empresas accesibles; es la
  opción marcada cuando no hay empresa activa. El chip muestra «Varios».
- **US3-CA2** Elegirla **persiste** como «sin empresa activa» (misma tabla que la empresa activa, sin
  fila) y registra el evento `usuario.empresa_activa_cambiada` en la misma transacción.
- **US3-CA3** Las pantallas que filtran por la empresa activa (filtro de tienda de Clientes, F-CLI-11)
  muestran **todas**.
- **US3-CA4** Las secciones cuyo permiso depende de la empresa (ventas, consultas, reportes) usan el
  **mejor rol** entre las empresas activas del usuario: no se ocultan del menú ni se pierden acciones.
- **US3-CA5** Es idempotente: si ya no hay empresa activa, no escribe ni vuelve a registrar.

### US4 · El menú no parpadea al cambiar de empresa

- **US4-CA1** Al elegir otra empresa activa, el menú lateral no se vacía mientras se recargan los
  permisos: sigue visible con lo último cargado hasta que llegan los nuevos.
- **US4-CA2** La carga **inicial** (o el cambio de usuario/organización) sí oculta el menú hasta tener
  permisos: nunca se abre completo por defecto.

### US5 · Toda pantalla con filtro por tienda sigue la empresa activa

- **US5-CA1** Cambiar la empresa activa en la barra superior **acciona el filtro por tienda** de la
  pantalla (Clientes y Actividad): el filtro pasa a esa empresa.
- **US5-CA2** El control de la pantalla (chips o select) puede fijar otra tienda —o «Todas»— sin
  cambiar la empresa activa persistida; al volver a cambiar la activa en la barra, la pantalla la sigue.
- **US5-CA3** El filtro por tienda de cada pantalla lista las **empresas accesibles** (mismo origen que
  el selector, `empresas_para_selector()`).

## Requisitos funcionales

- **FR-001** `private.empresas_accesibles()` suma la rama del superadmin: las empresas **activas** de
  `private.organizacion_id()` (su organización activa). Para el Administrador y los miembros el
  resultado no cambia.
- **FR-002** `public.empresas_para_selector()` y `public.cambiar_empresa_activa(uuid)` heredan lo
  anterior: el superadmin lista y puede activar una empresa de su organización activa.
- **FR-003** La web obtiene las empresas del filtro de Clientes del mismo origen que el selector
  (`empresas_para_selector()`, vía `useEmpresasAccesibles`), no de `dominio.empresas` por RLS.
- **FR-004** `SelectorEmpresa` (F-EMP-05) muestra la etiqueta de **organización** sólo al superadmin
  fuera de una pantalla de empresa; en la ruta de empresa sigue navegando entre empresas.
- **FR-005** `pages/clientes/list.tsx` inicializa el filtro en la empresa activa y la sigue mientras no
  se haya elegido un chip; el chip elegido manda sobre el filtro de la pantalla.
- **FR-006** `public.usar_todas_las_empresas()` (nueva RPC, `authenticated`) borra la fila de
  `usuario_empresa_activa` del usuario y registra el evento; única vía de escritura del estado «Todas».
- **FR-007** `private.roles_de_referencia(text)` resuelve las secciones por empresa con el rol de la
  empresa activa o, **sin empresa activa**, con el mejor rol entre las empresas activas del usuario.
- **FR-008** `useEmpresaActiva` expone `esTodas` (hay empresas y ninguna activa) y `cambiarATodas`; el
  `SelectorEmpresaActiva` agrega la opción con el mismo flujo de confirmación que el cambio de empresa.
- **FR-009** `SiderPanel` no se vacía cuando `usePermisosPanel().isLoading` está en curso **con
  permisos ya cargados** (recarga); sólo se oculta cuando todavía no hay permisos para la clave actual.
- **FR-010** `hooks/useFiltroPorEmpresaActiva.ts` centraliza el filtro por tienda que sigue a la empresa
  activa (con sobreescritura de pantalla que se descarta al cambiar la activa); lo usan
  `pages/clientes/list.tsx` y `pages/actividad/list.tsx`.

## Fuera de alcance (explícito)

- No se cambia qué empresas puede **editar** un usuario ni la RLS de `dominio.empresas`; el cambio es
  de **alcance del selector/filtro** y de la resolución de rol por sección, no de RLS.
- No se cambia el formulario «Habilitado en» del cliente (sigue con `useEmpresas`).
- No se toca el contexto de organización por pantalla (`ContextoOrganizacionActiva`, FR-006).
- Con **una sola** empresa accesible el selector sigue siendo una etiqueta fija (no ofrece «Todas»).
- Sólo Clientes y Actividad tienen hoy un filtro por tienda; las demás pantallas lo adoptarán con
  `useFiltroPorEmpresaActiva` cuando lo implementen (no se agregan filtros nuevos acá).

## Matriz pantalla↔criterios

Ítems tomados de `design/pantallas/AdminHeader.inventory.json` y `Clientes.inventory.json`. Lo no
listado no cambia en esta entrega.

### Barra superior (`AdminHeader.inventory.json`)

| Ítem del inventario | Dueño | Criterio / nota |
|---|---|---|
| Botón «Empresa activa» | Esta spec (F-ROL-06) | US1-CA1…CA3 · FR-001/002/004: superadmin ve la organización y sus empresas; el resto sus empresas accesibles |
| Opción «Todas mis empresas» del menú | Esta spec (F-ROL-06) | US3-CA1…CA5 · FR-006/007/008: vista combinada persistida (sin empresa activa), con el mejor rol entre sus empresas |
| Menú lateral del panel | Esta spec (fix) | US4-CA1/CA2 · FR-009: no se vacía al recargar los permisos por cambio de empresa |

### Clientes · Listado (`Clientes.inventory.json`)

| Ítem del inventario | Dueño | Criterio / nota |
|---|---|---|
| Columna «Tiendas» / filtro por tienda (`{{tFilt}}`) | Esta spec (F-CLI-11) | US2-CA1…CA5 · US5-CA1…CA3 · FR-003/005/010: fila «Tienda» con las empresas accesibles, siguiendo la empresa activa |
| Columna «Cuenta web» | Fuera de alcance (MSF-450) | Placeholder `—` |
| Diálogo «Enviar correo a seleccionados» / «Importar» / «Etiquetas» | Fuera de alcance (MSF-155/142/445) | No se implementan |

### Actividad · Historial (`Actividad.inventory.json`)

| Ítem del inventario | Dueño | Criterio / nota |
|---|---|---|
| Filtro «Tienda» | Esta spec (F-AUD-01, filtro) | US5-CA1…CA3 · FR-010: sigue la empresa activa; el select la sobreescribe. Lista las empresas accesibles |
| Botón «Exportar» | Fuera de alcance (F-AUD-01) | Sin exportación |

## Decisiones

- **Un solo origen de empresas:** el filtro y el selector comparten `empresas_para_selector()`. Evita
  que la pantalla ofrezca empresas que el selector no deja activar.
- **La rama del superadmin vive en `empresas_accesibles()`:** es el único punto que ya gatea el
  selector y la activación; ampliarlo ahí mantiene el resto sin cambios.
- **La etiqueta de organización se reserva al superadmin:** es quien opera entre organizaciones; el
  usuario común ve sus empresas (prototipo: un solo botón «Empresa activa»).
- **El filtro sigue la activa pero el chip manda:** replica `gc_co` → `tFilt` del prototipo. El
  filtro arranca en la empresa activa y la sigue mientras no se elija un chip.

## Supuestos

- `superadmin_organizacion_activa` es la organización activa del superadmin (`private.organizacion_id()`
  ya la prioriza cuando no hay membresía).
- Las empresas **pausadas** no se ofrecen en el selector (ya era el comportamiento del selector).

## Pruebas

- **pgTAP** `supabase/tests/database/selector_empresas_superadmin.test.sql` (9 aserciones): superadmin
  sin/con organización activa, aislamiento entre organizaciones, activación válida/ajena y regresión
  de Administrador y miembro.
- **pgTAP** `supabase/tests/database/empresa_activa_todas.test.sql` (19 aserciones): «Todas mis
  empresas» borra la activa, mejor rol en las secciones por empresa, idempotencia, evento, vuelta a
  una empresa concreta, rechazos (suspendido/sin empresas) y privilegios.
- **Vitest** `apps/web/src/hooks/useEmpresasAccesibles.test.tsx`,
  `hooks/useFiltroPorEmpresaActiva.test.tsx`,
  `components/navegacion/SelectorEmpresa.test.tsx`,
  `components/navegacion/SelectorEmpresaActiva.test.tsx`,
  `components/navegacion/SiderPanel.test.tsx`, `lib/empresaActiva.test.ts`,
  `pages/clientes/list.test.tsx`, `pages/clientes/list.ranking.test.tsx`,
  `pages/actividad/list.test.tsx`.
- Regresión: `pnpm test` (web + DB), `pnpm lint`, `pnpm build`, `pnpm estilos:check`,
  `pnpm prototipo:check`, `pnpm matriz:check`, `pnpm docs:check`.

## Reversión

Migraciones aditivas `20261018160000_selector_empresas_superadmin.sql` (`create or replace` de
`private.empresas_accesibles()`) y `20261018170000_empresa_activa_todas.sql` (`create or replace` de
`private.roles_de_referencia()` + `public.usar_todas_las_empresas()`). Reversión (en migraciones
posteriores): recrear `private.empresas_accesibles()` con la definición de
`20261016140100_roles_por_empresa.sql` (sin la rama de superadmin), recrear
`private.roles_de_referencia()` sin la rama «sin empresa activa», `drop function
public.usar_todas_las_empresas()` y revertir los cambios web de
`useEmpresasAccesibles`/`SelectorEmpresa`/`SelectorEmpresaActiva`/`useEmpresaActiva`/`list.tsx`/
`SiderPanel`. Sin tablas ni datos nuevos.
