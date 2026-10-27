---
owner: tecnico
sources:
  - specs
  - supabase/migrations
  - apps/web/src
---

# Ventas · cobros y conciliación (técnico, MSF-195)

Implementación de la épica **MSF-195** (spec `20261024-150000-ventas-cobros-y-conciliacion`):
**F-VTA-12** cobros por comprobante (MSF-389), **F-VTA-13** conciliación de pagos por cuenta de cobro
(MSF-401) y **F-VTA-14** contrarreembolsos por transporte (MSF-410). La vista de producto está en
[Ventas · cobros y conciliación (producto)](../producto/ventas-cobros-y-conciliacion.md); el listado y
los estados del comprobante, de MSF-177, en
[Ventas · listado, estados y anulación (técnico)](ventas-listado-estados-y-anulacion.md).

!!! note "Estado"
    Implementado en la rama `epic/MSF-195-ventas-y-despacho-ventas-cobros-y-concil`, **pendiente de merge a
    `main`**. Migraciones: `20261215100000`…`20261215100400` (F-VTA-12), `20261216100000`…`20261216100300`
    (F-VTA-13) y `20261217100000`…`20261217100200` (F-VTA-14). Sin `kestra`, `superset` ni `workers`: el
    alcance de entrega es `refine` y `supabase`.

!!! warning "Banda de versiones de las migraciones"
    Las tres historias usan bandas **nuevas y mayores** a propósito. Con los números que nombra
    `tasks.md` (`20261209*`) las migraciones quedaban por debajo de la cola ya aplicada en `dokploy`
    (`20261212120600`) y `supabase db push` las rechaza (*«found local migration files to be inserted
    before the last migration on remote database»*); el guard `scripts/verificar-migraciones.mjs` lo
    marca como «versión REUSADA» y `pnpm docs:check` falla.

## Pantallas y rutas

| Ruta | Pantalla | Archivos | Historia |
|---|---|---|---|
| `/ventas/comprobantes/:id` | Detalle del comprobante: tarjeta **Cobros**, diálogo «Registrar cobro» y campo «Cuenta de cobro». | `apps/web/src/pages/ventas/comprobante.tsx`, `apps/web/src/components/ventas/CobrosComprobante.tsx`, `apps/web/src/lib/ventas/cobros.ts` | F-VTA-12 |
| `/ventas/pagos` | **Pagos**: tarjetas, filtro Tienda, filtro de cuentas, «Solo con saldo», tabla con el interruptor «Cobrado» y la tarjeta Cuentas de cobro. | `apps/web/src/pages/ventas/pagos/list.tsx`, `apps/web/src/components/ventas/CuentasCobroResumen.tsx`, `apps/web/src/lib/ventas/pagos.ts` | F-VTA-13 |
| `/ventas/transportes` | **Transportes y contrarreembolsos**: sub-pestañas «Contrarreembolsos» (tarjetas, tabla y «Marcar cobrado») y «Terminales de retiro» (MSF-139, sin cambios). | `apps/web/src/pages/ventas/transportes/list.tsx`, `apps/web/src/components/ventas/ContrarreembolsosTabla.tsx`, `apps/web/src/lib/ventas/contrarreembolsos.ts` | F-VTA-14 |

- Menú **Ventas** (`apps/web/src/components/navegacion/destinosPanel.ts`): la épica agrega la entrada
  **«Pagos»** (`/ventas/pagos`, icono `CreditCardIcon`); «Transportes» ya existía desde MSF-139 y su
  etiqueta de menú no cambia (la pantalla sí cambia de título).
- Las tres pantallas usan `FiltroEmpresa` («Todas las tiendas» + empresas accesibles) y respetan la
  **empresa activa** de la barra superior (Principio VIII).

## Modelo de datos

| Objeto | Esquema | Estado | Cambio |
|---|---|---|---|
| `dominio.cobros_comprobante` | `dominio` | **nueva** | Libro de cobros: un cobro por fila (importe, forma de pago, cuenta de cobro, origen, quién lo registró y quién lo aprobó). Sin escritura directa. |
| `dominio.contrarreembolsos` | `dominio` | **nueva** | Lo que un transporte cobra al entregar y rinde después (guía, importe, estado). Sin escritura directa. |
| `dominio.comprobantes_venta` | `dominio` | **existente** | Sin cambio de esquema: solo se lee (total) y cambia de estado con `private.marcar_estado_cobro_comprobante` (MSF-177). |
| `dominio.formas_pago` | `dominio` | **alterada** | Sin cambio de columnas: se agrega el índice único `formas_pago_id_organizacion_uq (id, organizacion_id)` que habilita la FK compuesta de la forma de pago del cobro. |
| `dominio.cuentas_cobro` (+ `cuentas_cobro_empresas`), `dominio.transportes` | `dominio` | **existentes** | Catálogos de MSF-139: solo se leen. |
| `public.permisos_rol_accion` | `public` | **existente** | Solo **datos**: las acciones `registrar_cobro`, `conciliar_pago` y `cobrar_contrarreembolso`, todas en la sección `ventas`. El `check` de acciones se rearma en cada historia. |
| `public.registro_actividad` | `public` | **existente** | Sin cambio: de ahí salen los eventos de la épica. |

El modelo completo y el DER están en
[Datos y DER](datos.md#ventas-cobros-y-conciliacion-msf-195); el
[ERD interactivo (Archify)](../diagrams/msf-195-erd.html) muestra el libro de cobros, los
contrarreembolsos, las tablas de donde salen sus datos y las de plataforma, con PK/FK y cardinalidad.

### `dominio.cobros_comprobante` (`20261215100000_cobros_comprobante.sql`)

Es un **libro de dinero**: un cobro no se borra ni se edita (lo único que se mueve después es la
aprobación de la conciliación).

| Columna | Qué es |
|---|---|
| `organizacion_id`, `empresa_id` | Dueña y tienda del cobro. La empresa es siempre la del comprobante. |
| `comprobante_id` | La factura cobrada (FK compuesta `(comprobante_id, organizacion_id)`). |
| `importe` | `numeric(14,2)` con `check (importe > 0)`. |
| `forma_pago_id` | Forma de pago de la **misma empresa** (FK compuesta). |
| `cuenta_cobro_id` | Cuenta de cobro, **nula** si la forma de pago no exige cuenta (efectivo). FK compuesta. |
| `origen` | `manual` (lo registra una persona) o `contrarreembolso` (lo rinde un transporte, F-VTA-14). |
| `registrado_por`, `registrado_por_nombre`, `registrado_en` | Quién y cuándo. El nombre es una **foto**: el historial sobrevive a la baja de la cuenta (mismo criterio que `dominio.movimientos_stock.actor_id`). |
| `aprobado_por`, `aprobado_por_nombre`, `aprobado_en` | Conciliación (F-VTA-13). El `check` `cobros_comprobante_aprobacion_ck` exige que vayan enteros o no vayan. |
| `actualizado_en` | Versión para el bloqueo optimista de la conciliación. |

- **RLS**: `select` para `authenticated` con `organizacion_id = private.organizacion_id()`,
  `empresa_id in (select private.empresas_accesibles())` y `private.nivel_seccion('ventas') in
  ('lectura','edicion')`. **Sin escritura directa**: `revoke all … from public, anon, authenticated` y
  solo `grant select` a `authenticated`; `anon` sin privilegios.
- **Índices**: `cobros_comprobante_comprobante_idx (comprobante_id, registrado_en desc)` (el que usa
  el saldo), `cobros_comprobante_org_empresa_idx` y `cobros_comprobante_cuenta_idx` (parcial, solo los
  cobros con cuenta: los que se concilian).
- **Integridad**: el disparador `cobros_comprobante_validar` (`private.validar_cobro_comprobante`,
  `security definer`, **sin grant**) comprueba en el `insert` que el comprobante, la forma de pago y la
  cuenta de cobro sean los de la empresa del cobro, que la forma esté activa y que la cuenta esté
  activa y habilitada en esa empresa. Solo en el `insert`: después el cobro es inmutable.

### `dominio.contrarreembolsos` (`20261217100000_contrarreembolsos.sql`)

| Columna | Qué es |
|---|---|
| `organizacion_id`, `empresa_id` | Dueña y tienda. La empresa es siempre la del comprobante. |
| `comprobante_id` | La factura cuyo saldo quedó en manos del transporte (FK compuesta). |
| `transporte_id` | Quién cobra (FK compuesta con `dominio.transportes`). |
| `guia` | La guía del envío: `check (btrim(guia) <> '' and length(guia) <= 100)`; única por comprobante. |
| `importe` | `numeric(14,2)` con `check (importe > 0)`: el saldo del comprobante al abrirlo. |
| `estado` | `pendiente` o `cobrado`. Lo mueve la RPC de cobro, nadie más. |
| `cobrado_por`, `cobrado_por_nombre`, `cobrado_en` | Quién y cuándo lo cobró (foto del nombre). |
| `cobro_id` | El cobro del libro que registró el transporte al rinde (FK compuesta con `dominio.cobros_comprobante`). |
| `creado_en`, `actualizado_en` | Cuándo se abrió y la versión del bloqueo optimista. |

- **RLS**: igual que la de cobros (organización, empresa accesible y `ventas` en lectura o edición), sin
  escritura directa y con `anon` sin privilegios.
- **Integridad**: FK compuestas contra `dominio.comprobantes_venta`, `dominio.empresas`,
  `dominio.transportes` y `dominio.cobros_comprobante`, más un `check` que exige que el cobro vaya
  entero o no vaya.

## RPC

Las RPC de `public` están en `public`, con `set search_path = ''`, `revoke execute … from public, anon` y
`grant execute … to authenticated`. Las de apoyo en `private` **no** se otorgan a `authenticated` (las
llaman las RPC `security definer`). La organización y el actor salen de la sesión
(`private.organizacion_id()`, `auth.uid()`), nunca de un argumento. La sección `ventas` se evalúa **en
la empresa del dato** (`private.puede_*_en_empresa`), no en la empresa activa.

### F-VTA-12 · Cobros

| RPC | Qué hace | Seguridad |
|---|---|---|
| `registrar_cobro(p_comprobante_id uuid, p_importe numeric, p_forma_pago_id uuid, p_cuenta_cobro_id uuid default null, p_actualizado_en timestamptz default null)` → `dominio.cobros_comprobante` | Registra un cobro: solo factura confirmada no anulada; importe > 0 con dos decimales y ≤ saldo; forma de pago de la misma empresa y activa; cuenta de cobro exigida por la forma, activa y habilitada para la empresa. Devuelve la fila. | `security definer`; exige `ventas` en edición y la acción `registrar_cobro` |
| `saldo_comprobante(p_id uuid)` → `(total, cobrado, saldo)` | Total con IVA, suma de los cobros y lo que falta. `saldo = greatest(total − cobrado, 0)`. | `security invoker` |
| `cobros_de_comprobante(p_comprobante_id uuid)` → `(id, fecha, forma_pago, forma_pago_tipo, cuenta_cobro, cuenta_cobro_banco, cuenta_cobro_titular, importe, origen, conciliado, aprobado_por, registrado_por)` | La lista de cobros de la factura. Devuelve el **tipo** de la forma de pago y el **banco/titular** de la cuenta además del nombre: la pantalla distingue el contrarreembolso por tipo (el nombre lo edita la persona y no es un dato estable) y muestra «Banco · Titular». | `security invoker` |
| `puede_registrar_cobro(p_empresa_id uuid)` → `boolean` | **Lectura** del permiso para la pantalla: acción `registrar_cobro` de Ventas **y** `ventas` en edición, resueltas con el rol del usuario en esa empresa. No autoriza nada: la autoridad es `registrar_cobro`. | `security definer` |
| `private.registrar_cobro_interno(p_comprobante_id uuid, p_importe numeric, p_forma_pago_id uuid, p_cuenta_cobro_id uuid, p_origen text, p_actor uuid)` → `uuid` | **Único camino** para dejar un cobro en el libro: valida el tope con la fila del comprobante bloqueada (`for update`), inserta el cobro y aplica Cobrado/Deuda con `private.marcar_estado_cobro_comprobante`. La usan `registrar_cobro` y `marcar_contrarreembolso_cobrado`. | `security definer`, **sin grant** |
| `private.saldo_comprobante(p_id uuid)` | Cuenta interna del saldo. **Volátil** a propósito: `registrar_cobro_interno` la usa justo después de insertar el cobro y tiene que ver esa fila (una función `stable` usaría el snapshot de la sentencia que la llamó y vería el saldo anterior). | `security definer`, sin grant |
| `private.validar_cobro_comprobante()` | Disparador de integridad del `insert`. | `security definer`, sin grant |
| `private.puede_registrar_cobro_en_empresa(p_empresa_id uuid)` | Permiso por empresa (la del comprobante). | `security definer`, sin grant |

`p_actualizado_en` viene en el contrato pero **no se compara**: el cobro no usa bloqueo optimista porque
el saldo se recalcula con el bloqueo de fila sobre el comprobante.

### F-VTA-13 · Conciliación

| RPC | Qué hace | Seguridad |
|---|---|---|
| `conciliar_pago(p_id uuid, p_actualizado_en timestamptz)` → `dominio.cobros_comprobante` | Aprueba un pago **con cuenta de cobro**: guarda `aprobado_por`/`aprobado_por_nombre`/`aprobado_en`. Idempotente y con bloqueo optimista (`40001`). | `security definer`; exige `ventas` en edición y la acción `conciliar_pago` |
| `revertir_conciliacion_pago(p_id uuid, p_actualizado_en timestamptz)` → `dominio.cobros_comprobante` | Ídem, quita la aprobación. | `security definer`; exige `ventas` en edición y la acción `conciliar_pago` |
| `listar_pagos(p_empresa_id uuid default null, p_cuenta_cobro_id uuid default null, p_solo_con_saldo boolean default false, p_pagina integer default 1, p_tamano integer default 10)` → `(id, fecha, empresa_id, empresa, comprobante_id, numero, cliente, cuenta_cobro_id, cuenta_cobro, importe, aprobado_por, conciliado, saldo, actualizado_en, filas)` | Listado paginado de los cobros **con cuenta de cobro**, con filtro por empresa, por cuenta y «Solo con saldo». `filas` es el total del filtro (`count(*) over ()`). Tope de 200 por página; orden `registrado_en desc, id desc`. El saldo es el del **comprobante** (`total con IVA − todos sus cobros`), resuelto con un `left join lateral` sobre el índice `cobros_comprobante_comprobante_idx`. | `security invoker` |
| `resumen_pagos(p_empresa_id uuid default null)` → `(por_conciliar_importe, por_conciliar_cantidad, conciliado_importe, conciliado_cantidad, saldo_pendiente)` | Totales de las tarjetas de Pagos. El **saldo pendiente** suma los saldos de los comprobantes con **pago parcial**, mirando **todos** sus cobros (no solo los que tienen cuenta: lo que el cliente debe no depende de cómo pagó) y excluyendo los comprobantes en `borrador` o `anulada`. | `security invoker` |
| `cuentas_cobro_mas_usadas(p_empresa_id uuid default null, p_limite integer default 8)` → `(id, nombre, banco, activa, usos, total_cuentas)` | Alimenta la tarjeta Cuentas de cobro. `usos` cuenta solo los pagos de empresas accesibles. | `security invoker` |
| `puede_conciliar_pago(p_empresa_id uuid)` → `boolean` | Lectura del permiso por empresa para habilitar (o no) el interruptor «Cobrado». No autoriza nada. | `security definer` |
| `private.aplicar_conciliacion(p_id uuid, p_actualizado_en timestamptz, p_conciliado boolean)` | Camino único que mueve la aprobación: las dos RPC públicas son envoltorios y no pueden divergir. | `security definer`, **sin grant** |
| `private.puede_conciliar_pago_en_empresa(p_empresa_id uuid)` | Permiso por empresa (la del pago). | `security definer`, sin grant |

### F-VTA-14 · Contrarreembolsos

| RPC | Qué hace | Seguridad |
|---|---|---|
| `marcar_contrarreembolso_cobrado(p_id uuid, p_actualizado_en timestamptz)` → `dominio.contrarreembolsos` | Pasa el contrarreembolso a `cobrado` y, en la misma transacción, registra el cobro del comprobante con origen `contrarreembolso` vía `private.registrar_cobro_interno`. Idempotente, con bloqueo optimista. Devuelve la **fila de la tabla** (no la del listado). | `security definer`; exige `ventas` en edición y la acción `cobrar_contrarreembolso` |
| `listar_contrarreembolsos(p_empresa_id uuid default null, p_estado text default null, p_pagina integer default 1, p_tamano integer default 10)` → `(id, fecha, empresa_id, empresa, comprobante_id, numero, cliente, transporte_id, transporte, guia, importe, estado, actualizado_en, filas)` | Listado paginado; `p_estado` ∈ (`pendiente`, `cobrado`); `p_tamano` acotado a 100. | `security invoker` |
| `resumen_contrarreembolsos(p_empresa_id uuid default null)` → `(pendiente_importe, pendiente_cantidad, cobrado_mes_importe)` | Totales de las tarjetas de Transportes. | `security invoker` |
| `puede_cobrar_contrarreembolso(p_empresa_id uuid)` → `boolean` | Lectura del permiso por empresa para ocultar «Marcar cobrado». No autoriza nada. | `security definer` |
| `private.abrir_contrarreembolso(p_comprobante_id uuid, p_transporte_id uuid, p_guia text)` → `uuid` | Punto de entrada que usará la guía de despacho de F-VTA-16 (MSF-135). Solo si el transporte tiene `cobra_contrarreembolso`; idempotente por (comprobante, guía); importe = saldo; evento `contrarreembolso.abierto`. | `security definer`, **sin grant** |
| `private.puede_cobrar_contrarreembolso_en_empresa(p_empresa_id uuid)` | Permiso por empresa (la del contrarreembolso). | `security definer`, sin grant |

Errores: `42501` permiso · `22023` dato inválido (`hint` = campo) · `P0002` inexistente o ajeno · `55000`
estado no válido · `40001` conflicto de edición · `P0001` tope de importe. Todos los mensajes están en
castellano.

## Reglas de negocio

### Cobros (F-VTA-12)

- **Documento**: solo **facturas confirmadas no anuladas**. Un borrador, un presupuesto o una nota de
  crédito no admiten cobros (`55000` / `22023`).
- **Importe**: mayor a 0, con dos decimales como máximo, nunca mayor al saldo pendiente (`22023` /
  `P0001`) y nunca mayor al tope de la columna (`999999999999.99`), para que la base no devuelva un
  error técnico (`22003`) que la pantalla no sabe explicar.
- **Concurrencia**: el comprobante se toma con `for update`; dos cobros simultáneos se serializan y el
  segundo ve el saldo que dejó el primero. Nunca se supera el saldo.
- **Estado del comprobante**: saldo 0 → **Cobrado**; saldo > 0 con forma de pago que genera deuda →
  **Deuda**; si no, el estado **no cambia**. Lo aplica `private.marcar_estado_cobro_comprobante`
  (MSF-177), nunca `cambiar_estado_comprobante` (que rechaza Cobrado y Deuda).
- **Errores por campo**: cada error de validación lleva `hint` con el nombre del campo (`importe`,
  `forma_pago_id`, `cuenta_cobro_id`), también el tope (`P0001` con `hint = 'importe'`). Es lo que
  permite que la pantalla marque **el campo** en vez de mostrar un error general.

### Conciliación (F-VTA-13)

- **Solo con cuenta de cobro**: un cobro sin cuenta se rechaza (`22023`). El efectivo no va a ninguna
  cuenta y no hay nada que conciliar contra un banco.
- **Idempotente**: conciliar un pago ya conciliado (o revertir uno ya revertido) **no hace nada**: no
  cambia el estado, no deja evento y no avanza `actualizado_en`.
- **Bloqueo optimista**: `p_actualizado_en` es la versión que la pantalla leyó; si el pago cambió, la
  RPC responde `40001` sin pisar nada.
- **Concurrencia**: el pago se toma con `for update`; dos conciliaciones simultáneas se serializan y
  solo la primera mueve la aprobación.
- **Estado y saldo**: **no se tocan** (FR-022). El estado y el saldo los mueve
  `private.registrar_cobro_interno` (F-VTA-12) y nadie más.
- **Aislamiento**: el pago se busca por id **y** por la organización de la sesión; el de otra
  organización devuelve `P0002`, nunca datos ajenos. Una tienda ajena devuelve **cero filas**, no un
  error que delate su existencia.
- **El nombre del cliente**: el `join` con `public.clientes` es `left` porque Clientes tiene su propia
  RLS: un rol con Ventas pero sin Clientes (Depósito) ve la fila sin nombre. El pago **no** se filtra
  por eso: la fila es de Ventas. Leer el nombre con una función `security definer` se descarta a
  propósito: no amplía el alcance de los datos de Clientes.

### Contrarreembolsos (F-VTA-14)

- **Apertura**: la organización y la empresa salen del **comprobante**, no de un argumento; si la sesión
  trae organización, tiene que ser la del comprobante (`42501`). Un transporte sin
  `cobra_contrarreembolso` no genera nada. Una factura en borrador o anulada no abre
  contrarreembolso (`55000`).
- **Idempotencia**: la misma guía devuelve el contrarreembolso ya abierto, sin duplicar ni dejar un
  evento nuevo.
- **Cobro**: `marcar_contrarreembolso_cobrado` registra el cobro con `origen = 'contrarreembolso'` por
  `private.registrar_cobro_interno`, así que la factura pasa a **Cobrado** si el saldo llega a 0. La
  forma de pago es la de la factura y, si no tiene, la forma «Contrarreembolso» de la tienda.
- **Comprobante anulado**: el contrarreembolso queda visible y pendiente, pero **no cobrable**
  (`55000`, FR-044).

### Permisos: las tres acciones de Ventas

Las tres acciones viven en `public.permisos_rol_accion` (mecanismo de plataforma, esquema `public`) y
**solo en la sección `ventas`**. Los valores iniciales son *datos*: se corrigen por organización desde
«Roles y permisos» (`public.guardar_matriz_permisos`).

| Acción | Mostrador | Administración | Administrador | Operador | Depósito / Consulta / Miembro / Técnico |
|---|---|---|---|---|---|
| `registrar_cobro` | Sí | Sí | Sí | No | No |
| `conciliar_pago` | No | Sí | Sí | No | No |
| `cobrar_contrarreembolso` | No | Sí | Sí | No | No |

- Escribir exige `ventas` en **edición** en la empresa del dato: quien solo tiene lectura nunca cobra,
  concilia ni rinde.
- El permiso se resuelve con el rol del usuario **en esa empresa**, no con la suma de sus roles:
  quien no puede cobrar en la tienda A no lo hereda por ser Administración en la B.
- Las RPC verifican el permiso **en el cuerpo** (no solo en la UI). Las lecturas
  `puede_registrar_cobro`, `puede_conciliar_pago` y `puede_cobrar_contrarreembolso` solo evitan
  ofrecer una acción que la base va a rechazar; si la lectura falla, la pantalla queda **sin permiso**
  (deny-by-default).
- **Coordinación entre historias**: F-VTA-13 y F-VTA-14 agregan una acción cada una a la **misma**
  matriz. Por eso el `check` `permisos_rol_accion_accion_check` se rearma con las acciones **ya
  sembradas** más la nueva, `cobrar_contrarreembolso` se siembra en `private.sembrar_permisos` **sin**
  reemplazar `private.matriz_acciones_iniciales`, y `private.puede_accion` reconoce las dos acciones
  de la otra historia para no descartarlas.

## Actividad

Cada cambio deja evento en `public.registro_actividad` en la **misma transacción** que la escritura y
asociado a la tienda del comprobante. **Ningún evento lleva datos bancarios completos** (ni CBU ni
CUIT): solo nombre de la cuenta, importe y guía.

| Evento | Cuándo |
|---|---|
| `comprobante.cobro_registrado` | Se registra un cobro (actor, tienda, importe y forma). |
| `pago.conciliado` | Se aprueba un pago contra el extracto. |
| `pago.conciliacion_revertida` | Se revierte la aprobación. |
| `contrarreembolso.abierto` | La guía de despacho abre un contrarreembolso (actor, tienda, guía). |
| `contrarreembolso.cobrado` | Administración marca cobrado un contrarreembolso (actor, tienda, guía). |

## Pruebas

- pgTAP (`pnpm test:db`): `supabase/tests/database/cobros_comprobante.test.sql`,
  `pagos_conciliacion.test.sql`, `contrarreembolsos.test.sql` y
  `datos_prueba_ventas_cobros.test.sql` (que comprueba el seed de DEV: la persona de ejemplo con sus
  tres acciones, las dos tiendas, las dos cuentas activas, los cobros parciales y totales, el pago
  conciliado, el contrarreembolso pendiente y que ningún evento lleve CBU ni CUIT completos).
  `rls_en_toda_tabla` (recorre `public` + `dominio`) sigue verde.
- Vitest (`pnpm test:web`): `apps/web/src/pages/ventas/comprobante.cobros.test.tsx`,
  `apps/web/src/pages/ventas/pagos/list.test.tsx`,
  `apps/web/src/pages/ventas/transportes/contrarreembolsos.test.tsx`,
  `apps/web/src/lib/ventas/pagos.test.ts` y
  `apps/web/src/pages/ventas/transportes/list.test.tsx` (la tabla de MSF-139, ahora dentro de
  «Terminales de retiro», sin cambios).
- Guards: `pnpm prototipo:check`, `pnpm matriz:check` y `pnpm ui:empresas:check`.

### Datos de prueba de DEV

`supabase/seed.sql` deja datos de ejemplo (persona `ventas@local.test` / `Ventas-Local1!` como
Administradora de la organización de ejemplo, una segunda tienda, formas de pago «Efectivo»,
«Transferencia bancaria» y «Contrarreembolso», dos cuentas de cobro activas y una marcada «No usar»,
dos transportes —uno que cobra contrarreembolso—, facturas con cobros parciales y totales, y un
contrarreembolso pendiente abierto con `private.abrir_contrarreembolso`). El seed es **idempotente** y
**no se aplica contra un proyecto remoto**: se carga con `supabase db reset`.

## Revisión de seguridad del cierre (T032 · SC-007)

Revisión `authz-security` + `supabase` del diff de la épica (las doce migraciones), con lectura de los
pgTAP de cobros, conciliación, contrarreembolsos y `rls_en_toda_tabla`:

| Tema | Resultado |
|---|---|
| Esquema (Principio VII) | Las dos tablas nuevas están en `dominio`; los mecanismos (`permisos_rol_accion`, `registro_actividad`) siguen en `public` sin cambio. |
| RLS | Las dos con `enable row level security` y **solo** una política `select` (organización, empresa accesible y `ventas` en lectura o edición). Sin política ni permiso de escritura directa. |
| `anon` | `revoke … from public, anon` y `grant execute … to authenticated` en cada RPC pública; ninguna función de `private` es ejecutable por `anon` ni por `authenticated`. |
| Funciones internas | `private.registrar_cobro_interno`, `private.saldo_comprobante`, `private.abrir_contrarreembolso`, `private.aplicar_conciliacion` y las de permiso por empresa son `security definer` con `search_path = ''` y **sin `grant`**. |
| Autorización en el servidor | Cada RPC revalida organización, empresa y acción **en el cuerpo**; el permiso es por empresa del dato, no por la empresa activa. |
| Datos bancarios | Los eventos llevan nombre de cuenta, importe y guía, **nunca** el CBU ni el CUIT completos. |
| Consola del navegador | Las tres pantallas loguean **solo el código** del error (`codigoDeError`/`codigoDeErrorCobro`), nunca el error entero: el detalle crudo de Postgres puede nombrar políticas, tablas o columnas, y una fila que falló un `check` puede traer los datos de la cuenta de cobro. |

**Hallazgo corregido en el cierre**: el detalle del comprobante y la tarjeta «Cobros» logueaban el error
crudo (`console.error(..., error)`), que puede incluir el detalle de la fila. Ahora loguean solo el
código (`codigoDeErrorCobro` de `apps/web/src/lib/ventas/cobros.ts`). El test está en
`apps/web/src/pages/ventas/comprobante.cobros.test.tsx` (falla sin la corrección).

## Reversión

Las doce migraciones son **aditivas** y documentan su reversión en el encabezado de cada una:

1. `20261215100000`–`20261215100400`: `drop trigger cobros_comprobante_validar`, `drop function` de
   `private.validar_cobro_comprobante`, `private.saldo_comprobante`, `private.registrar_cobro_interno`,
   `private.puede_registrar_cobro_en_empresa`, `public.registrar_cobro`, `public.saldo_comprobante`,
   `public.cobros_de_comprobante` y `public.puede_registrar_cobro`; `drop table
   dominio.cobros_comprobante`; `drop index dominio.formas_pago_id_organizacion_uq`; borrar la fila
   `registrar_cobro` de `public.permisos_rol_accion` y restaurar el `check` de acciones.
2. `20261216100000`–`20261216100300`: `drop function` de `public.conciliar_pago`,
   `public.revertir_conciliacion_pago`, `public.listar_pagos`, `public.resumen_pagos`,
   `public.cuentas_cobro_mas_usadas`, `public.puede_conciliar_pago`, `private.aplicar_conciliacion` y
   `private.puede_conciliar_pago_en_empresa`; borrar la fila `conciliar_pago` y restaurar el `check` de
   acciones.
3. `20261217100000`–`20261217100200`: `drop function` de `private.abrir_contrarreembolso`,
   `public.marcar_contrarreembolso_cobrado`, `public.listar_contrarreembolsos`,
   `public.resumen_contrarreembolsos` y `public.puede_cobrar_contrarreembolso`; `drop table
   dominio.contrarreembolsos`; borrar la fila `cobrar_contrarreembolso` y restaurar el `check` de
   acciones.

**Exportar antes de revertir**: las dos tablas son libros de dinero y no se recalculan. Revertir la
conciliación no borra datos: la aprobación vive en columnas del libro de cobros. Cada historia se
revierte con `git revert -m 1` de su merge; la épica entera, con el revert de su merge.

## Fuera de alcance

El botón **«Exportar»** de Pagos y de Transportes; la sub-pestaña **«Motos»** (mensajería propia);
**vencimiento por plazo de rendición** y **comisión del transporte**; el **cobro sobre presupuestos**;
la **importación de extractos bancarios**; el **reverso de un cobro mal cargado**; las pestañas
**Faltantes** y **Devoluciones (RMA)**; y los campos de despacho (Guía, Fecha de envío, Armó,
Controló, Entregó), que son de MSF-135.
