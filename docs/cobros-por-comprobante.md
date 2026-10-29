---
owner: producto
sources:
  - specs
---

# Ventas · Cobros por comprobante (F-VTA-12)

Cobros **parciales o totales** de una factura: cuánto se cobró, cuánto falta y en qué estado de
cobro está. Historia **F-VTA-12** (MSF-389) de la épica **MSF-195** · Ventas cobros y conciliación.
Spec: `specs/20261024-150000-ventas-cobros-y-conciliacion/` (US1, FR-001…FR-010, SC-001, SC-002).

Este documento describe **la base de datos** de la historia (la tabla del libro de cobros, el
saldo, la lectura, la función interna que registra el cobro y la RPC pública que la usa) y **la
pantalla** del detalle del comprobante (la tarjeta **Cobros**, el diálogo «Registrar cobro» y el
campo «Cuenta de cobro»). El cierre de la épica (`docs/ventas-cobros-y-conciliacion.md`, tarea de
cierre) cubre el modelo de negocio completo y los roles.

## Migraciones de la historia

Las cinco migraciones son **aditivas** (con reversión en el encabezado) y usan la banda de versiones
**`20270114100000`…`20270114100400`**, en este orden:

| Versión | Qué trae |
|---|---|
| `20270114100000_cobros_comprobante.sql` | La tabla `dominio.cobros_comprobante`, su disparador de integridad y su RLS. |
| `20270114100100_saldo_y_lectura_cobros.sql` | `private.saldo_comprobante`, `public.saldo_comprobante` y `public.cobros_de_comprobante`. |
| `20270114100200_registrar_cobro_interno.sql` | `private.registrar_cobro_interno`: el único camino para dejar un cobro en el libro. |
| `20270114100300_registrar_cobro.sql` | La acción `registrar_cobro` en la matriz de permisos y `public.registrar_cobro`. |
| `20270114100400_puede_registrar_cobro_lectura.sql` | `public.puede_registrar_cobro`: la lectura del permiso para la pantalla. |

La banda es **nueva y mayor** a propósito: con los números que nombra `tasks.md` (`20261209100…`)
las migraciones quedaban por debajo de la cola ya aplicada en dokploy (`20270112150000`), y
`supabase db push` las rechaza («found local migration files to be inserted before the last
migration on remote database»); el guard `scripts/verificar-migraciones.mjs` lo marca como «versión
REUSADA» y `pnpm docs:check` falla. Por eso se renumeró a `20270114100000`…`20270114100400`.
F-VTA-13 usa `20270114110000`…`20270114110300`, F-VTA-14 `20270114120000`…`20270114120200` y el
cierre reconcilia la matriz en `20270114130000`.

## La tabla `dominio.cobros_comprobante`

Es un **libro de dinero**: un cobro no se borra ni se edita (lo único que se mueve después es la
aprobación de la conciliación). Por eso no hay política ni permiso de `insert`, `update` o
`delete`: escribe la RPC `security definer` de cobros.

| Columna | Qué es |
|---|---|
| `organizacion_id`, `empresa_id` | Dueña y tienda del cobro. La empresa es siempre la del comprobante. |
| `comprobante_id` | La factura cobrada (FK compuesta: no puede ser de otra organización). |
| `importe` | `numeric(14,2)` **mayor a 0**: cero o negativo es un error de carga, no un cobro. |
| `forma_pago_id` | Forma de pago de la **misma empresa** (FK compuesta). |
| `cuenta_cobro_id` | Cuenta de cobro: **nula** si la forma de pago no exige cuenta (efectivo). Una cuenta marcada «No usar» (`activa = false`) no recibe cobros nuevos, pero conserva los que ya tiene. |
| `origen` | `manual` (lo registra una persona) o `contrarreembolso` (lo rinde un transporte, F-VTA-14). |
| `registrado_por`, `registrado_por_nombre`, `registrado_en` | Quién y cuándo. El nombre es una **foto**: el historial sobrevive a la baja de la cuenta (mismo criterio que `dominio.movimientos_stock.actor_id`). |
| `aprobado_por`, `aprobado_por_nombre`, `aprobado_en` | Conciliación contra el extracto (F-VTA-13). Nulos hasta que se aprueba; van enteros o no van. |
| `actualizado_en` | Bloqueo optimista de la conciliación. |

**RLS**: lectura por organización, empresa accesible (`private.empresas_accesibles()`) y sección
`ventas` en lectura o edición. `anon` sin privilegios. La escritura directa está bloqueada por
doble: no hay política de escritura y no hay permiso de escritura.

**Integridad**: un disparador (`private.validar_cobro_comprobante`) comprueba en el `insert` que el
comprobante, la forma de pago y la cuenta de cobro sean los de la empresa del cobro. Solo en el
`insert`: después el cobro es inmutable y la conciliación solo mueve `aprobado_*` (si la cuenta se
desactiva más tarde, el cobro ya registrado se conserva).

## Saldo y lectura

- `public.saldo_comprobante(p_id uuid) → (total, cobrado, saldo)`: total con IVA, suma de los
  cobros y lo que falta. `security invoker` (manda la RLS de `dominio`) y además filtra por
  organización y empresa accesible: otra organización recibe `P0002` («El comprobante no existe»),
  nunca datos ajenos. Sin `ventas` devuelve `42501`.
- `public.cobros_de_comprobante(p_comprobante_id uuid)`: la lista de cobros de la factura (fecha,
  forma de pago con su **nombre y su tipo**, cuenta de cobro con su **nombre, banco y titular**,
  importe, origen, si está conciliado, quién aprobó y quién registró). Mismas reglas de aislamiento
  que el saldo.
  - El **tipo** de la forma de pago (`efectivo`, `transferencia`, `contrarreembolso`, `tarjeta`,
    `otro`) y el **banco/titular** de la cuenta se devuelven además del nombre: la pantalla
    distingue el contrarreembolso por tipo (el nombre lo edita la persona y no es un dato
    estable) y muestra «Banco · Titular» como el prototipo.
- `private.saldo_comprobante(p_id uuid)`: la cuenta interna. **Volátil** a propósito: la usa
  `private.registrar_cobro_interno` justo después de insertar el cobro y tiene que ver esa fila
  (una función `stable` usaría el snapshot de la sentencia que la llamó y vería el saldo
  anterior). No la ejecuta `authenticated`.

## `private.registrar_cobro_interno`

Es el **único camino** para dejar un cobro en el libro:

```
private.registrar_cobro_interno(p_comprobante_id uuid, p_importe numeric, p_forma_pago_id uuid,
                                p_cuenta_cobro_id uuid, p_origen text, p_actor uuid) → uuid
```

1. El importe tiene que ser **mayor a 0**, con **dos decimales como máximo** y no puede superar
   el saldo. Los errores son en castellano y nombran el campo (`22023` dato inválido, `P0001` tope).
2. Toma el comprobante **con bloqueo de fila** (`for update`): dos cobros simultáneos se serializan
   y el segundo ve el saldo que dejó el primero; nunca se supera el saldo.
3. Solo admiten cobros las **facturas en estado operativo** (no borrador ni anulada) y solo quien
   tiene acceso a la empresa de la factura (`42501`).
4. Inserta el cobro y, en la misma transacción:
   - saldo 0 → la factura pasa a **Cobrado**;
   - saldo > 0 y forma de pago que genera deuda → pasa a **Deuda**;
   - si no, el estado **no cambia** (la factura queda con saldo).
5. Deja el evento `comprobante.cobro_registrado` en `public.registro_actividad` con el actor, la
   tienda, el importe y la forma. **Nunca** con datos bancarios completos (ni CBU ni CUIT).

`private.registrar_cobro_interno` no la ejecuta `authenticated` ni `anon`: solo la RPC pública de
cobros (y, más adelante, la de contrarreembolsos de F-VTA-14). Tampoco la ejecuta `service_role`
(la clave del servidor): es `security definer` sin guarda de rol y su permiso vive en la RPC
pública, igual que las `*_interno` de la cola de eventos (MSF-249). El pgTAP lo comprueba.

### Dependencia: MSF-177

El paso a **Cobrado** o **Deuda** lo hace `private.marcar_estado_cobro_comprobante(p_id uuid,
p_estado text)`, que llega con la épica **MSF-177** (PR #343, migración
`20261212100800_estado_cobro_comprobante.sql`). Esa función es el único punto de entrada: el estado
de cobro **nunca** se cambia a mano (`cambiar_estado_comprobante` rechaza Cobrado y Deuda).

Mientras MSF-177 no esté mergeada, el cobro se registra y el saldo se calcula igual, pero el paso a
Cobrado/Deuda no se puede ejecutar; las pruebas de pgTAP de esos dos escenarios quedan **omitidas**
(`skip`), no «verdes falsos». Cuando MSF-177 entre, se prueban solas.

## `public.registrar_cobro`

Es la **puerta de entrada** para registrar un cobro (migración `20270114100300_registrar_cobro.sql`):

```
public.registrar_cobro(p_comprobante_id uuid, p_importe numeric, p_forma_pago_id uuid,
                        p_cuenta_cobro_id uuid default null, p_actualizado_en timestamptz default null)
  → dominio.cobros_comprobante
```

`security definer`, con `revoke … from public, anon` y `grant execute … to authenticated`.

| Regla | Qué pasa |
|---|---|
| Documento | Solo **facturas confirmadas no anuladas**: un borrador, un presupuesto o una nota de crédito no admiten cobros (`55000` / `22023`). |
| Permiso | Exige la acción **`registrar_cobro`** de Ventas en la **empresa del comprobante** (`42501`). Se resuelve con el rol del usuario en esa empresa, no con la suma de sus roles: quien no puede cobrar en la tienda A no lo hereda por ser Operador en la B. |
| Forma de pago | Obligatoria y **de la misma empresa**; una forma desactivada no admite cobros (`22023`). |
| Cuenta de cobro | La **exige** la forma de pago cuando está configurada así; tiene que estar **activa** (una marcada «No usar» se rechaza) y **habilitada para la empresa** del comprobante (`22023`). |
| Importe | Mayor a 0, con dos decimales como máximo, nunca mayor al saldo pendiente (`22023` / `P0001`) y nunca mayor al máximo de la columna (`999999999999.99`, que es `numeric(14,2)`): así la base no tira un error técnico (22003) que la pantalla no sabe explicar. |

Cada error de validación lleva `hint` con el nombre del campo (`importe`, `forma_pago_id`,
`cuenta_cobro_id`): es lo que permite que la pantalla marque **el campo** y no muestre un error
general. El **tope** también lo lleva (`P0001` con `hint = 'importe'`), así que cuando el saldo
cambió entre que la pantalla lo leyó y que la persona envió el cobro, el error vuelve al campo
**Importe** con el mensaje de la base, que dice cuál es el saldo.

`p_actualizado_en` viene en el contrato pero **no se compara**: el cobro no usa bloqueo optimista
porque el saldo se recalcula con bloqueo de fila sobre el comprobante (dos cobros simultáneos se
serializan solos).

### El permiso: la acción `registrar_cobro`

La acción vive en la matriz de permisos por organización × rol × sección (`public.permisos_rol_accion`,
esquema `public` = plataforma). Se siembra **solo en Ventas**, para:

| Rol | ¿Puede registrar cobros? |
|---|---|
| Mostrador | Sí |
| Administración | Sí |
| Administrador | Sí |
| Operador | **No** (aunque Ventas esté en edición) |
| Depósito, Consulta, Miembro, Técnico | **No** |

Registrar un cobro es escribir: exige `ventas` en **edición** en esa empresa. La matriz se puede
editar por organización (`public.guardar_matriz_permisos`); el papel de la pantalla de Roles lo
documenta el cierre de la épica (`docs/permisos-por-rol.md`).

### En el panel

`apps/web/src/lib/ventas/cobros.ts` envuelve las RPC (`registrarCobro`, `cobrosDeComprobante`,
`saldoComprobante`, `puedeRegistrarCobro`), trae los tipos y valida el importe en el formulario
(mayor a cero, hasta dos decimales y nunca mayor al saldo). La autoridad sigue siendo la base:
la pantalla solo ofrece y muestra.

El `hint` de la base se respeta en los dos códigos con los que la RPC marca un campo: la
validación (`22023`) y el tope (`P0001`). `errorDeCampoCobro` devuelve el campo y el mensaje de
la base; si el error llega sin `hint` (otra vía de escritura), la pantalla muestra el mensaje
general en castellano y nunca el texto crudo de la base.

### `public.puede_registrar_cobro(p_empresa_id uuid)`

Es la **lectura del permiso** que necesita el detalle del comprobante para mostrar u ocultar el
botón «Registrar cobro» (FR-007). Devuelve `true` si la persona puede registrar cobros en esa
empresa: la acción `registrar_cobro` de Ventas **y** `ventas` en edición, resueltas con el rol
del usuario **en esa empresa** (la misma regla que aplica `public.registrar_cobro`: quien no
puede cobrar en la tienda A no lo hereda por ser Operador en la B).

- `security definer` (llama a la función interna `private`, que `authenticated` no ejecuta),
  `revoke … from public, anon` y `grant execute … to authenticated`.
- Una empresa de otra organización, una tienda sin acceso o un rol sin la acción devuelven
  `false`: no se filtra información ajena, solo el permiso de quien pregunta.
- **No autoriza nada**: la autorización real sigue en `public.registrar_cobro`. Esta RPC solo
  evita que la pantalla ofrezca una acción que la base va a rechazar. Si la lectura falla, la
  pantalla se queda **sin permiso** (deny-by-default).

## En el detalle del comprobante (FR-007, FR-008, FR-009)

La pantalla es `/ventas/comprobantes/:id` (`apps/web/src/pages/ventas/comprobante.tsx`), con la
tarjeta en `apps/web/src/components/ventas/CobrosComprobante.tsx`.

### Tarjeta «Cobros»

- Totales **Cobrado** y **Saldo**, y la lista de cobros (fecha, forma de pago, cuenta de cobro,
  importe y quién lo registró).
- Estados del kit: carga (esqueletos), vacío («Todavía no hay cobros») y error con «Reintentar».
  Con la lectura en error **no** se ofrece «Registrar cobro»: el saldo es desconocido, así que el
  diálogo abriría con «Saldo pendiente: $ 0» y no dejaría cobrar nada (deny-by-default).
- Botón **«Registrar cobro»**: solo con la acción `registrar_cobro` en la empresa de la factura
  y solo si el comprobante es una **factura en estado operativo** (un presupuesto, un borrador o
  una factura anulada no lo muestran: la base los rechaza y la pantalla no ofrece una acción que
  va a fallar). Sin la acción no aparece, y queda deshabilitado cuando la factura ya no tiene saldo.

### Diálogo «Registrar cobro»

- **Forma de pago**: las formas **activas** de la tienda (`dominio.formas_pago`).
- **Cuenta de cobro**: las cuentas **activas** de la tienda (`listar_cuentas_cobro` con
  `estado = 'activas'`). Las marcadas «No usar» no se ofrecen: conservan su historial pero no
  aceptan cobros nuevos. La etiqueta es «Banco · Titular», como el prototipo.
  - La cuenta es **obligatoria** cuando la forma de pago la exige (`exige_cuenta_cobro`) y
    opcional si no.
- **Importe**: arranca con el **saldo pendiente** como valor sugerido.
- Los errores se marcan **en el campo**: la base manda el `hint` con el nombre del campo
  (`importe`, `forma_pago_id`, `cuenta_cobro_id`) y la pantalla lo muestra ahí.

### Campo «Cuenta de cobro»

En la tarjeta de datos del comprobante, como el prototipo:

- el valor es la cuenta del **último cobro con cuenta** («Banco · Titular»);
- el chip dice **«Sin conciliar»** o **«Conciliado»** según la aprobación de ese cobro;
- el enlace **«Ir a Pagos →»** lleva a `/ventas/pagos` (la pantalla de conciliación de pagos,
  F-VTA-13, llega con su propia fase de la épica);
- la ayuda es «Titular y CUIT se ven al elegir la cuenta. Se concilia en Pagos.»;
- y si la forma de pago del último cobro es **Contrarreembolso**, aparece el texto «El
  transporte cobra al entregar. Queda en Transportes y contrarreembolsos hasta que lo rindan.».

### Cambio de tienda (Principio VIII, FR-009)

Al cambiar la **empresa activa** de la barra superior, el detalle **recarga los cobros y el
saldo** y **cierra con aviso** el diálogo «Registrar cobro» que estuviera abierto: nunca queda
un cobro de una tienda cargado bajo la otra. Si además la tienda nueva no es la del
comprobante, la pantalla se cierra con aviso (regla ya existente de la ficha).

### Pruebas de la pantalla (SC-002)

`apps/web/src/pages/ventas/comprobante.cobros.test.tsx` (`pnpm test:web`) cubre:

- **la tarjeta**: lo cobrado, el saldo, el detalle de cada cobro, el estado vacío y el error con
  «Reintentar». Con la lectura en error **no** se ofrece «Registrar cobro» (deny-by-default: el
  saldo es desconocido y el diálogo no dejaría cobrar nada);
- **el diálogo**: la apertura con el saldo como importe sugerido, la forma de pago que exige
  cuenta de cobro, el importe mayor al saldo, el registro con aviso y la recarga de la lista;
- **los estados del diálogo**: si el catálogo de formas de pago de la tienda no se puede leer, el
  diálogo lo dice y no manda un cobro a ciegas; si la tienda no tiene formas de pago, aparece el
  aviso y el botón queda deshabilitado; si las cuentas de cobro no se pueden listar, el error queda
  en el campo; al reabrirlo no quedan los errores del intento anterior;
- **los errores**: los de la validación de pantalla y los de la base —el que trae `hint` se
  muestra en el campo que nombra (también el tope, que llega como `P0001` con `hint`) y los demás
  en castellano, sin el texto técnico;
- **la concurrencia**: dos envíos del mismo cobro no dejan dos cobros (mientras el primero está en
  vuelo, el botón queda en «Registrando…» y deshabilitado);
- **el campo «Cuenta de cobro»**: el valor «Banco · Titular», el chip «Sin conciliar»/
  «Conciliado», el enlace «Ir a Pagos →» y el texto del contrarreembolso;
- **solo lectura por rol**: sin la acción `registrar_cobro` el botón no aparece, pero los cobros,
  los totales y el campo se siguen leyendo;
- **documentos sin cobros**: un presupuesto, un borrador y una factura anulada no ofrecen
  «Registrar cobro» (escenario 5 de US1);
- **el cambio de empresa**: recarga los cobros y el saldo, cierra con aviso el diálogo abierto y
  la pantalla sigue operable para registrar el siguiente cobro;
- **el teclado**: el botón es nativo y toma el foco, el foco entra al diálogo, Escape lo cierra y
  devuelve el foco al botón que lo abrió, el botón «Cerrar» cierra sin registrar y, cuando la
  validación falla, el foco va al campo que falta;
- **el lector de pantalla**: la lista es una tabla con encabezados, los totales son un grupo con
  nombre, el diálogo y sus campos tienen nombre accesible, los errores quedan asociados al campo
  (`aria-invalid` y `aria-describedby`) y la tarjeta y el diálogo no tienen violaciones de axe.

## Reversión

Las cinco migraciones son **aditivas** y llevan su reversión en el encabezado:

```
drop trigger cobros_comprobante_validar on dominio.cobros_comprobante;
drop function private.validar_cobro_comprobante();
drop table dominio.cobros_comprobante;
drop index dominio.formas_pago_id_organizacion_uq;
drop function public.cobros_de_comprobante(uuid);
drop function public.saldo_comprobante(uuid);
drop function private.saldo_comprobante(uuid);
drop function private.registrar_cobro_interno(uuid, numeric, uuid, uuid, text, uuid);
drop function public.registrar_cobro(uuid, numeric, uuid, uuid, timestamptz);
drop function private.puede_registrar_cobro_en_empresa(uuid);
drop function public.puede_registrar_cobro(uuid);
delete from public.permisos_rol_accion where accion = 'registrar_cobro';
alter table public.permisos_rol_accion drop constraint permisos_rol_accion_accion_check;
alter table public.permisos_rol_accion add constraint permisos_rol_accion_accion_check
  check (accion in ('eliminar', 'exportar', 'ver_costos', 'editar_precio'));
```

Antes de revertir hay que **exportar los cobros ya cargados**: son datos de dinero y no se
recalculan.
