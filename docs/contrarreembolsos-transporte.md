# Ventas · Contrarreembolsos por transporte (F-VTA-14)

Historia MSF-410 de la épica MSF-195 (spec `specs/20261024-150000-ventas-cobros-y-conciliacion/`,
US3 · FR-040…FR-045 · SC-005). Esta nota documenta **la base de datos** de la historia: la tabla
del contrarreembolso, la función interna que lo abre, la RPC que lo marca cobrado y las de lectura.
La pantalla (pestaña «Contrarreembolsos» dentro de `/ventas/transportes`) la documenta su propia
tarea; el cierre de la épica (`docs/ventas-cobros-y-conciliacion.md`) junta el modelo completo.

Contexto: [Ventas · Cobros por comprobante](./cobros-por-comprobante.md) (F-VTA-12, el libro de
cobros) y [Ventas · Transportes y terminales de retiro](./ventas-transportes.md) (F-VTA-04, el
catálogo de transportes, con el campo `cobra_contrarreembolso`).

## Migraciones de la historia

Las tres migraciones son **aditivas** (con reversión en el encabezado) y usan la banda de versiones
**`20261217100000`…`20261217100200`**, en este orden:

| Versión | Qué trae |
|---|---|
| `20261217100000_contrarreembolsos.sql` | La tabla `dominio.contrarreembolsos`, su RLS y `private.abrir_contrarreembolso`. |
| `20261217100100_marcar_contrarreembolso_cobrado.sql` | La acción `cobrar_contrarreembolso` en la matriz de permisos y `public.marcar_contrarreembolso_cobrado` (+ la lectura del permiso). |
| `20261217100200_listar_contrarreembolsos.sql` | `public.listar_contrarreembolsos` y `public.resumen_contrarreembolsos`. |

La banda es **nueva y mayor** a propósito: con los números que nombra `tasks.md` (`20261209300…`)
las migraciones quedaban por debajo de la cola ya aplicada en dokploy (`20261212120600`) y de la
banda de F-VTA-12 (`20261215100000`…`20261215100400`), y `supabase db push` las rechaza («found
local migration files to be inserted before the last migration on remote database»); el guard
`scripts/verificar-migraciones.mjs` lo marca como «versión REUSADA» y `pnpm docs:check` falla.
`tasks.md` sigue nombrando la banda vieja porque es la spec compartida entre historias y **no se
edita**. **F-VTA-13 tiene que usar otra banda** (la que sigue a esta).

## La tabla `dominio.contrarreembolsos`

Es un **libro de dinero**: un contrarreembolso no se borra ni se edita a mano. Por eso no hay
política ni permiso de `insert`, `update` o `delete`: escribe la función interna que lo abre y la
RPC pública que lo cobra.

| Columna | Qué es |
|---|---|
| `organizacion_id`, `empresa_id` | Dueña y tienda del contrarreembolso. La empresa es siempre la del comprobante. |
| `comprobante_id` | La factura cuyo saldo quedó en manos del transporte (FK compuesta: no puede ser de otra organización). |
| `transporte_id` | Quién cobra (FK compuesta con `dominio.transportes`). |
| `guia` | La guía del envío: es lo que identifica el contrarreembolso. **Única por comprobante** → la misma guía no abre dos contrarreembolsos. |
| `importe` | `numeric(14,2)` **mayor a 0**: lo que el transporte cobró al entregar (el saldo del comprobante al abrirlo). |
| `estado` | `pendiente` o `cobrado`. Lo mueve la RPC de cobro, nadie más. |
| `cobrado_por`, `cobrado_por_nombre`, `cobrado_en` | Quién y cuándo lo cobró. El nombre es una **foto**: el historial sobrevive a la baja de la cuenta. |
| `cobro_id` | El cobro del libro que registró el transporte al rinde (`dominio.cobros_comprobante`, FK compuesta). Nulo mientras está pendiente. |
| `creado_en`, `actualizado_en` | Cuándo se abrió y la versión del bloqueo optimista del «Marcar cobrado». |

**RLS**: lectura por organización, empresa accesible (`private.empresas_accesibles()`) y sección
`ventas` en lectura o edición. `anon` sin privilegios. La escritura directa está bloqueada por
doble: no hay política de escritura y no hay permiso de escritura.

**Integridad**: FK compuestas contra `dominio.comprobantes_venta`, `dominio.empresas`,
`dominio.transportes` y `dominio.cobros_comprobante` (una organización no puede apuntar a los
datos de otra) + un `check` que exige que el cobro vaya entero o no vaya (`pendiente` sin datos de
cobro, `cobrado` con todos).

## Abrir el contrarreembolso (FR-040)

`private.abrir_contrarreembolso(p_comprobante_id uuid, p_transporte_id uuid, p_guia text) returns uuid`

Es el punto de entrada que usará la **guía de despacho** de F-VTA-16 (MSF-135); mientras esa
historia no exista, se simula desde las pruebas. Vive en `private` **sin `grant` a
`authenticated`**: la usan funciones del servidor, no la app.

- La **organización y la empresa salen del comprobante**, no de un argumento: la función no acepta
  ids sueltos que puedan apuntar a otra organización. Si la sesión trae organización (una persona),
  tiene que ser la del comprobante (`42501` si no).
- **Solo si el transporte cobra contrarreembolso** (`cobra_contrarreembolso`): un transporte que no
  cobra al entregar no genera nada.
- **Idempotente por (comprobante, guía)**: la misma guía devuelve el contrarreembolso ya abierto,
  sin duplicar y sin evento nuevo.
- El **importe es el saldo** del comprobante.
- Deja el evento `contrarreembolso.abierto` en la misma transacción, con el actor y la tienda.
- Toma el comprobante **con bloqueo de fila**: serializa dos aperturas de la misma guía y serializa
  contra el registro de cobros (que bloquea el mismo comprobante), así que el importe nunca se
  calcula con un saldo viejo.
- Una factura en borrador o anulada no abre contrarreembolso (`55000`).

## Marcar el contrarreembolso como cobrado (FR-041…FR-044)

`public.marcar_contrarreembolso_cobrado(p_id uuid, p_actualizado_en timestamptz) returns dominio.contrarreembolsos`

- **Permiso**: la acción `cobrar_contrarreembolso` de la sección `ventas`, sembrada para
  **Administración y Administrador** (los demás roles quedan sin permiso aunque tengan `ventas` en
  edición). Se resuelve con el rol del usuario **en la empresa del contrarreembolso**
  (`private.puede_cobrar_contrarreembolso_en_empresa`), no con la suma de sus roles.
- **Idempotente**: si ya está Cobrado, devuelve la fila tal cual — un doble clic no cobra dos
  veces ni deja un segundo evento.
- **Bloqueo optimista**: `p_actualizado_en` es la versión leída en pantalla; si el contrarreembolso
  cambió en el meantime, la RPC responde `40001`.
- **El cobro del comprobante** lo registra `private.registrar_cobro_interno` (F-VTA-12) con origen
  `contrarreembolso`: es la única vía a Cobrado/Deuda, así que la factura pasa a Cobrado si el saldo
  llega a 0. La forma de pago es la de la factura y, si no tiene, la forma «Contrarreembolso» de la
  tienda.
- **Un comprobante anulado no se cobra** (FR-044): el contrarreembolso queda visible y pendiente,
  pero no cobrable, con un mensaje claro (`55000`).
- Deja el evento `contrarreembolso.cobrado` en la misma transacción, con el actor, la tienda y la
  guía. Ningún evento lleva datos bancarios completos.

## Permiso por empresa y lectura para la pantalla

- `public.puede_cobrar_contrarreembolso(p_empresa_id uuid) returns boolean`: la lectura que necesita
  la pantalla para ocultar el botón «Marcar cobrado» (FR-047). Solo devuelve el permiso propio: la
  autorización real la hace la RPC de cobro.
- La acción vive en `public.permisos_rol_accion` (plataforma), como `registrar_cobro`. La siembra es
  idempotente (`on conflict do nothing`) y no pisa las ediciones a mano; las organizaciones nuevas la
  reciben por el trigger de organizaciones.

### Matriz de permisos: coordinación con F-VTA-13

Esta historia y **F-VTA-13** agregan una acción cada una a la **misma** matriz
(`public.permisos_rol_accion`). Para que las dos bandas convivan sin depender del orden de merge:

- El `check` `permisos_rol_accion_accion_check` se rearma con las acciones **ya sembradas** más
  `cobrar_contrarreembolso`: una lista fija de esta historia sola dejaría afuera la acción de la
  otra historia y el `add constraint` fallaría con las filas ya sembradas (la base quedaría a medio
  aplicar).
- `cobrar_contrarreembolso` se siembra en `private.sembrar_permisos` (la usan el trigger de
  organizaciones nuevas y `public.restablecer_matriz_permisos`), **sin** reemplazar
  `private.matriz_acciones_iniciales`: así la acción de F-VTA-13 sigue llegando por su propia
  migración.
- `private.puede_accion` reconoce la acción nueva y cualquier acción que ya exista en la matriz,
  para no descartar la de la otra historia. El cierre de la épica (T034) reconcilia la matriz
  completa.

## Lectura (FR-045)

- `public.listar_contrarreembolsos(p_empresa_id uuid default null, p_estado text default null, p_pagina integer default 1, p_tamano integer default 10)`: fecha, tienda, factura, cliente, transporte, guía, importe, estado, `actualizado_en` y `filas` (el total del filtro, para el «1–10 de N» de la pantalla). `p_estado` ∈ (`pendiente`, `cobrado`); `p_tamano` se acota a 100.
- `public.resumen_contrarreembolsos(p_empresa_id uuid default null)`: `pendiente_importe`, `pendiente_cantidad` y `cobrado_mes_importe` (lo cobrado en el mes en curso) — las tarjetas de la pantalla.
- Las dos son `security invoker`: manda la RLS de `dominio.contrarreembolsos` (organización, empresa
  accesible y sección `ventas`) y además filtran por organización y por las empresas accesibles.

## Reversión

Migraciones aditivas; el camino de reversión (drop de funciones y de la tabla, y retiro de la fila
sembrada de la matriz de permisos) está en el encabezado de cada una, en una migración posterior
(**no en este PR**; exportar antes los contrarreembolsos ya cargados). El PR se revierte entero con
`git revert -m 1`.

## Pruebas

- pgTAP: `supabase/tests/database/contrarreembolsos.test.sql` (RLS y sin escritura directa, apertura
  solo con transporte que cobra, idempotencia por guía, importe, evento de apertura, permiso por
  rol, bloqueo optimista, idempotencia del cobro, cobro asociado con origen `contrarreembolso`,
  comprobante anulado, listado con filtros y paginación, totales, aislamiento entre organizaciones,
  `anon` y las funciones internas).
- El paso a Cobrado de la factura lo aplica `private.marcar_estado_cobro_comprobante` (MSF-177, PR
  #343), que todavía **no está en esta rama**: hasta que se mergee, la prueba usa un doble de
  prueba de esa función (creado dentro de la transacción de la prueba, que se revierte) para poder
  ejercitar el camino feliz. Cuando MSF-177 entre, corre la función real sin tocar la prueba.
