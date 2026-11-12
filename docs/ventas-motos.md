# Ventas · Motos: registro y rendición de envíos (F-VTA-24 y F-VTA-25)

Épica MSF-145 (spec `specs/20261024-130000-ventas-motos/`). Los envíos con mensajería propia (motos) se registran con mensajero, guía, costo de envío y abono, y se rinden por fila o en lote.

## Modelo (esquema `dominio`, Principio VII)

- `dominio.envios_moto`: un envío por comprobante de venta (único por organización), con FK compuesta a `dominio.comprobantes_venta`. Columnas: `mensajero` (texto libre, obligatorio, normalizado: sin espacios sobrantes y comparado sin distinguir mayúsculas), `guia` (opcional), `costo_envio` y `abono` (`>= 0`), `enviado`, `rendido` y `rendido_en`.
- Solo se registran **facturas** (no presupuestos ni anuladas) cuya forma de envío es de tipo `moto` y de la misma empresa. El comprobante y su forma de envío no cambian.
- Sin migración de histórico: la tabla nace vacía.
- Migraciones: `20270222200100_envios_moto` (tabla y RLS), `20270222200200_envios_moto_rpc` (registro, edición, elegibles y listado), `20270222300100_rendir_envios_moto` (rendición y resumen), `20270222300200_exportacion_total_envios_moto` (la tabla entra en la exportación total de la organización) y `20270223100000_envios_moto_lectura_por_empresa` (RLS por tienda y `puedo_registrar_envios_moto`).
- Una factura que se **anula después** de registrar su envío: el envío no se toca y se puede editar o rendir como cualquier otro (decisión provisoria, a confirmar con el cliente).

## Permisos

- Lectura: sección `ventas` en `lectura` o `edicion` **en la tienda del envío** (RLS por organización y por tienda, con `private.nivel_ventas_en_empresa`; la migración `20270223100000` corrigió una política que usaba el nivel global y dejaba leer por la API los envíos de una tienda sin `ventas`).
- Registrar, editar y marcar «Enviado»: `ventas` en `edicion` **y** rol Operador o Administrador en la empresa.
- Rendir: solo Administrador. La tabla no tiene políticas de escritura ni `delete`: todo se escribe por RPC `security definer`; `anon` no tiene privilegios.
- `rendido` y `rendido_en` solo los escribe `rendir_envios_moto`.

## RPC (`public`, `security definer`, `search_path = ''`)

| RPC | Qué hace |
|---|---|
| `registrar_envio_moto` | Alta del envío de un comprobante elegible. |
| `actualizar_envio_moto` | Edición con bloqueo optimista (`40001`); un envío rendido es de solo lectura (`55000`). |
| `comprobantes_para_envio_moto` | Facturas elegibles sin envío (búsqueda por número o cliente, máx. 50). |
| `listar_envios_moto` | Listado más reciente primero, con `puede_editar` y `puede_rendir` por fila. |
| `rendir_envios_moto` | Lote todo o nada, idempotente, solo enviados y no rendidos, **un solo mensajero**, tope de 500 ids. Devuelve cantidad, mensajero, total del abono, total del costo y neto. |
| `resumen_motos_sin_rendir` | Monto (suma del abono) y cantidad de entregas sin rendir. |
| `puedo_registrar_envios_moto` | Solo lectura: `true` si la persona puede registrar en la tienda (o en alguna accesible si es nulo): la misma regla que `registrar_envio_moto`. La pantalla la usa para mostrar «Registrar envío» (Mostrador tiene `ventas` en edición y no puede registrar). |

Eventos de actividad: `envio_moto.registrado`, `envio_moto.actualizado`, `envio_moto.rendido`.

## Rendición

El **total de la rendición es la suma del abono**; el costo se muestra aparte y el neto (`abono − costo`) es informativo. **La reversión de una rendición está fuera de alcance.**

## Pantalla

`/ventas/transportes`, pestaña **Motos** (`?pestana=motos`): tarjeta «Motos sin rendir», tabla con filtro Tienda, «Registrar envío», «Editar», llave Rendido por fila y «Rendir seleccionados» con confirmación. Contrarreembolsos se conserva como pestaña por defecto (decisión confirmada por Nicolás el 2026-11-12).

## Límites conocidos

- **Paginación por desplazamiento:** el listado (`listar_envios_moto`) pide tandas de 25 con `offset`, ordenadas por fecha del comprobante y luego `created_at`. Si otra persona registra un envío entre dos tandas, puede repetirse o saltearse una fila. Con el volumen de una tienda (decenas de envíos por semana) es raro; si crece, se pasa a paginación por cursor.
- **Costo por fila:** `listar_envios_moto` y `resumen_motos_sin_rendir` resuelven el permiso de cada fila y cuentan el total del conjunto. No pesa con los volúmenes actuales; si hiciera falta, se resuelve la lista de tiendas permitidas una sola vez.
- **Factura anulada después:** ver arriba; decisión provisoria.

## Errores

`42501` sin permiso; `P0002` el envío, la factura o la tienda no existe o no es de tu organización; `22023` dato inválido (mensajeros mezclados en una rendición, guía de más de 100 caracteres, importes fuera de rango); `23505` el comprobante ya tiene envío; `40001` otra persona lo modificó; `55000` el envío ya está rendido.

## Pruebas

pgTAP: `ventas_motos_registro.test.sql`, `ventas_motos_rendicion.test.sql` y `ventas_motos_rls_por_empresa.test.sql` (lectura directa por tienda y `puedo_registrar_envios_moto`). Vitest: `TransportesMotos.test.tsx`, `EnvioMotoDialog.test.tsx`, `RendicionMotosDialog.test.tsx` (con axe a 320/768/1440 px).

## Cómo probarlo

**Prerrequisitos**: una organización con al menos dos tiendas; una forma de envío de tipo `moto` en cada tienda (Ventas › Configuración › Formas de envío); una factura (borrador o confirmada, no anulada) con esa forma de envío; una persona Operador o Administrador con `ventas` en edición y otra Administrador para rendir; una persona con `ventas` solo en lectura o Consulta.

**Pasos**:

1. Entrá a `/ventas/transportes?pestana=motos` como Operador. Tocá **Registrar envío**, elegí la factura, escribí el mensajero, costo de envío y «Abona al recibir», marcá **Enviado** y guardá.
2. Verificá la fila (Mensajero, costo, abono, chip «Enviado») y que la tarjeta «Motos sin rendir» suma el abono y «N entregas». Probá **Editar** y registrar de nuevo la misma factura (debe rechazarse).
3. Con el Administrador, activá la llave **Rendido** de la fila, o tildá varias del mismo mensajero y usá **Rendir seleccionados**; revisá el diálogo de totales (efectivo cobrado, costo, neto) y confirmá.
4. Con la persona de solo lectura, comprobá que no ve «Registrar envío», «Editar» ni la llave activa; con el Operador, que la llave Rendido está deshabilitada.
5. Cambiá la empresa activa en la barra superior: la tabla y la tarjeta se recargan y cualquier diálogo abierto se cierra con aviso.

**Resultado esperado**: el envío queda registrado y editable hasta rendirse; al rendir, la fila queda «Rendido» y de solo lectura, la tarjeta se recalcula, no se puede mezclar mensajeros en un lote y no hay forma de revertir la rendición (fuera de alcance). La tabla solo muestra las tiendas donde la persona tiene `ventas`.

**Cómo automatizarlo**: la base con `pnpm test:db` (pgTAP `ventas_motos_registro`, `ventas_motos_rendicion`, `ventas_motos_rls_por_empresa`); la pantalla con `pnpm --filter @platform/web test -- TransportesMotos EnvioMotoDialog RendicionMotosDialog` (Vitest con axe); y la vista a 320/768/1440 px con `pnpm --filter @platform/web pantallas:capturar`.

## Hallazgos de la revisión final

La revisión final del PR #825 encontró que la lectura directa de `dominio.envios_moto` por la API usaba el nivel global de `ventas` y dejaba ver los envíos de una tienda sin permiso. Se cerró con el commit e1d50985 y la migración `20270223100000_envios_moto_lectura_por_empresa.sql` (política por tienda con `private.nivel_ventas_en_empresa`, y `puedo_registrar_envios_moto` para la pantalla), con el pgTAP `ventas_motos_rls_por_empresa.test.sql`.

## Puntos a decidir

`abono` es un importe sin vínculo con el libro de cobros: una nota de crédito posterior no lo ajusta y `rendir_envios_moto` no registra un cobro, por lo que el comprobante puede quedar con saldo pendiente tras rendir. Ver `specs/20261024-130000-ventas-motos/notas.md`.

## Revisión de seguridad integral

Tabla con RLS por organización y por tienda (`ventas` en lectura o edición en la tienda del envío), sin escritura directa ni `delete`; `anon` sin privilegios; RPC `security definer` con `search_path` vacío, `revoke` a `public`/`anon`; actor y organización salen de la sesión; ver la revisión técnica + seguridad del PR.
