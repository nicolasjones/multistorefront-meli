---
owner: producto
sources:
  - specs
---

# Tiendas online: catálogo, ficha, inicio y búsqueda

Specs: `specs/20261023-120000-tienda-catalogo-y-ficha/spec.md` (épica **MSF-167**, historias F-TDA-11,
F-TDA-12, F-TDA-13 y F-TDA-18) y `specs/20261024-120000-tienda-inicio-busqueda-movil/spec.md` (épica
**MSF-191**, historias F-TDA-10, F-TDA-15 y F-TDA-17). Implementación: PR #317 (merge `7d51d0b`) y PR #349
(merge `a2b439e`). Detalle técnico:
[Tienda pública: catálogo y ficha](../tecnico/tienda-catalogo-y-ficha.md) y
[Tienda pública: inicio, búsqueda y móvil](../tecnico/tienda-inicio-busqueda-movil.md).

Esta página cubre la **tienda navegable** de cada empresa. La resolución por dominio, la identidad visual,
los textos comerciales y la visibilidad de categorías/productos vienen de la épica
**MSF-147** (`tienda-dominio-e-identidad`): ver
[Tienda online: dominio, identidad y vidriera](tienda-dominio-e-identidad.md). El stock sale de
**MSF-231** y el precio final de **MSF-114**.

## Qué resuelve

El visitante entra al dominio de una tienda, **sin cuenta y sin sesión**, ve una página de inicio con sus
categorías y destacados, busca productos mientras escribe, recorre el catálogo con filtros y orden, abre la
ficha de un producto y ve si está disponible; todo funciona también en celular y tableta. Ve el **precio
final en pesos de esa empresa** y **ningún dato interno** (costos, existencias exactas, proveedor, códigos
internos ni datos de otra empresa).

## Para quién

| Persona | Qué hace con esta entrega |
|---|---|
| **Visitante de la tienda** | Entra por el dominio, ve la home, busca productos por nombre mientras escribe, navega categorías, filtra y ordena el catálogo, abre una ficha y decide si consulta o compra (la compra y el contacto son de otras épicas). Lo hace igual desde el celular. |
| **Dueño/a o responsable de la empresa** | No tiene una pantalla nueva acá: prepara la vidriera en Empresas y Catálogo (MSF-147 y MSF-160). La tienda publica lo que esas pantallas dejan visible, con el precio y el stock vigentes. |
| **Operación** | Ve el mismo catálogo que el cliente, sin cantidades ni datos internos. |

## Qué puede hacer el visitante

- **Navegar por categorías:** el encabezado y el pie listan las categorías visibles de esa tienda;
  entrar a una muestra su nombre, las migas «Inicio / Categoría» y su listado.
- **Recorrer el catálogo:** `/catalogo` muestra «Todos los productos» con el contador de resultados.
- **Filtrar:** por categoría, «Solo con stock» y «Precio máximo» (en pesos, con «Sin límite»).
- **Ordenar:** «Más relevantes» (destacados primero), «Menor precio» y «Mayor precio».
- **Compartir la URL:** categoría, filtro de stock, precio máximo, orden y página viven en la dirección;
  abrirla de nuevo devuelve el mismo resultado. Cambiar un filtro vuelve a la página 1.
- **Paginar:** de a **24 productos** por página, con el total y las páginas que informa el servidor.
- **Abrir una ficha:** galería con imagen principal y hasta 4 miniaturas, ampliación de la imagen,
  nombre, categoría, precio, disponibilidad, descripción, SKU y la nota «Precios y disponibilidad sujetos
  a cambios.»; si el producto tiene compatibilidad cargada, se muestra como texto.
- **Ver disponibilidad:** «Disponible» o «Sin stock» en la tarjeta y en la ficha. Nunca se muestra la
  cantidad ni «Últimas unidades · quedan N».
- **Encontrar una página amable:** una categoría o un producto inexistente, oculto o de otra empresa
  muestra la misma página 404, sin revelar si existe.
- **Ver «Sin imagen»** cuando el producto no tiene fotos o la imagen no carga.

### Página de inicio (MSF-191)

- **Ver el banner de la tienda:** título, subtítulo y botón («Ver catálogo» / «Explorar productos» según
  la tienda), definidos en la gestión de MSF-147.
- **Ver las categorías con su cantidad:** una tarjeta por categoría visible, en el orden del catálogo, con
  «N productos» (incluido «0 productos»); al tocarla se abre su listado.
- **Ver los destacados:** hasta **8** productos marcados como destacados por la empresa, con imagen o «Sin
  imagen», nombre, precio final de la empresa y «Disponible» / «Sin stock», más «Ver todo el catálogo →».
  Sin destacados, el bloque no se muestra.
- **Entender una tienda vacía:** si la tienda está activa pero no tiene ningún producto visible, la home
  dice «Catálogo en preparación» en lugar de mostrar bloques vacíos o un error.
- **Seguir viendo el resto si un bloque falla:** cada bloque de la home tiene su propio error con
  «Reintentar» sin romper los demás.

### Buscar productos (MSF-191)

- **Buscar desde cualquier pantalla:** el campo «Buscar productos» está en el encabezado de todas las
  pantallas públicas. A partir de **2 caracteres** y tras una espera corta (400 ms) se abre un desplegable
  con **hasta 6 sugerencias**: imagen o «Sin imagen», nombre, precio final y «Disponible» / «Sin stock»;
  tocar una abre su ficha.
- **Encontrar aunque haya tildes, mayúsculas o errores de tipeo:** «cargdor», «CARGADOR» y «cárgador»
  encuentran los cargadores. La búsqueda es por **nombre** y no usa un motor externo.
- **Ver todos los resultados:** «Ver todos los resultados →» (o Enter sin elegir una sugerencia) lleva a
  `/catalogo?q=<texto>`, con el título «Resultados para “<texto>”», la miga «Inicio / Resultados» y los
  mismos filtros, orden, paginación y tarjetas del catálogo. La dirección es compartible y `q` se conserva
  al cambiar un filtro, el orden o la página.
- **Entender cuando no hay coincidencias:** el desplegable dice «No encontramos productos con ese nombre.»;
  la página de resultados usa «No encontramos productos» con «Limpiar filtros», que conserva la búsqueda.
  Un texto vacío o de menos de 2 caracteres no muestra ninguno de los dos mensajes.
- **Recibir un aviso si busca demasiado seguido:** hay un límite de **30 búsquedas por visitante por
  minuto** (cada sugerencia y cada página de resultados cuenta una). Al superarlo se muestra un aviso con
  los segundos de espera, anunciado al lector de pantalla, y la búsqueda se repite sola al vencer.
- **Reintentar si falla la red:** el desplegable muestra un mensaje con «Reintentar» sin romper el resto de
  la pantalla.
- **Usar el teclado:** flechas para recorrer las opciones, Enter para elegir, Esc para cerrar; también
  cierra al tocar afuera.
- **Nunca ver productos de otra tienda:** la búsqueda filtra por el dominio y la empresa activa.

### Usar la tienda en el celular (MSF-191)

- **Tamaños cubiertos:** celulares de **360, 390, 412 y 430 px** de ancho y tabletas de **768 y 1024 px**,
  sin scroll horizontal ni elementos cortados. En tableta se reutiliza el mismo layout responsivo; no hay
  un diseño nuevo.
- **Menú desplegable:** en celular, el botón de menú abre un panel con «Inicio» y «Categorías» (la actual
  marcada). Se cierra con el botón, Esc, al navegar o al tocar afuera; el foco queda atrapado y vuelve al
  botón. «Contacto» no aparece hasta que exista esa página (MSF-212).
- **Filtros del catálogo:** el botón «Filtrar · N» (con la cantidad de filtros activos) abre un panel con
  «Limpiar», Categoría, «Solo con stock», «Precio máximo» y Ordenar; «Ver N productos» aplica y cierra. El
  estado queda en la URL, igual que en escritorio.
- **Ficha en una columna:** «← Todos los productos» arriba, galería con miniaturas táctiles y ampliación
  usable en pantalla chica; sin botón de WhatsApp (MSF-212).
- **Error con reintento:** si se cae la conexión, las pantallas muestran «No pudimos cargar esta página.» +
  «Reintentar»; al reintentar se conservan la URL y los filtros.
- **Buscador en celular:** el campo y su desplegable se adaptan al ancho y conviven con el menú abierto o
  cerrado.

## Reglas de negocio que respeta

- **Una tienda, una empresa, un dominio.** Cada dominio muestra solo los datos de su empresa; nunca se
  mezclan catálogos, precios ni categorías entre tiendas.
- **Visible es lo que la empresa publicó.** Se muestra un producto activo, marcado visible para esa
  tienda y con su categoría (y la categoría padre) visible. Un producto oculto no aparece ni por URL.
- **Precio de la empresa.** Es el precio final en pesos según la regla de precio de la empresa y su
  interruptor «Precios que ve el cliente» (con o sin IVA). Si no se puede calcular (por ejemplo, un
  precio en dólares sin cotización), no se muestra precio; el producto queda al final en los órdenes por
  precio y no pasa el filtro de precio máximo.
- **Disponibilidad sin cantidades.** «Disponible» significa que hay unidades; «Sin stock», que no las hay.
  El stock reservado no cuenta como disponible: Stock define el criterio como el **disponible** (cantidad menos
  reservado) y MSF-292 ya lo aplica en el catálogo; la tienda pública todavía no (ver la decisión D4).
- **La elección manual de disponibilidad** (`A pedido` / `Stock entrante`) no se publica: la tienda se
  guía solo por el stock real.
- **Sin datos internos.** El catálogo, la home, la búsqueda y la ficha no exponen costos, existencias,
  proveedor, códigos internos ni el identificador de la organización.
- **La búsqueda es por nombre y en el servidor.** Se ignoran mayúsculas y tildes y se toleran errores de
  tipeo con las extensiones de Postgres; no hay motor externo. El texto del visitante se trata como
  literal y se escapa en pantalla.
- **Límite de búsquedas.** 30 pedidos por visitante por minuto; el visitante se identifica con un hash de
  la IP que informa el proxy más el dominio, **nunca se guarda la IP**. Las sugerencias y los resultados
  comparten el mismo contador; un texto vacío o de menos de 2 caracteres no consume el límite.
- **La home respeta la misma visibilidad y el mismo precio que el catálogo.** Los destacados son solo
  productos destacados y efectivamente visibles de esa tienda, con el precio final de la empresa. «Catálogo
  en preparación» significa que no hay **ningún** producto visible; no es un error.

## Límites y fuera de alcance

Queda **fuera de estas épicas** y no debe leerse como hecho:

- **Buscador externo, por SKU, descripción o categoría, historial o búsquedas populares:** la búsqueda de
  MSF-191 es por nombre, con las extensiones de Postgres como único motor.
- **Pantalla propia de resultados y artboards de tableta:** los resultados son el catálogo con `q`; no hay
  un diseño específico para 768/1024 px, se reutiliza el layout responsivo.
- **WhatsApp, «Consultar por WhatsApp», «Contacto», «Escribinos» y el formulario:** tienda-whatsapp-y-contacto
  (MSF-212). La entrada «Contacto» del menú móvil tampoco se agrega hasta que exista la página.
- **SEO, páginas legales y 404 con buscador:** MSF-149. La búsqueda deja el buscador como componente
  reutilizable para esa épica.
- **Compra y carrito:** MSF-176. La **cuenta web del cliente** se suma en MSF-237 (ver
  «Cuenta web y precios por tipo»).
- **«Productos relacionados»** en la ficha y **«Últimas unidades · quedan N»** (expondría stock exacto).
- **Slugs de categoría:** las URLs usan el identificador de la categoría. **Subcategorías:** un producto
  se lista en su categoría directa, sin agregar los de las hijas.
- **Editar el precio por tienda, el IVA o el stock desde la tienda:** son de Precios y Stock.
- **Un catálogo con cientos de miles de productos:** el diseño asume hasta unos pocos cientos de
  productos visibles por tienda; el rendimiento real todavía no se midió (ver pendientes).

## Estado y pendientes

**MSF-167 (catálogo y ficha):** implementada en la épica (PR #317, merge `7d51d0b`); al momento de esta
página, pendiente de merge a `main`. Las cuatro historias están cerradas y verificadas con pgTAP,
Vitest/axe y E2E.

**MSF-191 (inicio, búsqueda y móvil):** implementada en la épica (PR #349, merge `a2b439e`; historias
F-TDA-10/MSF-399, F-TDA-15/MSF-413 y F-TDA-17/MSF-421; cierre documental MSF-558); al momento de esta
página, pendiente de merge a `main`. Verificada con pgTAP, Vitest/axe y E2E de escritorio y celular.

| Pendiente | Dueño |
|---|---|
| Medir el rendimiento en celular de `/catalogo` y de la ficha y registrar las cifras (no se inventan). | Seguimiento **MSF-552** |
| Medir el LCP de home, catálogo y ficha en emulación móvil «4G lento» (objetivo < 3 s) y registrar los valores. | Seguimiento **MSF-560** |
| Confirmar en DEV la cadena real de `x-forwarded-for` y ajustar los saltos de proxy si hace falta; hoy no está confirmada. | Operación / despliegue |
| Fijar el número definitivo del límite de búsquedas; hoy la implementación usa 30 por visitante por minuto. | Nicolás |
| Verificar «Contacto» en el menú móvil cuando MSF-212 entregue la página (hoy no se muestra). | **MSF-212** |
| Confirmar si se mantiene «Precio máximo» en el panel de filtros móvil (D5); hoy se incluye por comportamiento. | Producto |
| Revisar los textos de los estados no dibujados en el prototipo (aviso de espera, error, «Catálogo en preparación»). | Nicolás |
| Confirmar si las imágenes se sirven con URL pública o firmada (D1); hoy se usan URLs firmadas de una hora sobre el bucket privado. | Definición de producto / Catálogo |
| Confirmar con el cliente si un mismo producto puede tener precio y destacados distintos en cada tienda (D2); los destacados ya son por tienda y el precio es por empresa. | Nicolás / cliente |
| Ajustar el tamaño de página de 24 con pruebas reales (D3). | Producto + Catálogo |
| Cerrar el criterio de stock reservado cuando Stock lo defina (D4); el criterio ya está definido por MSF-292 (disponible = cantidad − reservado), pero la tienda pública todavía no lo aplica: su función de disponibilidad conserva el criterio anterior. | Stock (**MSF-292**) / Tiendas online |
| Decidir el recorte de horas del roadmap (D5); no cambia el alcance funcional. | Planificación |

Detalle de cada decisión y su impacto técnico: [Tienda pública: catálogo y ficha](../tecnico/tienda-catalogo-y-ficha.md)
y [Tienda pública: inicio, búsqueda y móvil](../tecnico/tienda-inicio-busqueda-movil.md).

## Cuenta web y precios por tipo (MSF-237)

La tienda suma el acceso de **clientes con cuenta web** (épica **MSF-237**, spec
`specs/20261024-051500-cuenta-web-del-cliente/`). Guía de producto:
[Cuenta web del cliente](cuenta-web-cliente.md); detalle técnico:
[Cuenta web del cliente](../tecnico/cuenta-web-cliente.md).

| Ruta | Qué hace |
|---|---|
| `/ingresar` | Ingreso con correo y contraseña; el encabezado muestra «Ingresar» / «Salir». |
| `/definir-contrasena` | Atiende el enlace de invitación o de restablecimiento y deja al cliente ingresado. |
| `/recuperar-contrasena` | Pide el correo y responde siempre igual, exista o no la cuenta. |

- **Solo entra una cuenta activa y habilitada en esa tienda.** Credenciales incorrectas, suspendida, sin
  cuenta o no habilitada muestran el mismo mensaje genérico y no dejan sesión abierta. La suspensión rige
  al instante porque el estado se consulta en cada llamada.
- **Precios:** el visitante y las cuentas no activas ven el precio público de siempre. El **minorista**
  activo ve el precio x1; el **mayorista** activo ve en la ficha x1, x5, x10 y x50 con su rango de
  unidades. Las **tarjetas del catálogo siguen mostrando x1** (D3).
- **Funciones:** `publico.acceso_cliente_por_dominio(host)` y
  `publico.precios_cliente_por_dominio(host, productos[])`, solo para `authenticated`; `anon` no las
  ejecuta. Ninguna devuelve `organizacion_id`, costos, margen ni existencias.
- **Fuera de alcance:** historial de compras y favoritos (F-CLI-20 / MSF-450), auto-registro, compra y
  carrito (MSF-176).

La cuenta se crea **por invitación desde el panel de Clientes**; no hay registro público (D2).
