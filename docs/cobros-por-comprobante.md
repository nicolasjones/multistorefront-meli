# Ventas · Cobros por comprobante (F-VTA-12)

Cobros **parciales o totales** de una factura: cuánto se cobró, cuánto falta y en qué estado de
cobro está. Historia **F-VTA-12** (MSF-389) de la épica **MSF-195** · Ventas cobros y conciliación.
Spec: `specs/20261024-150000-ventas-cobros-y-conciliacion/` (US1, FR-001…FR-006, FR-010, SC-001).

Esta documento describe **la base de datos** de la historia: la tabla del libro de cobros, el
saldo, la lectura y la función interna que registra el cobro. La RPC pública
`registrar_cobro` (acción `registrar_cobro`, permisos por rol) y la tarjeta **Cobros** del detalle
del comprobante llegan en la sesión siguiente de la misma historia; el cierre de la épica
(`docs/ventas-cobros-y-conciliacion.md`) cubre el modelo de negocio completo y los roles.

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
  forma de pago, cuenta de cobro, importe, origen, si está conciliado, quién aprobó y quién
  registró). Mismas reglas de aislamiento que el saldo.
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
cobros (y, más adelante, la de contrarreembolsos de F-VTA-14).

### Dependencia: MSF-177

El paso a **Cobrado** o **Deuda** lo hace `private.marcar_estado_cobro_comprobante(p_id uuid,
p_estado text)`, que llega con la épica **MSF-177** (PR #343, migración
`20261212100800_estado_cobro_comprobante.sql`). Esa función es el único punto de entrada: el estado
de cobro **nunca** se cambia a mano (`cambiar_estado_comprobante` rechaza Cobrado y Deuda).

Mientras MSF-177 no esté mergeada, el cobro se registra y el saldo se calcula igual, pero el paso a
Cobrado/Deuda no se puede ejecutar; las pruebas de pgTAP de esos dos escenarios quedan **omitidas**
(`skip`), no «verdes falsos». Cuando MSF-177 entre, se prueban solas.

## Reversión

Las tres migraciones son **aditivas** y llevan su reversión en el encabezado:

```
drop trigger cobros_comprobante_validar on dominio.cobros_comprobante;
drop function private.validar_cobro_comprobante();
drop table dominio.cobros_comprobante;
drop index dominio.formas_pago_id_organizacion_uq;
drop function public.cobros_de_comprobante(uuid);
drop function public.saldo_comprobante(uuid);
drop function private.saldo_comprobante(uuid);
drop function private.registrar_cobro_interno(uuid, numeric, uuid, uuid, text, uuid);
```

Antes de revertir hay que **exportar los cobros ya cargados**: son datos de dinero y no se
recalculan.
