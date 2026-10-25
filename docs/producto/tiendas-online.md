---
owner: producto
sources:
  - specs
---

# Tiendas online: catálogo y ficha (MSF-167)

Spec: `specs/20261023-120000-tienda-catalogo-y-ficha/spec.md` (épica **MSF-167**, historias F-TDA-11,
F-TDA-12, F-TDA-13 y F-TDA-18). Implementación: PR #317, merge `7d51d0b`. Detalle técnico:
[Tienda pública: catálogo y ficha](../tecnico/tienda-catalogo-y-ficha.md).

Esta página cubre la **tienda navegable** de cada empresa. La resolución por dominio, la identidad visual,
los textos comerciales y la visibilidad de categorías/productos vienen de la épica
**MSF-147** (`tienda-dominio-e-identidad`): ver
[Tienda online: dominio, identidad y vidriera](tienda-dominio-e-identidad.md). El stock sale de
**MSF-231** y el precio final de **MSF-114**.

## Qué resuelve

El visitante entra al dominio de una tienda, **sin cuenta y sin sesión**, recorre sus categorías, filtra y
ordena el catálogo, abre la ficha de un producto y ve si está disponible. Ve el **precio final en pesos de
esa empresa** y **ningún dato interno** (costos, existencias exactas, proveedor, códigos internos ni datos
de otra empresa).

## Para quién

| Persona | Qué hace con esta entrega |
|---|---|
| **Visitante de la tienda** | Navega categorías, busca dentro del catálogo con filtros y orden, abre una ficha y decide si consulta o compra (la compra y el contacto son de otras épicas). |
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
  El stock reservado no cuenta como disponible (hoy no hay reservas; el contrato se cierra con Stock,
  MSF-292).
- **La elección manual de disponibilidad** (`A pedido` / `Stock entrante`) no se publica: la tienda se
  guía solo por el stock real.
- **Sin datos internos.** El catálogo y la ficha no exponen costos, existencias, proveedor, códigos
  internos ni el identificador de la organización.

## Límites y fuera de alcance

Queda **fuera de esta épica** y no debe leerse como hecho:

- **Buscador del encabezado, inicio y pantallas móviles dedicadas:** tienda-inicio-busqueda-movil
  (MSF-191). El layout es responsivo (320 / 768 / 1440 px), pero los filtros y el menú móvil dedicados no
  son de esta entrega.
- **WhatsApp, «Consultar por WhatsApp», «Contacto», «Escribinos» y el formulario:** tienda-whatsapp-y-contacto
  (MSF-212).
- **Compra y carrito:** MSF-176. La **cuenta web del cliente** se suma en MSF-237 (ver
  «Cuenta web y precios por tipo»).
- **«Productos relacionados»** en la ficha y **«Últimas unidades · quedan N»** (expondría stock exacto).
- **Slugs de categoría:** las URLs usan el identificador de la categoría. **Subcategorías:** un producto
  se lista en su categoría directa, sin agregar los de las hijas.
- **Editar el precio por tienda, el IVA o el stock desde la tienda:** son de Precios y Stock.
- **Un catálogo con cientos de miles de productos:** el diseño asume hasta unos pocos cientos de
  productos visibles por tienda; el rendimiento real todavía no se midió (ver pendientes).

## Estado y pendientes

**Implementado en la épica** (PR #317, merge `7d51d0b`); al momento de esta página, pendiente de merge a
`main`. Las cuatro historias están cerradas y verificadas con pgTAP, Vitest/axe y E2E.

| Pendiente | Dueño |
|---|---|
| Medir el rendimiento en celular de `/catalogo` y de la ficha y registrar las cifras (no se inventan). | Seguimiento **MSF-552** |
| Confirmar si las imágenes se sirven con URL pública o firmada (D1); hoy se usan URLs firmadas de una hora sobre el bucket privado. | Definición de producto / Catálogo |
| Confirmar con el cliente si un mismo producto puede tener precio y destacados distintos en cada tienda (D2); los destacados ya son por tienda y el precio es por empresa. | Nicolás / cliente |
| Ajustar el tamaño de página de 24 con pruebas reales (D3). | Producto + Catálogo |
| Cerrar el criterio de stock reservado cuando Stock lo defina (D4); hoy «Disponible» = existencias > 0. | Stock (**MSF-292**) |
| Decidir el recorte de horas del roadmap (D5); no cambia el alcance funcional. | Planificación |

Detalle de cada decisión y su impacto técnico: [Tienda pública: catálogo y ficha](../tecnico/tienda-catalogo-y-ficha.md).

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
