---
owner: producto
sources:
  - specs
---

# Catálogo: listado y categorías (MSF-160)

**Épica:** MSF-160 · **Historias:** F-CAT-01 (listado con búsqueda y filtros), F-CAT-07 (empresas que venden el
producto) y F-CAT-08 (categorías).
**Spec:** `specs/20261020-120000-catalogo-listado-y-categorias/` (`spec.md`, `plan.md`, `tasks.md`).
**Construcción interna:** [Catálogo: listado, empresas y categorías (técnico)](../tecnico/catalogo-listado-y-categorias.md).
Referencia general del módulo: [Catálogo de productos](../catalogo.md).

## Qué resuelve y para quién

- **Quien administra el catálogo** encuentra cualquier producto en segundos: busca por nombre o SKU, filtra por estado,
  tienda y categoría, ordena por encabezado y pagina sin cargar todo el catálogo.
- **Quien decide la publicación** marca en qué empresas se vende cada producto. El producto y su stock son únicos y
  compartidos; cada tienda lo publica con su propio precio cuando llegue Precios.
- **Quien arma el menú de las tiendas** organiza categorías y subcategorías (dos niveles), decide en qué tiendas se ven
  y las reordena arrastrando o con teclado.

## Qué incluye

- **Listado** (`/productos`): columnas Producto (miniatura, nombre, SKU), Precio, Costo, Margen, Stock, Categoría,
  «Visible en» y Estado. Precio, Margen y Stock muestran «—» hasta que lleguen sus componentes (Precios, Rentabilidad,
  Stock). Pie «desde–hasta de N».
- **Filtros:** «Todos», «Inactivos», tienda y categoría (una categoría raíz incluye sus subcategorías). «Sin stock»,
  «Stock bajo» y «Sin vincular a ML» se ven **deshabilitados** con la explicación «Se activa cuando llegue Stock /
  Mercado Libre».
- **Empresas que lo venden:** sección en el alta y la edición, una fila por empresa con interruptor. Un producto nuevo no
  se vende en ninguna empresa hasta marcarlas.
- **Categorías** (`/categorias`): árbol de **dos niveles**, «Expandir todo / Contraer todo», filtro de tienda, alta,
  edición, eliminación y orden. Las categorías son de la organización; la visibilidad se elige por tienda.
- **Actividad:** cada cambio real deja un evento (`producto.empresas_actualizadas`, `producto.categoria_asignada`,
  `categoria.creada|editada|reordenada|eliminada`); ver [Actividad](../actividad.md).

## Empresa activa

El listado de Productos arranca filtrado por la empresa activa de la barra superior; elegir otra tienda en la pantalla
es una sobreescritura local que se descarta cuando la empresa activa vuelve a cambiar. Al cambiar la empresa activa el
listado se vuelve a consultar y la paginación vuelve a la página 1. Categorías se recarga al cambiar la empresa activa
o la organización; al cambiar de organización se vacía el árbol y se cierran los diálogos para no guardar datos de la
anterior.

## Permisos

Con permiso de **edición** en Productos se ven «Nuevo producto», «Editar», Activar/Desactivar y las empresas editables;
con **lectura** solo se consulta. Categorías usa su propia sección (`categorias`): sin acceso, la ruta se bloquea. Ver
[Permisos por rol](../permisos-por-rol.md).

## Fuera de alcance

| Tema | Dónde queda |
|---|---|
| Exportar productos | MSF-202 (lee `v_productos_listado`) |
| Importar CSV, destacado, newsletter | Sin historia en esta épica |
| Selección múltiple: «Mover de categoría», «Borrar» | MSF-218 (edición masiva); el producto se desactiva, no se borra |
| IVA de la categoría | F-PRE-12 (MSF-114) |
| Categorías de más de dos niveles | Decisión de la spec: dos niveles (el prototipo muestra «hasta 3») |
| Etiquetas de stock (Disponible, A pedido…) | F-CAT-17 (MSF-179) |
| Valores de precio por empresa, margen y stock | Precios, Rentabilidad y Stock |
| Filtros por stock y por vinculación con Mercado Libre | Se activan con Stock y Mercado Libre |

## Cómo probarlo

### Prerrequisitos

- Entorno local (`pnpm dev:supabase` + app web) o DEV, con la rama de la épica.
- Un usuario con **edición** en las secciones `productos` y `categorias`, y otro de **solo lectura**.
- Una organización con al menos dos empresas y varios productos (conviene más de 25 para ver la paginación), alguno
  inactivo. Una segunda organización con productos propios para comprobar el aislamiento.

### Pasos

1. Abrí **Catálogo → Productos** (`/productos`). Se ve la tabla (tarjetas en pantalla angosta) con las columnas
   indicadas, «—» en Precio, Margen y Stock, y el pie «1–25 de N».
2. Escribí un trozo de nombre o SKU en «Buscar por nombre o SKU». Tras una breve espera el listado se reduce a las
   coincidencias, sin distinguir mayúsculas. Probá con `%` o `_`: se buscan como texto, no como comodín.
3. Elegí el chip **Inactivos**. Solo quedan los productos inactivos. Los chips «Sin stock», «Stock bajo» y «Sin vincular
   a ML» están deshabilitados y explican cuándo se activan.
4. Cambiá el filtro de tienda y el de categoría. Solo se ven los productos de esa empresa/categoría; con una categoría
   raíz aparecen también los de sus subcategorías.
5. Ordená por Producto, SKU y Estado haciendo clic en el encabezado. El orden es estable y cambia la dirección.
6. Buscá un texto sin resultados. Aparece «No hay productos que coincidan» y «Probá con otra búsqueda o limpiá los
   filtros.»; «Limpiar filtros» restablece todo.
7. Cambiá la empresa activa en la barra superior. El listado se vuelve a consultar y vuelve a la página 1.
8. Abrí **Nuevo producto** o **Editar** un producto. En «Empresas que lo venden» activá/desactivá una empresa y guardá.
   Reabrí la ficha: queda como la dejaste. En Actividad aparece «Cambió las empresas del producto …».
9. En el mismo formulario elegí una categoría (opcional) y guardá. En el listado se ve la categoría como «Padre > Hija».
10. Abrí **Catálogo → Categorías** (`/categorias`). Se ve el árbol con «N subcategorías», Productos, «Visible en» y
    acciones. Probá «Expandir todo» / «Contraer todo» y el filtro de tienda.
11. **Nueva categoría**: Nombre, Categoría padre (solo raíces) y «Visible en» (todas marcadas). Guardá. Repetí el mismo
    nombre en el mismo nivel: aparece «Ya existe una categoría con ese nombre en ese nivel» y se conserva lo escrito.
12. Arrastrá una subcategoría a otra raíz y reordená con Subir/Bajar. Intentá poner una subcategoría bajo otra
    subcategoría: se rechaza con aviso. Recargá: el orden persiste.
13. **Eliminar** una categoría con productos y subcategorías. El diálogo informa cuántos productos y subcategorías
    afecta; al confirmar, los productos quedan sin categoría y las subcategorías suben a raíz.
14. Ingresá con el usuario de solo lectura: el listado y el árbol se ven sin acciones de edición. Ingresá con un usuario
    de la otra organización: no ve productos ni categorías ajenos.

### Resultado esperado

- **Dado** un catálogo con muchos productos, **cuando** se busca o se filtra, **entonces** el servidor devuelve solo lo
  que coincide, paginado, y el total del pie es correcto.
- **Dado** un producto, **cuando** se cambian las empresas que lo venden, **entonces** se guardan de forma atómica y
  el listado muestra «Visible en» actualizado.
- **Dado** el árbol de categorías, **cuando** se crea, mueve, reordena o elimina, **entonces** nunca hay más de dos
  niveles ni nombres repetidos en un nivel, y cada cambio queda en Actividad.
- **Dado** un usuario de solo lectura u otra organización, **entonces** no puede editar ni ver datos ajenos.

### Cómo automatizarlo

Todavía **no existe un E2E de navegador** para esta épica (pendiente de automatizar; depende de fixtures por rol, ver
[E2E de la app](../e2e-app.md)). La cobertura actual es pgTAP (`catalogo_listado`, `catalogo_listado_plan`,
`catalogo_producto_empresa`, `catalogo_categorias`) y Vitest (`pages/productos`, `pages/categorias`, `lib/categorias`,
`lib/productosListado`, componentes de `categorias/`). Candidatos E2E, con el rótulo de la tarea que los cubre:
`[MSF-160:T008]` búsqueda y filtros del listado, `[MSF-160:T016]` empresas que venden el producto y `[MSF-160:T028]`
árbol de categorías (crear, mover, eliminar).
