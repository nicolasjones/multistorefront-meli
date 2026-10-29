---
owner: producto
sources:
  - specs
---

# Stock · Carga inicial y masiva por planilla (F-STK-07, MSF-380)

Spec: `specs/20261024-130000-stock-carga-exportacion-y-avisos/` (épica MSF-368). Esta guía cubre la pestaña
**Actualizar por Excel** (`/stock/excel`): cargar las cantidades contadas desde un `.xlsx`; cada diferencia
genera un movimiento de **ajuste** en el depósito elegido.

## Formato de la planilla

Hoja 1, con encabezados en la primera fila (la plantilla se baja desde la pantalla, `stock.xlsx`):

| Columna | Contenido |
|---|---|
| `sku` | Código del producto (obligatorio). Se recorta; un número se lee como texto. |
| `cantidad` | Unidades que debe tener el depósito (entero ≥ 0). |
| `motivo` | Opcional (hasta 500 caracteres). Queda como nota del movimiento. |

Se rechaza un archivo que no sea `.xlsx`, vacío, sin encabezados `sku`/`cantidad` o con más de 2.000 filas. Las
filas en blanco se ignoran sin correr la numeración (el número de fila es el de la hoja).

## Reglas (las valida el servidor, fila por fila)

«SKU vacío», «SKU repetido en la planilla», «SKU no existe», «Producto inactivo», «Cantidad inválida»,
«Motivo demasiado largo», «Por debajo de lo reservado» (las reservas «A pedido» no cambian: se ajusta el
stock físico), «Ya tuvo carga inicial» y «Sin cambios» (no genera movimiento).

**Carga inicial única:** un producto admite una sola carga inicial por planilla; después, el stock se corrige
con movimientos. Se aplican **solo las filas válidas**; las demás se informan como omitidas.

## Contrato y esquema (Principio VII)

- `dominio.cargas_iniciales_stock` (dominio de Stock): una fila por producto cargado, `unique (organizacion_id, producto_id)`, RLS de solo lectura con `stock` `lectura`/`edicion`; sin escritura directa para `authenticated`, `anon` sin privilegios.
- `public.validar_carga_stock(p_deposito, p_filas)`: vista previa, no escribe.
- `public.aplicar_carga_inicial_stock(p_deposito, p_filas, p_clave)`: todo o nada, idempotente por clave, un ajuste por diferencia con motivo de sistema «Carga inicial de stock». Un reintento con la **misma clave** devuelve lo que esa clave ya aplicó (sin número de fila ni omitidas), aunque la planilla sea otra.
- Ambas: `security definer`, `search_path = ''`, `revoke … from public, anon`, `grant … to authenticated`.

## Permisos

Pestaña y operación solo con `edicion` en Stock; con `lectura` no hay pestaña ni controles (la base responde `42501`). El stock es compartido por todas las tiendas: la pantalla no filtra por empresa activa (Principio VIII: no aplica).

## Reversión

Migraciones aditivas (`20261213100000`, `20261213100100`). Para volver atrás: revertir el merge del PR y, en una migración posterior, borrar las dos funciones y `dominio.cargas_iniciales_stock` (exportar antes los datos). Los ajustes ya aplicados son movimientos normales: se corrigen con un movimiento contrario, no se borran.
