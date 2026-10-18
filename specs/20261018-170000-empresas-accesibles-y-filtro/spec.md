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
- **US2-CA3** Si la empresa activa cambia, el filtro de la pantalla la sigue.
- **US2-CA4** Elegir un chip cambia sólo el filtro de la pantalla (listado, ranking y exportación); no
  cambia la empresa activa persistida.
- **US2-CA5** Si el catálogo no carga, la pantalla sigue sin filtro de tienda (comportamiento previo).

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
- **FR-005** `pages/clientes/list.tsx` inicializa el filtro en la empresa activa y lo vuelve a seguir
  cuando la activa cambia; el chip elegido manda sobre el filtro de la pantalla.

## Fuera de alcance (explícito)

- No se cambia qué empresas puede **editar** un usuario ni la RLS de `dominio.empresas`; el cambio es
  de **alcance del selector/filtro**, no de permisos.
- No se cambia el formulario «Habilitado en» del cliente (sigue con `useEmpresas`).
- No se toca el contexto de organización por pantalla (`ContextoOrganizacionActiva`, FR-006).

## Matriz pantalla↔criterios

Ítems tomados de `design/pantallas/AdminHeader.inventory.json` y `Clientes.inventory.json`. Lo no
listado no cambia en esta entrega.

### Barra superior (`AdminHeader.inventory.json`)

| Ítem del inventario | Dueño | Criterio / nota |
|---|---|---|
| Botón «Empresa activa» | Esta spec (F-ROL-06) | US1-CA1…CA3 · FR-001/002/004: superadmin ve la organización y sus empresas; el resto sus empresas accesibles |

### Clientes · Listado (`Clientes.inventory.json`)

| Ítem del inventario | Dueño | Criterio / nota |
|---|---|---|
| Columna «Tiendas» / filtro por tienda (`{{tFilt}}`) | Esta spec (F-CLI-11) | US2-CA1…CA5 · FR-003/005: fila «Tienda» con las empresas accesibles, siguiendo la empresa activa |
| Columna «Cuenta web» | Fuera de alcance (MSF-450) | Placeholder `—` |
| Diálogo «Enviar correo a seleccionados» / «Importar» / «Etiquetas» | Fuera de alcance (MSF-155/142/445) | No se implementan |

## Decisiones

- **Un solo origen de empresas:** el filtro y el selector comparten `empresas_para_selector()`. Evita
  que la pantalla ofrezca empresas que el selector no deja activar.
- **La rama del superadmin vive en `empresas_accesibles()`:** es el único punto que ya gatea el
  selector y la activación; ampliarlo ahí mantiene el resto sin cambios.
- **La etiqueta de organización se reserva al superadmin:** es quien opera entre organizaciones; el
  usuario común ve sus empresas (prototipo: un solo botón «Empresa activa»).
- **El filtro sigue la activa pero el chip manda:** replica `gc_co` → `tFilt` del prototipo.

## Supuestos

- `superadmin_organizacion_activa` es la organización activa del superadmin (`private.organizacion_id()`
  ya la prioriza cuando no hay membresía).
- Las empresas **pausadas** no se ofrecen en el selector (ya era el comportamiento del selector).

## Pruebas

- **pgTAP** `supabase/tests/database/selector_empresas_superadmin.test.sql` (9 aserciones): superadmin
  sin/con organización activa, aislamiento entre organizaciones, activación válida/ajena y regresión
  de Administrador y miembro.
- **Vitest** `apps/web/src/hooks/useEmpresasAccesibles.test.tsx`,
  `components/navegacion/SelectorEmpresa.test.tsx`,
  `pages/clientes/list.test.tsx`, `pages/clientes/list.ranking.test.tsx`.
- Regresión: `pnpm test` (web + DB), `pnpm lint`, `pnpm build`, `pnpm estilos:check`,
  `pnpm prototipo:check`, `pnpm matriz:check`, `pnpm docs:check`.

## Reversión

Migración aditiva `20261018160000_selector_empresas_superadmin.sql` (`create or replace` de
`private.empresas_accesibles()`). Reversión (en una migración posterior): recrear
`private.empresas_accesibles()` con la definición de `20261016140100_roles_por_empresa.sql` (sin la
rama de superadmin) y revertir los cambios web de `useEmpresasAccesibles`/`SelectorEmpresa`/`list.tsx`.
Sin tablas ni datos nuevos.
