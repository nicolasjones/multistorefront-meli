# Ventas · Pagos (conciliación) (F-VTA-13)

Conciliación de los **pagos por transferencia o depósito**: ver los cobros que tienen cuenta de
cobro, aprobarlos contra el extracto del banco y deshacer esa aprobación. Historia **F-VTA-13**
(MSF-401) de la épica **MSF-195** · Ventas cobros y conciliación. Spec:
`specs/20261024-150000-ventas-cobros-y-conciliacion/` (US2, FR-020…FR-024, SC-003).

Este documento describe **la base de datos** de la historia: la acción de permiso, las dos RPC que
concilian y revierten, el listado paginado y las lecturas de las tarjetas. La **pantalla** Pagos
(`/ventas/pagos`) llega con las tareas T015–T020 de la misma historia; este documento no la
anticipa.

El libro de cobros del que se parte es el de **F-VTA-12** ([cobros-por-comprobante.md](cobros-por-comprobante.md)):
`dominio.cobros_comprobante` guarda el cobro y, en columnas nulables, la conciliación.

## Migraciones de la historia

Las tres migraciones son **aditivas** (con reversión en el encabezado) y usan la banda de versiones
**`20261216100000`…`20261216100200`**, en este orden:

| Versión | Qué trae |
|---|---|
| `20261216100000_conciliar_pago.sql` | La acción `conciliar_pago` en la matriz de permisos, `private.puede_conciliar_pago_en_empresa`, `public.conciliar_pago` y `public.revertir_conciliacion_pago`. |
| `20261216100100_listar_pagos.sql` | `public.listar_pagos`: el listado paginado de la pantalla. |
| `20261216100200_resumen_pagos.sql` | `public.resumen_pagos` y `public.cuentas_cobro_mas_usadas`: las tarjetas. |

La banda es **nueva y mayor** a propósito: con los números que nombra `tasks.md`
(`20261209200…`) las migraciones quedarían por debajo de la cola ya aplicada en dokploy
(`20261212120600`) y `supabase db push` las rechaza; el guard
`scripts/verificar-migraciones.mjs` las marca como «versión REUSADA» y `pnpm docs:check` falla.
Es el mismo criterio que aplicó F-VTA-12 con su banda `20261215100000`…`20261215100400`.
**F-VTA-14 tiene que usar otra banda.**

## Modelo: la conciliación no crea filas

Conciliar **no es cobrar** (spec, *Modelo y supuestos*): el cobro se registra al recibir el dinero
(F-VTA-12) y la conciliación confirma, contra el extracto del banco, que ese pago llegó a la cuenta.
Por eso esta historia **no crea ninguna tabla**: la aprobación vive en las columnas que
`dominio.cobros_comprobante` ya tenía preparedas para esto (`aprobado_por`, `aprobado_por_nombre`,
`aprobado_en`), y `actualizado_en` es la versión para el bloqueo optimista.

| Columna de `dominio.cobros_comprobante` | Qué mueve |
|---|---|
| `aprobado_por`, `aprobado_por_nombre`, `aprobado_en` | La conciliación: quién aprobó y cuándo. Nulos hasta que se aprueba; van enteros o no van (`cobros_comprobante_aprobacion_ck`). |
| `actualizado_en` | La versión que viaja en la pantalla y vuelve en la RPC: si el pago cambió, la conciliación se rechaza (`40001`). |

**Conciliar o revertir no toca el estado del comprobante ni el saldo** (FR-022). El estado
(`cobrado`/`deuda`) y el saldo los mueve `private.registrar_cobro_interno` (F-VTA-12) y nadie más.

## El permiso: la acción `conciliar_pago`

La acción vive en la matriz de permisos por organización × rol × sección
(`public.permisos_rol_accion`, esquema `public` = plataforma). Se siembra **solo en Ventas**, para:

| Rol | ¿Puede conciliar pagos? |
|---|---|
| Administración | Sí |
| Administrador | Sí |
| Mostrador | **No** (registra cobros, no los concilia) |
| Operador | **No** (aunque Ventas esté en edición) |
| Depósito, Consulta, Miembro, Técnico | **No** |

Conciliar es escribir: exige `ventas` en **edición** en la empresa del pago. El permiso se resuelve
con el rol del usuario **en esa empresa** (`private.puede_conciliar_pago_en_empresa`), no con la
suma de sus roles: quien no puede conciliar en la tienda A no lo hereda por ser Administración en la
B. Los roles son datos: se corrigen por organización (`public.guardar_matriz_permisos`) y el papel de
la pantalla de Roles lo documenta el cierre de la épica (`docs/permisos-por-rol.md`).

## `public.conciliar_pago` y `public.revertir_conciliacion_pago`

```
public.conciliar_pago(p_id uuid, p_actualizado_en timestamptz) → dominio.cobros_comprobante
public.revertir_conciliacion_pago(p_id uuid, p_actualizado_en timestamptz) → dominio.cobros_comprobante
```

`security definer`, con `revoke … from public, anon` y `grant execute … to authenticated`. La
organización y el actor salen de la sesión (`private.organizacion_id()`, `auth.uid()`), nunca de un
argumento.

| Regla | Qué pasa |
|---|---|
| Aislamiento | El pago se busca por id **y** por la organización de la sesión: el de otra organización devuelve `P0002` («El pago no existe»), nunca datos ajenos. |
| Permiso | Exige la acción **`conciliar_pago`** de Ventas en la **empresa del pago** (`42501`). |
| Solo con cuenta | Un cobro **sin cuenta de cobro** se rechaza (`22023`): el efectivo no va a ninguna cuenta y no hay nada que conciliar contra un banco (decisión 5 de la spec). |
| Idempotente | Conciliar un pago ya conciliado (o revertir uno ya revertido) **no hace nada**: no cambia el estado, no deja evento y no avanza `actualizado_en`. El estado repetido es un no-op, no un error. |
| Bloqueo optimista | `p_actualizado_en` es la versión que la pantalla leyó: si el pago cambió desde entonces, la RPC rechaza con `40001` sin pisar nada. |
| Concurrencia | El pago se toma con `for update`: dos conciliaciones simultáneas del mismo pago se serializan y solo la primera mueve la aprobación. |
| Estado y saldo | **No se tocan** el estado del comprobante ni el saldo (FR-022). |
| Auditoría | Cada cambio deja un evento en `public.registro_actividad`: `pago.conciliado` o `pago.conciliacion_revertida`, con actor, tienda, importe, cuenta (por su nombre) y factura. Nunca con datos bancarios completos (ni CBU ni CUIT). |

El **nombre de quien aprueba** es una foto (`aprobado_por_nombre`): el historial sobrevive a la
baja de la cuenta, mismo criterio que `dominio.movimientos_stock.actor_id`.

## `public.listar_pagos`

```
public.listar_pagos(p_empresa_id uuid default null, p_cuenta_cobro_id uuid default null,
                     p_solo_con_saldo boolean default false, p_pagina integer default 1,
                     p_tamano integer default 10)
  → (id, fecha, empresa_id, empresa, comprobante_id, numero, cliente, cuenta_cobro_id, cuenta_cobro,
     importe, aprobado_por, conciliado, saldo, actualizado_en, filas)
```

Es de **lectura**: `security invoker` (manda la RLS de `dominio.cobros_comprobante`: organización,
empresa accesible y `ventas` en lectura o edición) y `revoke … from public, anon` /
`grant execute … to authenticated`.

- **Solo pagos con cuenta de cobro**: lo que no tiene cuenta (efectivo) no se concilia y no
  aparece en Pagos.
- **Filtros**: por empresa (`p_empresa_id`), por cuenta de cobro (`p_cuenta_cobro_id`) y «Solo con
  saldo» (`p_solo_con_saldo`: el comprobante del pago todavía debe saldo).
- **Paginación en el servidor**: `p_pagina`/`p_tamano` con tope de 200 por página, y `filas` con el
  total del filtro actual (el «de N» de la paginación de la pantalla). Orden estable: fecha
  descendente y luego id.
- **Columnas**: Fecha, Tienda, Comprobante, Cliente, Cuenta de cobro, Importe, Aprobado por,
  Conciliado y **Saldo del comprobante** (lo que le queda al cliente, no el total de la factura).
- **Aislamiento**: una tienda ajena o una cuenta de otro grupo de permisos devuelve **cero filas**,
  no un error que delate su existencia.

### El nombre del cliente y la RLS de Clientes

`public.clientes` tiene su propia RLS por sección (Clientes). Un rol con Ventas pero **sin**
Clientes (Depósito) no ve esas filas: por eso el JOIN del cliente es `LEFT` y el nombre puede
venir vacío. **El pago no se filtra por esto** (la fila del pago es de Ventas): lo que el rol no
puede leer, no se muestra. La alternativa —leer el nombre con una función `security definer`— se
descarta a propósito: no amplía el alcance de los datos de Clientes desde la pantalla de pagos.

### Rendimiento

El listado cuenta y calcula el saldo **en el servidor** sobre el conjunto filtrado: la ventana
`count(*) over ()` exige recorrer el filtro completo (el «de N» es exacto) y el saldo del
comprobante se resuelve con un `LEFT JOIN LATERAL` que usa el índice
`cobros_comprobante_comprobante_idx` (`comprobante_id`, `registrado_en desc`). Con el tope de 200
filas por página, el plan no trae más de una página al navegador; el volumen de pagos de una
organización es el de sus facturas cobradas.

## `public.resumen_pagos` y `public.cuentas_cobro_mas_usadas`

Las dos son de lectura (`security invoker`, `revoke`/`grant` como las anteriores) y devuelven
`42501` sin acceso a Ventas.

```
public.resumen_pagos(p_empresa_id uuid default null)
  → (por_conciliar_importe, por_conciliar_cantidad, conciliado_importe, conciliado_cantidad, saldo_pendiente)
```

- **Por conciliar** y **Conciliado**: importe y cantidad de los pagos **con cuenta de cobro** de la
  empresa elegida (o de todas las accesibles).
- **Saldo pendiente de clientes**: la suma de los saldos de los comprobantes con **pago parcial**
  (los que todavía deben algo). Mira **todos** los cobros del comprobante, no solo los que tienen
  cuenta: lo que el cliente debe no depende de cómo pagó. Los comprobantes anulados o en borrador
  no cuentan: una factura anulada no le debe nada a nadie.

```
public.cuentas_cobro_mas_usadas(p_empresa_id uuid default null, p_limite integer default 8)
  → (id, nombre, banco, activa, usos, total_cuentas)
```

- Alimenta la tarjeta **Cuentas de cobro**: las cuentas de la organización (o de la empresa
  elegida) ordenadas por usos, con `total_cuentas` para el texto «N cargadas · se muestran las más
  usadas».
- Incluye las marcadas **«No usar»** (`activa = false`): no se ofrecen al cargar un comprobante,
  pero conservan su historial y la tarjeta las muestra con esa marca.
- `usos` cuenta los pagos con esa cuenta **de las empresas a las que la persona tiene acceso**: no
  se revela el uso de tiendas ajenas.

## Reversión

Las tres migraciones son **aditivas** y llevan su reversión en el encabezado:

```
drop function public.conciliar_pago(uuid, timestamptz);
drop function public.revertir_conciliacion_pago(uuid, timestamptz);
drop function private.puede_conciliar_pago_en_empresa(uuid);
drop function public.listar_pagos(uuid, uuid, boolean, integer, integer);
drop function public.resumen_pagos(uuid);
drop function public.cuentas_cobro_mas_usadas(uuid, integer);
delete from public.permisos_rol_accion where accion = 'conciliar_pago';
alter table public.permisos_rol_accion drop constraint permisos_rol_accion_accion_check;
alter table public.permisos_rol_accion add constraint permisos_rol_accion_accion_check
  check (accion in ('eliminar', 'exportar', 'ver_costos', 'editar_precio', 'registrar_cobro'));
```

y restaurar `private.matriz_acciones_iniciales()` y `private.puede_accion` de
`20261215100300_registrar_cobro.sql`.

Revertir la historia **no borra datos de dinero**: la conciliación vive en columnas del libro de
cobros y el libro no se borra. Si ya se conciliaron pagos, al revertir hay que decidir qué pasa con
`aprobado_*` (la alternativa es dejarlos como están y borrar solo la acción de permiso).

## Pruebas

La verificación de esta historia es el pgTAP
`supabase/tests/database/pagos_conciliacion.test.sql` (`pnpm test:db`, tarea T014 de la historia):
permisos por rol, conciliar/revertir idempotentes, bloqueo optimista, estado del comprobante intacto,
filtros, paginación, totales, cuentas, aislamiento y `anon` sin ejecución.

Las tres acciones sembradas cambian el conteo de filas de `public.permisos_rol_accion`, así que los
pgTAP que cuentan la matriz (`permisos_por_rol`, `editar_matriz_permisos` y `rol_tecnico`) ajustan
sus expectativas: `conciliar_pago` son **2 filas** por organización (Administración y Administrador,
en Ventas).
