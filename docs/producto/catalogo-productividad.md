---
owner: producto
sources:
  - specs
---

# Catálogo: cambios masivos y duplicar productos

Esta página te explica cómo cambiar muchos productos de una vez y cómo crear un producto nuevo a partir de uno
parecido. Las dos cosas se hacen desde la lista de **Productos** (`/productos`).

## Para qué sirve

- **Corregir el catálogo más rápido:** en vez de abrir producto por producto, marcás varios y les cambiás la categoría,
  el estado o las empresas en un solo paso.
- **Cargar productos parecidos sin escribir todo de nuevo:** duplicás uno y ajustás lo que cambia.

## Quién puede usarlo

Solo las personas con permiso de **edición** en Productos (por ejemplo, Administrador y Operador). Si tu rol solo puede
consultar, no ves las casillas, la barra de selección ni el botón «Duplicar». Ver [Permisos por rol](../permisos-por-rol.md).

## Cambiar varios productos a la vez

1. Entrá a **Productos**.
2. Marcá la casilla de cada producto que quieras cambiar. Con la casilla del encabezado («Seleccionar todos») marcás todos
   los que ya se ven en la lista.
3. Arriba de la lista aparece una barra que dice **«N seleccionados»**, con cuatro botones: **Mover de categoría**,
   **Cambiar estado**, **Cambiar empresas** y **Quitar selección**.
4. Elegí la acción, completá el diálogo y confirmá. Al terminar, la selección se limpia y aparece un aviso.

!!! note "Hasta 100 productos por vez"
    Podés seleccionar como máximo 100 productos. Si necesitás más, repetí la operación en tandas.

### Mover de categoría

Se abre una lista con el árbol de categorías (categorías y subcategorías). Elegí la que querés: los productos se mueven
ahí y el aviso dice «N productos movidos a *categoría*».

### Cambiar estado

Elegí **Activar** o **Desactivar** y confirmá. Desactivar **no borra** nada: el producto conserva sus datos e imágenes y
podés volver a activarlo. Avisa «N productos activados» o «N productos desactivados».

### Cambiar empresas

Elegí las empresas en **«Agregar a»** y/o en **«Quitar de»** y confirmá. Cada producto queda con sus empresas actuales,
más las que agregás, menos las que quitás; las demás no cambian. Avisa «N productos actualizados».

### Qué tenés que saber

- **Todo o nada:** si algo falla (por ejemplo, un producto que ya no existe), no se cambia ningún producto y se te
  explica el motivo. La selección queda como estaba para que reintentes.
- **Sin cambios:** si los productos ya estaban como pedís, el aviso es «No hubo cambios».
- **Se registra en Actividad:** cada producto que cambió de verdad deja su registro. Ver [Actividad](../actividad.md).
- **Si cambiás la empresa activa** en la barra superior, o la búsqueda, el filtro o el orden de la lista, la selección se
  descarta; si había un diálogo abierto, se cierra con un aviso. Pedir más filas al bajar en la lista no descarta la
  selección.

## Duplicar un producto

1. En **Productos**, buscá el producto parecido y pulsá **Duplicar** en su fila.
2. Se abre el formulario de **Nuevo producto** ya cargado con los datos del original.
3. Ajustá lo que cambia y guardá. Hasta que guardes no se crea nada.

Qué se copia y qué no:

| Se copia | No se copia |
|---|---|
| Nombre, descripción, «Compatible con», moneda y precio de lista | SKU (queda vacío) |
| Categoría y empresas en las que se vende | Código de barras (queda vacío: no puede repetirse) |
| Costo y proveedor, solo si tenés acceso a Rentabilidad | Imágenes y stock |

- El producto nuevo nace **activo**, aunque el original estuviera inactivo.
- Si dejás el SKU vacío, el sistema le asigna uno automáticamente; si escribís uno que ya existe, o un código de barras
  repetido, te avisa sin perder lo que cargaste.
- Si el producto original ya no existe, o no es de tu organización, te avisamos y se abre el formulario vacío.

## Lo que todavía no se puede

- **Borrar productos:** no se borran, se desactivan (usá «Cambiar estado → Desactivar»).
- **Marcar destacado** y **enviar al newsletter** de a varios.
- **Cambiar SKU, código de barras, precio o costo** de varios productos a la vez.
- **Seleccionar todos los resultados** de una búsqueda o filtro: la casilla del encabezado marca solo los productos que
  ya se ven en la lista.
- **Seleccionar más de 100** productos, ni deshacer un cambio masivo.
- **Duplicar desde la ficha** del producto, o copiar imágenes y stock.

Ver también: [Catálogo: listado y categorías](catalogo-listado-y-categorias.md) y
[Catálogo: alta y edición](catalogo-alta-y-edicion.md).
