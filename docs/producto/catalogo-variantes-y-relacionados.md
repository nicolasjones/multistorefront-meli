---
owner: producto
sources:
  - specs
---

# Variantes y productos relacionados

En la ficha de un producto (al crearlo o al editarlo) hay dos bloques nuevos: **Variantes** y **Productos relacionados**.
Los dos se guardan junto con el producto.

## Variantes

Sirven para un mismo producto que viene en distintos colores, talles o modelos. En lugar de crear una ficha por cada
uno, cargás una **variante** con su propio código, su código de barras y su stock. El precio es siempre el del producto.

### Cómo cargarlas

1. Entrá en **Catálogo → Productos** y abrí un producto (o creá uno nuevo).
2. Bajá hasta el bloque **Variantes**. Si todavía no tiene, vas a ver: «Si no cargás variantes, el producto se vende
   como una sola unidad.»
3. Tocá **Agregar variante**. Aparece una fila «Nueva variante», activa, con el código del producto seguido de un
   número, el código de barras vacío y stock 0, y un aviso: «Variante agregada: completá código y stock».
4. Completá **Variante** (por ejemplo «Negro»), **Código**, **Código de barras** (opcional, 13 dígitos) y **Stock**.
5. Guardá el producto.

### Reglas

- **Códigos únicos.** El código de una variante no puede repetirse en la organización, ni entre variantes ni con el
  SKU de otro producto. Con el código de barras pasa lo mismo. Si hay un choque, el mensaje te dice qué valor se repite
  y se conserva lo que escribiste.
- **Stock del producto.** Si el producto tiene variantes, su stock es la **suma de las variantes activas**.
- **Activa / inactiva.** Con el interruptor **Activa** apagás una variante: deja de sumar al stock, pero conserva su
  código y su historial. Si todas las variantes están inactivas, el producto figura «Sin stock». No hay botón de
  borrar.
- **Primera variante.** Si el producto ya tiene stock, no se le pueden agregar variantes: primero dejá el stock del
  producto en 0 y cargalo en las variantes.
- **Cambiar el stock de una variante.** Se escribe el stock contado en la celda **Stock**; al guardar queda registrado
  como un ajuste «Conteo de inventario». Hace falta permiso de edición en Stock; sin acceso a Stock la columna muestra «—» y no se puede cambiar ningún stock.
- **Si otra persona movió el stock mientras tenías la ficha abierta.** Al guardar, el sistema no pisa ese cambio: te
  avisa y tenés que recargar la ficha y volver a cargar tu conteo. El stock máximo por variante es 2147483647.
- **No se borran.** Las variantes solo se desactivan, y un producto con variantes sigue funcionando como producto con
  variantes aunque todas estén inactivas. Si registrás un movimiento sobre una variante inactiva, queda en el historial
  pero no suma.
- **Intercambiar códigos.** Si querés que dos variantes se cambien los códigos entre sí, hacelo en dos pasos (guardá con
  un código provisorio en una de ellas); en un solo guardado el sistema avisa que el código ya lo usa otra variante.
- **Límites.** No hay tope de variantes por producto. «Duplicar» un producto no copia sus variantes.
- **Sin variantes** el producto funciona igual que siempre.

### Lo que todavía no se puede

- Un **precio distinto por variante**: hoy la variante se vende al precio del producto.
- **Un producto con variantes hoy no se puede vender.** Los comprobantes y las reservas miran el stock del producto, que
  vale 0, y los rechazan; no hay riesgo de vender de más, pero tampoco se puede vender. Conviene cargar variantes solo en
  productos que todavía no se venden.
- **Ingresos y movimientos de stock.** El ingreso de mercadería (y su anulación), la toma de inventario, la carga inicial
  de stock, el reingreso de devoluciones, los lotes y el diálogo «Nuevo movimiento» no permiten elegir variante: con un
  producto con variantes fallan. Si un ingreso o una toma incluye un producto así, se cancela completo: sacá ese
  producto y repetí.
- **Pantallas de stock.** La pantalla Stock, las alertas de Inicio y los reportes de inventario no suman las variantes:
  un producto con variantes figura «Con stock» en el catálogo y en la ficha, pero «Sin stock» ahí.
- Mercado Libre y la tienda tampoco descuentan stock de una variante.

Está pendiente de decisión de producto adaptar ventas, ingresos, toma de inventario y Stock a las variantes.

## Productos relacionados

Sirven para indicar qué más ofrecer junto a un producto (accesorios, juegos compatibles, alternativas).

1. En la ficha, bajá hasta **Productos relacionados** (arriba a la derecha se ve cuántos hay: «0 productos», «1
   producto», «N productos»).
2. Escribí en **Buscar por nombre, SKU o categoría**. Se muestran hasta 4 resultados; no aparecen el propio producto ni los
   que ya agregaste. Si no hay coincidencias: «Sin resultados. Probá con otro nombre, SKU o categoría.»
3. Tocá **Agregar** en el que quieras. Pasa al final de la lista «En este producto (el orden es el que ve el cliente)»
   y aparece «Agregado a relacionados: …».
4. Con **↑** y **↓** cambiás el orden; con **✕** lo quitás («Quitado de relacionados»).
5. Guardá el producto.

Relacionar A con B **no** relaciona B con A: cada ficha tiene su propia lista.

### Lo que todavía no se puede

- Mostrar tus relacionados en la ficha pública de la tienda y sugerirlos al agregar una línea en un comprobante: por
  ahora solo se cargan y se ordenan. La tienda arma sus «relacionados» por categoría, así que la lista que cargás acá
  todavía no se ve ahí. Está pendiente de decisión qué hacer con esta lista.
- No hay tope de relacionados por producto. «Duplicar» no los copia. El buscador también muestra productos inactivos.

## Quién puede hacerlo

| Persona | Qué puede hacer |
|---|---|
| Administrador u Operador con edición en Productos | Cargar y ordenar variantes y relacionados. |
| Además, edición en Stock | Informar el stock de cada variante. |
| Consulta (solo lectura) | Ver los dos bloques sin poder cambiarlos. |

Variantes y relacionados son del catálogo de la organización: no cambian al elegir otra empresa en la barra superior.

## Todo queda registrado

Los cambios en variantes y en relacionados aparecen en **Actividad** (sin precios ni costo), solo cuando algo cambió de verdad.
