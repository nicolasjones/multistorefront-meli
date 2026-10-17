# Catálogo de productos

Spec: `specs/20261017-120000-catalogo-alta-y-edicion/` (épica MSF-456). Este documento crece con cada
historia; hoy cubre **F-CAT-02 · Alta de producto** (MSF-458).

## Modelo (esquema `dominio`, Principio VII)

| Tabla | Contenido | RLS |
|---|---|---|
| `dominio.productos` | nombre, SKU, descripción, «Compatible con» (`text[]`), moneda (`USD`/`ARS`), precio de lista sin IVA, `activo` | `organizacion_id = private.organizacion_id()`; select con `lectura`/`edicion` en `productos`; insert/update con `edicion`; **sin DELETE** (se desactiva, no se borra) |
| `dominio.producto_costos` | costo, separado para restringirlo por fila | select con `lectura`/`edicion` en `rentabilidad`; insert/update con `edicion` en `rentabilidad`; sin DELETE |

- Ambas son entidades del negocio del producto → `dominio`. `rls_en_toda_tabla` las recorre.
- Grants por columna: el llamador no fija `creado_en`/`updated_at` ni cambia `organizacion_id`; `anon` no tiene
  privilegios. La FK compuesta `(producto_id, organizacion_id)` impide un costo apuntando a otra organización.
- La base normaliza al escribir (`private.normalizar_producto`): nombre recortado y no vacío, SKU vacío → nulo
  (el autogenerado y la unicidad llegan con F-CAT-03), «Compatible con» sin vacíos ni repetidos.

## Alta (`public.crear_producto`)

RPC `security invoker` (rige RLS): exige `edicion` en `productos`; el costo exige `edicion` en `rentabilidad`
(Operador: error `42501`, y 0 filas de `producto_costos` en lectura). Valida moneda, precio `> 0` con hasta
2 decimales y nombre. **No recibe stock** ni organización (sale de la sesión). `grant ... to authenticated`,
`revoke ... from public, anon`.

## Pantalla

- Menú **Catálogo → Productos** (`/productos`, ícono Inventory2, sección `productos`, audiencia organización).
  Hasta F-CAT-06 `/productos` redirige a `/productos/create`; el alta se descarga bajo demanda (`lazy`).
- Formulario: aviso «Faltan datos obligatorios», diálogo «Descartar cambios», «Precio en pesos: No disponible»
  (lo entrega Precios, MSF-114), ayuda del SKU «Se genera sola si lo dejás vacío», costo solo con edición en
  Rentabilidad. Sin stock inicial.
- Diferencias con el prototipo: sin variantes, relacionados, escalas, proveedor, código de barras, video ni
  categoría (la agrega MSF-160); tras guardar se confirma en la misma pantalla porque la ficha llega con F-CAT-04.

## Actividad

`producto.creado` (trigger `registrar_actividad_producto`, misma transacción, solo con sesión). El detalle lleva
«Creó el producto <nombre> (SKU …)» y **nunca** costo ni precio.

## Reversión (migraciones `20261017120100` y `20261017120200`)

Aditivas. Se revierten en una migración posterior (no en el mismo PR): `drop trigger productos_registrar_actividad`,
`drop function private.registrar_actividad_producto()`, `drop function public.crear_producto(...)`,
`drop trigger productos_normalizar`, `drop function private.normalizar_producto()`,
`drop table dominio.producto_costos`, `drop table dominio.productos` (exportar los datos antes).
