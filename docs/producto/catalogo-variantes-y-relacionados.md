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
  como un ajuste «Conteo de inventario». Hace falta permiso de edición en Stock; sin acceso a Stock la columna muestra «—».
- **Sin variantes** el producto funciona igual que siempre.

### Lo que todavía no se puede

- Un **precio distinto por variante**: hoy la variante se vende al precio del producto.
- Las **ventas, las reservas, Mercado Libre y la tienda** todavía no descuentan stock de una variante. Conviene cargar
  variantes solo en productos que no se vendan por esos canales hasta que se adapten.

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

- Mostrar los relacionados en la ficha pública de la tienda y sugerirlos al agregar una línea en un comprobante: por
  ahora solo se cargan y se ordenan.

## Quién puede hacerlo

| Persona | Qué puede hacer |
|---|---|
| Administrador u Operador con edición en Productos | Cargar y ordenar variantes y relacionados. |
| Además, edición en Stock | Informar el stock de cada variante. |
| Consulta (solo lectura) | Ver los dos bloques sin poder cambiarlos. |

Variantes y relacionados son del catálogo de la organización: no cambian al elegir otra empresa en la barra superior.

## Todo queda registrado

Los cambios en variantes y en relacionados aparecen en **Actividad** (sin precios ni costo), solo cuando algo cambió de verdad.
