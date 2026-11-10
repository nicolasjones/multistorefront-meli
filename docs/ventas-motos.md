# Ventas · Motos: registro y rendición de envíos (F-VTA-24 y F-VTA-25)

Épica MSF-145 (spec `specs/20261024-130000-ventas-motos/`). Los envíos con mensajería propia (motos) se registran con mensajero, guía, costo de envío y abono, y se rinden por fila o en lote.

## Modelo (esquema `dominio`, Principio VII)

- `dominio.envios_moto`: un envío por comprobante de venta (único por organización), con FK compuesta a `dominio.comprobantes_venta`. Columnas: `mensajero` (texto libre, obligatorio, normalizado: sin espacios sobrantes y comparado sin distinguir mayúsculas), `guia` (opcional), `costo_envio` y `abono` (`>= 0`), `enviado`, `rendido` y `rendido_en`.
- Solo se registran **facturas** (no presupuestos ni anuladas) cuya forma de envío es de tipo `moto` y de la misma empresa. El comprobante y su forma de envío no cambian.
- Sin migración de histórico: la tabla nace vacía.

## Permisos

- Lectura: sección `ventas` en `lectura` o `edicion` en la empresa del envío (RLS por organización).
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

Errores: `42501` permiso, `22023` dato inválido, `23505` duplicado, `40001` conflicto, `55000` envío rendido.
Eventos de actividad: `envio_moto.registrado`, `envio_moto.actualizado`, `envio_moto.rendido`.

## Rendición

El **total de la rendición es la suma del abono**; el costo se muestra aparte y el neto (`abono − costo`) es informativo. **La reversión de una rendición está fuera de alcance.**

## Pantalla

`/ventas/transportes`, pestaña **Motos** (`?pestana=motos`): tarjeta «Motos sin rendir», tabla con filtro Tienda, «Registrar envío», «Editar», llave Rendido por fila y «Rendir seleccionados» con confirmación. Contrarreembolsos se conserva como pestaña por defecto.

## Pruebas

pgTAP: `ventas_motos_registro.test.sql` y `ventas_motos_rendicion.test.sql`. Vitest: `TransportesMotos.test.tsx`, `EnvioMotoDialog.test.tsx`, `RendicionMotosDialog.test.tsx` (con axe a 320/768/1440 px).

## Revisión de seguridad integral

Tabla con RLS por organización y sección `ventas`, sin escritura directa ni `delete`; `anon` sin privilegios; RPC `security definer` con `search_path` vacío, `revoke` a `public`/`anon`; actor y organización salen de la sesión; ver la revisión técnica + seguridad del PR.
