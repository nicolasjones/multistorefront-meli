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

`/ventas/transportes`, pestaña **Motos** (`?pestana=motos`): tarjeta «Motos sin rendir», tabla con filtro Tienda, «Registrar envío», «Editar», llave Rendido por fila y «Rendir seleccionados» con confirmación. Contrarreembolsos se conserva como pestaña por defecto.

## Errores

`42501` sin permiso; `P0002` el envío, la factura o la tienda no existe o no es de tu organización; `22023` dato inválido (mensajeros mezclados en una rendición, guía de más de 100 caracteres, importes fuera de rango); `23505` el comprobante ya tiene envío; `40001` otra persona lo modificó; `55000` el envío ya está rendido.

## Pruebas

pgTAP: `ventas_motos_registro.test.sql`, `ventas_motos_rendicion.test.sql` y `ventas_motos_rls_por_empresa.test.sql` (lectura directa por tienda y `puedo_registrar_envios_moto`). Vitest: `TransportesMotos.test.tsx`, `EnvioMotoDialog.test.tsx`, `RendicionMotosDialog.test.tsx` (con axe a 320/768/1440 px).

## Revisión de seguridad integral

Tabla con RLS por organización y por tienda (`ventas` en lectura o edición en la tienda del envío), sin escritura directa ni `delete`; `anon` sin privilegios; RPC `security definer` con `search_path` vacío, `revoke` a `public`/`anon`; actor y organización salen de la sesión; ver la revisión técnica + seguridad del PR.
