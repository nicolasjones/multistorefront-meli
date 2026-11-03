---
owner: producto
sources: []
---

# Reportes de inventario: cuánto vale tu stock y qué reponer

## Para qué sirve

- **Productos y stock**: ver todos tus productos con la cantidad que hay, su costo y el valor de lo que tenés, y cuánto vale el inventario completo.
- **Reposición**: ver solo los productos sin stock o con stock bajo, con el proveedor y cuántas unidades faltan para volver al mínimo, para armar el pedido.
- **Descargar**: bajar cualquiera de las dos tablas a una planilla tal como la filtraste, para trabajarla en Excel.

## Quién puede verlo

| Rol | Qué puede hacer |
|---|---|
| Administrador, Operador, Depósito | Ver los dos reportes y descargarlos |
| Consulta, Mostrador, Administración | Ver los dos reportes y descargarlos; desde acá no se cambia ningún dato |

Los reportes son de solo lectura: no modifican el stock, los costos ni el mínimo de los productos.

Si tu rol no tiene permiso para ver **Stock**, el menú **Reportes** no aparece. Si entrás por un enlace guardado, ves «No tenés acceso a esta sección».

## Dónde lo encontrás

En el menú **Reportes**:

- **Productos y stock**
- **Reposición**

No hay un selector de empresa en estas pantallas: el inventario es uno solo para todo el negocio. Si en otras pantallas ves las pestañas de empresa activa, acá no cambian el resultado.

## Productos y stock

### Qué muestra

Una fila por producto activo, con estas columnas:

| Columna | Qué significa |
|---|---|
| **Producto** | Nombre del producto |
| **SKU** | Código del producto |
| **Categoría** | Categoría a la que pertenece, si tiene |
| **Cantidad** | Unidades que hay en el negocio |
| **Mínimo** | La cantidad que definiste como piso para ese producto |
| **Estado** | Sin stock, Bajo o Normal (ver abajo) |
| **Moneda del costo** | Pesos o dólares, según cómo cargaste el costo |
| **Costo** | El costo unitario en su moneda |
| **Costo en pesos** | El mismo costo convertido con la cotización del dólar vigente |
| **Valor en pesos** | La cantidad multiplicada por el costo en pesos |

Arriba de la tabla ves el **Valor total del inventario (en pesos)**: la suma del valor de todos los productos que estás viendo.

### Qué significa cada estado

| Estado | Cuándo aparece |
|---|---|
| **Sin stock** | La cantidad es cero |
| **Bajo** | Hay unidades, pero no más que el mínimo |
| **Normal** | Hay más unidades que el mínimo |

El estado se calcula con la cantidad total del producto y su mínimo. Si el mínimo es cero, cualquier cantidad mayor a cero es **Normal**.

### Filtrar y ordenar

- **Producto** y **SKU**: buscá por nombre o por código.
- **Categoría**: mostrá solo una categoría.
- **Estado**: mostrá solo Sin stock, solo Bajo o solo Normal.

La tabla viene ordenada por nombre de producto. Cuando aplicás un filtro, el **valor total** se recalcula y muestra solo la suma de las filas que quedaron visibles.

### Cómo se calcula el valor

- El costo puede estar cargado en pesos o en dólares.
- Si está en dólares, se convierte a pesos con la **cotización del dólar vigente**.
- El **valor en pesos** de cada fila es la cantidad por el costo en pesos.
- Si un producto no tiene costo cargado, o está en dólares y no hay cotización, aparece con su cantidad pero **sin costo en pesos ni valor**. Esa fila no suma al total: el sistema no inventa un valor.

## Reposición

### Qué muestra

Solo los productos activos que están **Sin stock** o **Bajo**. Los productos **Normales** no aparecen.

| Columna | Qué significa |
|---|---|
| **Producto** | Nombre del producto |
| **SKU** | Código del producto |
| **Categoría** | Categoría a la que pertenece, si tiene |
| **Proveedor** | Proveedor cargado en el producto, si tiene |
| **Código de proveedor** | El código con el que el proveedor identifica el producto, si tiene |
| **Cantidad** | Unidades que hay en el negocio |
| **Mínimo** | La cantidad que definiste como piso para ese producto |
| **Estado** | Sin stock o Bajo |
| **Faltante sugerido** | Cuántas unidades faltan para volver al mínimo |

El **faltante sugerido** es el mínimo menos la cantidad. Nunca es negativo: si un producto no tiene stock y su mínimo es 10, el faltante es 10; si tiene 4 y el mínimo es 10, el faltante es 6.

La lista viene ordenada por severidad: primero los **Sin stock** y después los **Bajo**. Dentro de cada grupo, primero los que tienen el faltante más grande.

### Filtrar

Podés filtrar por **Producto**, **SKU**, **Categoría**, **Estado** y **Proveedor**. Filtra por proveedor cuando quieras armar el pedido de un proveedor en particular.

### Armar el pedido a proveedores

1. Filtrá por el **Proveedor** al que le vas a comprar.
2. Revisá el **Faltante sugerido** de cada producto.
3. Descargá la tabla (ver abajo).
4. Usá la planilla para armar el pedido con tu proveedor.

Todavía no se puede crear la orden de compra ni enviar el pedido desde el sistema: el reporte te deja el listado y la planilla listos para que los uses donde ya trabajás tus pedidos.

## Descargar un reporte

1. Aplicá los filtros que quieras en el reporte.
2. En la tabla, abrí el menú **«...»** (arriba a la derecha) y elegí **Download** o **Descargar**.
3. Elegí **CSV**.

El archivo trae **solo las filas que estabas viendo**, con los filtros aplicados. Está preparado para abrirlo en Excel en español:

- las columnas quedan separadas;
- las tildes y la ñ se ven bien;
- los números decimales usan coma.

Quien no tiene acceso al reporte no ve el tablero ni puede descargar el archivo.

## Preguntas frecuentes

**¿El reporte muestra el stock de una tienda o de un depósito en particular?** No. Muestra la cantidad total del producto en el negocio. Para ver el detalle por depósito usá [Depósitos y reservas](stock-depositos-y-reservas.md).

**¿La cantidad descuenta lo reservado?** No: es la cantidad total del producto. Para ver lo disponible (sin lo reservado) usá [Stock actual](stock-movimientos.md).

**¿Puedo cambiar el mínimo desde el reporte?** No. El mínimo se cambia desde [Stock actual](stock-movimientos.md).

**¿Por qué un producto no aparece en Reposición?** Porque está **Normal** (tiene más unidades que el mínimo) o porque está inactivo.

**¿Por qué un producto aparece sin valor?** Porque no tiene costo cargado, o porque su costo está en dólares y no hay una cotización vigente.

**¿Puedo elegir «Todas mis empresas»?** No hace falta: el inventario es uno solo para todo el negocio y estos reportes no se separan por empresa.
