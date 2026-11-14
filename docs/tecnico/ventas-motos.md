---
owner: tecnico
sources:
  - specs
  - supabase/migrations
  - apps/web/src
---

# Ventas en moto: registro y rendición de envíos (técnico, MSF-145)

**Épica:** MSF-145 · F-VTA-24 y F-VTA-25 · **Spec:** `specs/20261024-130000-ventas-motos/` · **Cierre:** PR #825, integrado en `dokploy` (en `main` llega con la próxima promoción; las citas salen de `dokploy`). Los envíos con mensajería propia (motos) se registran con mensajero, guía, costo de envío y abono, y se rinden por fila o en lote. Guía de producto: [Envíos en moto](../producto/ventas-motos.md).

## Modelo (esquema `dominio`, Principio VII)

- `dominio.envios_moto`: un envío por comprobante de venta (único por organización), con FK compuesta a `dominio.comprobantes_venta`. Columnas: `mensajero` (texto libre, obligatorio, normalizado: sin espacios sobrantes y comparado sin distinguir mayúsculas), `guia` (opcional), `costo_envio` y `abono` (`>= 0`), `enviado`, `rendido` y `rendido_en`.
- Solo se registran **facturas emitidas** (no presupuestos, ni borradores ni anuladas) cuya forma de envío es de tipo `moto` y de la misma empresa. El comprobante y su forma de envío no cambian.
- Sin migración de histórico: la tabla nace vacía.
- Migraciones: `20270222200100_envios_moto` (tabla y RLS), `20270222200200_envios_moto_rpc` (registro, edición, elegibles y listado), `20270222300100_rendir_envios_moto` (rendición y resumen), `20270222300200_exportacion_total_envios_moto` (la tabla entra en la exportación total de la organización) y `20270223100000_envios_moto_lectura_por_empresa` (RLS por tienda y `puedo_registrar_envios_moto`), y las decisiones del 2026-11-12: `20270228110000_envios_moto_factura_anulada_y_borrador` (anulada bloquea, borrador no elegible), `20270228110100_rendir_envios_moto_registra_cobro` (columna `cobro_id` y rendir cobra) y `20270228110200_notas_credito_ajustan_abono_envios_moto` (la nota de crédito baja el abono pendiente).
- Una factura que se **anula después** de registrar su envío (decisión del 2026-11-12): el envío no se borra ni se modifica pero queda **bloqueado**: editarlo falla con `55000` («La factura X fue anulada: el envío en moto ya no se puede editar»), rendirlo también (aborta todo el lote) y la pantalla lo muestra con la etiqueta «Factura anulada» y el motivo. No cuenta en la tarjeta «Motos sin rendir». Un envío ya rendido no cambia.
- **Borrador no elegible** (decisión del 2026-11-12): el selector no ofrece borradores y registrar sobre uno falla con `22023` («confirmala antes de registrar»). Los envíos que ya estaban cargados sobre un borrador siguen ahí; rendirlos con abono mayor que 0 exige confirmar la factura (`55000`).

## Permisos

- Lectura: sección `ventas` en `lectura` o `edicion` **en la tienda del envío** (RLS por organización y por tienda, con `private.nivel_ventas_en_empresa`; la migración `20270223100000` corrigió una política que usaba el nivel global y dejaba leer por la API los envíos de una tienda sin `ventas`).
- Registrar, editar y marcar «Enviado»: `ventas` en `edicion` **y** rol Operador o Administrador en la empresa.
- Rendir: solo Administrador. La tabla no tiene políticas de escritura ni `delete`: todo se escribe por RPC `security definer`; `anon` no tiene privilegios.
- `rendido` y `rendido_en` solo los escribe `rendir_envios_moto`.

## RPC (`public`, `security definer`, `search_path = ''`)

| RPC | Qué hace |
|---|---|
| `registrar_envio_moto` | Alta del envío de un comprobante elegible. |
| `actualizar_envio_moto` | Edición con bloqueo optimista (`40001`); un envío rendido o de una factura anulada es de solo lectura (`55000`). |
| `comprobantes_para_envio_moto` | Facturas emitidas elegibles sin envío (búsqueda por número o cliente, máx. 50). |
| `listar_envios_moto` | Listado más reciente primero, con `puede_editar`, `puede_rendir` y `bloqueado_motivo` por fila (factura anulada, o borrador con abono). |
| `rendir_envios_moto` | Lote todo o nada, idempotente, solo enviados y no rendidos, **un solo mensajero**, tope de 500 ids. **Registra el cobro en el libro** (ver Rendición) y rechaza las facturas anuladas. Devuelve cantidad, mensajero, total del abono, total del costo, neto, `total_cobrado` y `sin_cobro`. |
| `resumen_motos_sin_rendir` | Monto (suma del abono) y cantidad de entregas sin rendir. |
| `puedo_registrar_envios_moto` | Solo lectura: `true` si la persona puede registrar en la tienda (o en alguna accesible si es nulo): la misma regla que `registrar_envio_moto`. La pantalla la usa para mostrar «Registrar envío» (Mostrador tiene `ventas` en edición y no puede registrar). |

Eventos de actividad: `envio_moto.registrado`, `envio_moto.actualizado`, `envio_moto.rendido` (con lo cobrado en el libro) y `envio_moto.abono_ajustado` (una nota de crédito bajó el abono; actor nulo).

## Rendición

El **total de la rendición es la suma del abono**; el costo se muestra aparte y el neto (`abono − costo`) es informativo. **La reversión de una rendición está fuera de alcance** (ver el contra-asiento más abajo).

**Rendir cobra (decisión del 2026-11-12).** Por cada envío que se rinde, en la misma transacción, se registra un cobro en el libro de cobros de su factura (`dominio.cobros_comprobante`) por **`least(abono, saldo neto)`**, llamando al mecanismo único de cobros (`private.registrar_cobro_interno`, ver [Ventas · cobros y conciliación](ventas-cobros-y-conciliacion.md)): él valida el tope, pasa la factura a Cobrado (o Deuda) y deja el evento `comprobante.cobro_registrado`.

- Tope: el saldo neto (`private.saldo_comprobante`: total − cobros − notas de crédito). Si el abono lo supera (o ya había un cobro previo) se cobra lo que falta; con abono 0 o saldo 0 el envío se rinde sin cobro. `total_cobrado` (lo registrado) puede ser menor que `total_abono` (el efectivo rendido).
- Origen `contrarreembolso` (es el cobro que hace y rinde la mensajería; el `check` del libro no cambia), sin cuenta de cobro. Forma de pago: la de la factura; si no tiene, la forma activa «Contrarreembolso» de la tienda; sin ninguna de las dos, la rendición falla (`22023`) y no rinde ninguno.
- El envío guarda el `cobro_id` (trazabilidad). La rendición es todo o nada: si un cobro falla no se rinde ninguno.
- Una factura que **ya está en estado Cobrado** (p. ej. pagada en mostrador, antes del libro de cobros) no recibe cobro: el envío se rinde, cuenta en `sin_cobro` y el estado queda intacto (con una forma que genera deuda, el cobro la haría retroceder a Deuda).
- Un envío sobre una **factura en borrador con abono** aparece con `puede_rendir = false` y el motivo «Confirmá la factura antes de rendir» (sigue editable; con abono 0 sigue rendible); rendirlo igual falla con `55000`.
- Si la forma de pago del cobro genera deuda (la de la factura o la «Contrarreembolso» de la tienda) y queda saldo, la factura puede pasar a **Deuda**, igual que con un contrarreembolso.
- Un superadmin con organización activa pero sin membresía no puede rendir con abono: se le avisa antes de empezar con un `42501` claro («tenés que ser miembro de la organización…»). Las facturas en borrador con abono se listan todas en el `55000`.
- **Revertir una rendición exige un contra-asiento**: el libro de cobros no se borra ni se edita, así que deshacer una rendición tendría que registrar un asiento de signo contrario (hoy no existe ese camino) y el estado de la factura no retrocede solo; `cobro_id` es la única traza de qué envío originó cada cobro.
- **Nota de crédito posterior**: el disparador de notas (`20270228110200`, mismo patrón que los contrarreembolsos de `20270227150000`) baja el `abono` de los envíos **sin rendir** hasta el saldo neto (puede quedar en 0), con `skip locked` y el evento `envio_moto.abono_ajustado`. No toca los envíos ya rendidos. Si se anula la nota el abono no vuelve a subir.
- La pantalla avisa «cobro registrado» con el monto y el diálogo de lote lo explica.

## Pantalla

`/ventas/transportes`, pestaña **Motos** (`?pestana=motos`): tarjeta «Motos sin rendir», tabla con filtro Tienda, «Registrar envío», «Editar», llave Rendido por fila y «Rendir seleccionados» con confirmación. Contrarreembolsos se conserva como pestaña por defecto (decisión confirmada por Nicolás el 2026-11-12).

## Límites conocidos

- **Paginación por desplazamiento:** el listado (`listar_envios_moto`) pide tandas de 25 con `offset`, ordenadas por fecha del comprobante y luego `created_at`. Si otra persona registra un envío entre dos tandas, puede repetirse o saltearse una fila. Con el volumen de una tienda (decenas de envíos por semana) es raro; si crece, se pasa a paginación por cursor.
- **Costo por fila:** `listar_envios_moto` y `resumen_motos_sin_rendir` resuelven el permiso de cada fila y cuentan el total del conjunto. No pesa con los volúmenes actuales; si hiciera falta, se resuelve la lista de tiendas permitidas una sola vez.
- **Anulación de una nota de crédito:** el abono ajustado no se restituye.

## Errores

`42501` sin permiso, **también** cuando el envío, la factura o la tienda no existe o no es de tu organización (registrar, editar y rendir comprueban el permiso antes de cualquier bloqueo y devuelven el mismo error exista o no, para no revelar la existencia entre tiendas ni organizaciones); `P0002` ya no se devuelve en esas RPC; `22023` dato inválido (mensajeros mezclados en una rendición, guía de más de 100 caracteres, importes fuera de rango, borrador en el registro, sin forma de pago para el cobro); `23505` el comprobante ya tiene envío; `40001` otra persona lo modificó; `55000` el envío ya está rendido, su factura fue anulada o (al rendir con abono) está en borrador.

## Pruebas

pgTAP: `ventas_motos_registro.test.sql`, `ventas_motos_rendicion.test.sql`, `ventas_motos_rls_por_empresa.test.sql` (lectura directa por tienda y `puedo_registrar_envios_moto`) y `ventas_motos_decisiones.test.sql` (anulada bloquea, borrador no elegible, rendir cobra con tope neto, la nota ajusta el abono pendiente y no el rendido, aislamiento y permisos). Vitest: `TransportesMotos.test.tsx`, `EnvioMotoDialog.test.tsx`, `RendicionMotosDialog.test.tsx` (con axe a 320/768/1440 px).

## Cómo probarlo

**Prerrequisitos**: una organización con al menos dos tiendas; una forma de envío de tipo `moto` en cada tienda (Ventas › Configuración › Formas de envío); una factura emitida (confirmada; no borrador ni anulada) con esa forma de envío y una forma de pago «Contrarreembolso» activa en la tienda (o la factura con forma de pago); una persona Operador o Administrador con `ventas` en edición y otra Administrador para rendir; una persona con `ventas` solo en lectura o Consulta.

**Pasos**:

1. Entrá a `/ventas/transportes?pestana=motos` como Operador. Tocá **Registrar envío**, elegí la factura, escribí el mensajero, costo de envío y «Abona al recibir», marcá **Enviado** y guardá.
2. Verificá la fila (Mensajero, costo, abono, chip «Enviado») y que la tarjeta «Motos sin rendir» suma el abono y «N entregas». Probá **Editar** y registrar de nuevo la misma factura (debe rechazarse).
3. Con el Administrador, activá la llave **Rendido** de la fila, o tildá varias del mismo mensajero y usá **Rendir seleccionados**; revisá el diálogo de totales (efectivo cobrado, costo, neto) y confirmá. Abrí la factura: tiene un cobro por el abono (hasta su saldo) y, si ya no debe nada, quedó Cobrada.
4. Con la persona de solo lectura, comprobá que no ve «Registrar envío», «Editar» ni la llave activa; con el Operador, que la llave Rendido está deshabilitada.
5. Cambiá la empresa activa en la barra superior: la tabla y la tarjeta se recargan y cualquier diálogo abierto se cierra con aviso.

**Resultado esperado**: el envío queda registrado y editable hasta rendirse; al rendir, la fila queda «Rendido» y de solo lectura, la tarjeta se recalcula, no se puede mezclar mensajeros en un lote y no hay forma de revertir la rendición (fuera de alcance). La tabla solo muestra las tiendas donde la persona tiene `ventas`.

**Cómo automatizarlo**: la base con `pnpm test:db` (pgTAP `ventas_motos_registro`, `ventas_motos_rendicion`, `ventas_motos_rls_por_empresa` y `ventas_motos_decisiones`); la pantalla con `pnpm --filter @platform/web test -- TransportesMotos EnvioMotoDialog RendicionMotosDialog` (Vitest con axe); y la vista a 320/768/1440 px con `pnpm --filter @platform/web pantallas:capturar`.

## Hallazgo de la revisión final

La lectura directa de `dominio.envios_moto` por la API usaba el nivel global de `ventas` y dejaba ver los envíos de una tienda sin permiso. Se cerró con `20270223100000_envios_moto_lectura_por_empresa.sql` (política por tienda con `private.nivel_ventas_en_empresa` y `puedo_registrar_envios_moto`).

## Ver también

[Ventas · cobros y conciliación](ventas-cobros-y-conciliacion.md) (libro de cobros y saldo neto) · [Catálogos de cobro y envío](ventas-catalogos.md) (formas de envío de tipo `moto`).
