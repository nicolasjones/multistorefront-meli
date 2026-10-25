---
owner: producto
sources: [apps/web/src]
---
# Escalas de precio por cantidad y tipo de cliente (F-PRE-15 · MSF-220)

- **Esquema** (Principio VII): `dominio.producto_precios_escala` es un dato de negocio del producto → `dominio`. La RPC `public.guardar_precios_escala` es superficie de ejecución en `public` y no guarda datos; `private.precio_para` es una función de cálculo en `private`. Migraciones aditivas `20261022150000` y `20261022150100`; la reversión está en el encabezado de cada una.
- **Modelo**: x1 es el **precio de lista** del producto (no se duplica); la tabla guarda solo x5, x10 y x50, sin IVA y en la moneda del producto. `precio` nulo = «escala sin precio cargado»: como la tabla no tiene `DELETE`, así se quita una escala.
- **Permisos**: lectura con `productos` ≥ lectura, escritura con `productos` = edición (RLS por organización, FK compuesta `(producto_id, organizacion_id)`). `anon` sin privilegios; la RPC lleva `revoke … from public, anon` y `grant execute … to authenticated`.
- **`public.guardar_precios_escala(producto, x5, x10, x50)`**: guarda las tres escalas de una vez (nulo = sin precio), es idempotente y deja el evento `producto.precio_actualizado` («Cambió el precio de la escala x5 de …», sin importes) solo ante un cambio real. Errores: `42501` sin permiso, `P0002` producto inexistente o ajeno, `23514` precio negativo o con más de 2 decimales, `22003` importe demasiado grande.

## Contrato `private.precio_para(producto, empresa, escala default 'x1')`

Devuelve `escala_usada`, `neto`, `alicuota_id`, `alicuota_nombre`, `alicuota_porcentaje`, `alicuota_exenta` y `final`:

1. Parte del precio de la escala pedida; si esa escala no tiene precio cargado usa el de lista y `escala_usada = 'x1'`.
2. Lo convierte a pesos (`private.a_pesos`), aplica la regla de la empresa (`private.aplicar_regla_precio`) y el IVA (`private.aplicar_iva`): las mismas fórmulas únicas de F-PRE-01/07/12.
3. Una escala fuera de `x1/x5/x10/x50` da `22023` con mensaje claro, no un precio. Producto o empresa ajenos no devuelven filas; USD sin cotización devuelve `neto` nulo.
4. Como `precios_empresa_neto`, devuelve filas solo con la sección `empresas` (sin ver la regla el cálculo parecería «Igual al central»).

## Contrato con Clientes y proveedores: `tipos_cliente.escala_precio`

`precio_para` **no consulta `tipos_cliente`**: quien necesita el precio (Ventas, cuenta web) lee `tipos_cliente.escala_precio` (texto, p. ej. `x5` para «Mayorista») y se lo pasa. La pantalla Tipos de cliente es de Clientes y proveedores. Mientras la tabla no exista, el contrato se prueba con un tipo simulado (`supabase/tests/database/precios_escala.test.sql`) y `escalaDeTipoCliente` (`apps/web/src/lib/escalas.ts`) hace el mapeo: sin escala = `x1`, valor inválido = error.

La selección automática de escala por **cantidad** de la línea queda abierta (spec, decisión 2): la define Ventas (F-VTA-06). Por eso el texto del prototipo «Mayorista usa la escala según la cantidad» se adapta a «cada tipo de cliente usa su escala».

## Formulario de producto

- Bloque **«Precios por escala · sin IVA»** (`components/precios/EscalasPrecio.tsx`) con las cuatro escalas (`x1 · 1 a 4 u.`, `x5 · 5 a 9 u.`, `x10 · 10 a 49 u.`, `x50 · 50 u. o más`), las etiquetas «todos»/«mayoristas» del prototipo y el margen de cada escala. x1 es el precio de lista y se edita en «Precio y costo».
- El margen se oculta sin la sección `rentabilidad`; sin cotización (USD) no se inventa. Es una vista previa: la autoridad es la base.
- Se guarda después de crear/actualizar el producto con `guardarPreciosEscala`; si falla, el producto queda guardado y se ofrece «Reintentar precios por escala» (mientras tanto rige el precio de lista).
- `docs/schema.html` no se regeneró: necesita el Supabase local corriendo y expone `public`; la tabla de `dominio` queda documentada en la migración `20261022150000`. La guía general `docs/precios.md` la escribe la tarea de cierre (T041).

## Precios de la tienda según el tipo de cliente (F-CLI-07, MSF-432)

La tienda pública muestra a un cliente con **cuenta web activa** los precios de su tipo (spec `20261024-051500-cuenta-web-del-cliente`, US3):

- **Base**: `private.precio_final_publico_escala(producto, empresa, escala)` (migración `20261211110000`) aplica las fórmulas únicas de Precios (`a_pesos` → `aplicar_regla_precio` → `aplicar_iva` según el interruptor de la empresa; escala sin precio ⇒ x1) y no tiene `grant` a `anon`/`authenticated`. Reversión: `drop function private.precio_final_publico_escala(uuid, uuid, text)`.
- **API**: `publico.precios_cliente_por_dominio(host, productos uuid[])` (migración `20261211110100`, solo `authenticated`, máx. 50 productos). Reutiliza el estado efectivo de `publico.acceso_cliente_por_dominio`: solo responde a una cuenta **activa y habilitada** en esa tienda; visitante, suspendida, sin cuenta, no habilitada, host desconocido o empresa desactivada reciben `null`. El tipo sale de la base (no se puede pedir la escala de otro tipo): **minorista → x1**, **mayorista → x1, x5, x10, x50** con su rango (1–4, 5–9, 10–49, 50 o más). Respuesta de lista blanca (`producto_id`, `escala`, `desde`, `hasta`, `final`): sin costos, margen, existencias ni `organizacion_id`. Reversión: `drop function publico.precios_cliente_por_dominio(text, uuid[])`.
- **Web**: `apps/web/src/lib/tiendaPreciosCliente.ts` + `hooks/usePreciosCliente.ts` hacen una llamada por carga de la ficha, sin caché de escala (el cambio de tipo o la suspensión rigen en la próxima carga); sin sesión no se llama a la base. La ficha (`ficha/PreciosCliente.tsx`) muestra «Tu precio» (minorista) o «Tus precios por cantidad» (mayorista). Las **tarjetas del catálogo no cambian**: siguen mostrando el precio x1 público.
- **Pruebas**: pgTAP `supabase/tests/database/precios_cliente.test.sql` (paridad con `precio_para`, lista blanca, estados), Vitest `tiendaPreciosCliente.test.ts`, `ficha/ficha-precios-cliente.test.tsx` (con axe) y `catalogo/TarjetaProducto.test.tsx`.
- **Decisión D3**: en el listado el mayorista sigue viendo x1; la tabla de escalas está solo en la ficha. Si se pide otra cosa, se ajusta en `TarjetaProducto.tsx` sin tocar la base.

> **Revisión de fuentes:** 2026-10-25 — se revisaron las fuentes de esta página y su contenido no cambia.
