---
owner: producto
sources:
  - specs
---

# Catálogo: costo y disponibilidad (MSF-179)

**Épica:** MSF-179 · **Historias:** F-CAT-16 (costo, proveedor y escalas de precio), F-CAT-17 (disponibilidad) y
F-CAT-14 (código de barras buscable).
**Spec:** `specs/20261022-120000-catalogo-costo-y-disponibilidad/` (rama
`epic/MSF-179-catalogo-catalogo-costo-y-disponibilidad`, merge `a485805f`, **pendiente de merge a `main`**).
**Construcción interna:** [Catálogo: costo y disponibilidad (técnico)](../tecnico/catalogo-costo-y-disponibilidad.md).

Completa el catálogo con lo que faltaba para vender y reponer: cada producto tiene una **disponibilidad**
clara, un **código de barras** que se busca con lector, el **costo** —que solo ve quien tiene acceso a
Rentabilidad— y, en la ficha, las **escalas de precio por cantidad** que define Precios.

## Qué resuelve

- Antes, el listado dejaba «Stock» y «Costo» en «—» y el buscador solo encontraba por nombre o SKU. No se
  podía saber de un vistazo si un producto se podía vender, cuánto costaba ni encontrarlo escaneando su código.
- Ahora la columna **Stock** muestra la disponibilidad (**Stock**, **Sin stock**, **A pedido** o **Stock
  entrante en breve**), el listado se filtra por disponibilidad y el buscador acepta un **EAN-13** escaneado.
- El **costo** se ve y se edita solo con acceso a **Rentabilidad**; el **proveedor** y su código siguen la
  regla de Proveedores (MSF-205). La ficha muestra las escalas **x1, x5, x10 y x50** en solo lectura.

## Para quién

| Persona | Qué puede hacer |
|---|---|
| **Administrador/a** (con `rentabilidad`) | Ver y editar el costo en la ficha y ver la columna Costo en el listado; elegir proveedor y disponibilidad |
| **Administración** (con `rentabilidad` en lectura) | Ver el costo sin editarlo |
| **Operador/a** (con `productos` en edición) | Editar el producto, el proveedor, el código de barras y la disponibilidad; **no** ve el costo ni en la ficha ni en el listado |
| **Mostrador o depósito** | Escanear el código de barras en el listado para encontrar el producto al instante |
| **Quien no tiene acceso a Stock** | Ve la disponibilidad correcta sin ver cantidades |

El costo lo restringe la base por la sección `rentabilidad`: ocultar la columna es comodidad, no la
autorización (el Operador obtiene 0 filas de `dominio.producto_costos` aunque la pida a mano). El proveedor,
en cambio, quedó como lo entregó Proveedores y Productos (MSF-205): lo ve y elige quien edita productos;
restringirlo al Administrador quedó **fuera de alcance** (Decisión 1 de la spec).

## Cómo se usa

### Disponibilidad

La ficha y el alta tienen una sección **Disponibilidad** con cuatro estados:

| Estado | Cómo se obtiene |
|---|---|
| **Stock** | Calculado: el producto tiene unidades disponibles. |
| **Sin stock** | Calculado: no tiene unidades disponibles. |
| **A pedido** | Se elige a mano; manda sobre el calculado. |
| **Stock entrante en breve** | Se elige a mano; manda sobre el calculado. |

«Stock» y «Sin stock» se muestran como *calculado* y no se eligen. Con «Quitar la elección manual» el producto
vuelve a la etiqueta calculada. El listado muestra la etiqueta en la columna **Stock** y suma el filtro
**Disponibilidad** (Todos, Stock, Sin stock, A pedido, Stock entrante en breve), que se resuelve en el servidor.

> **Límite importante:** esta entrega **solo guarda y muestra la etiqueta**. Que un producto «A pedido» reserve
> o descuente stock al venderse es una regla de Stock y Ventas que llega con **MSF-292**. Hasta entonces, el
> texto de ayuda de «A pedido» no afirma nada sobre el stock («Se consigue bajo pedido.»), y el prototipo sí
> lo hacía: la diferencia quedó anotada en la spec (Decisión 2).

### Costo, proveedor y escalas de precio

- El **costo** se carga en el alta o la edición y se ve en la **columna Costo** del listado, con dos decimales.
  La columna solo existe para quien tiene lectura o edición en **Rentabilidad**; si no hay costo cargado, o la
  consulta de costos falla, muestra «—» (con un aviso en el segundo caso).
- **Proveedor** y **Código del proveedor** se eligen en el formulario; un código sin proveedor se rechaza.
- La ficha muestra **Precios por escala · sin IVA** con **x1** (1 a 4 u.), **x5** (5 a 9 u.), **x10**
  (10 a 49 u.) y **x50** (50 u. o más), en solo lectura, con el subtítulo «Minorista usa x1 · Mayorista usa la
  escala según la cantidad». Las escalas las calcula **Precios**; si todavía no las entrega, la ficha muestra
  **«No disponible»**. Acá no se calculan, editan ni muestran márgenes.

### Código de barras con lector

1. Poné el foco en el buscador del listado.
2. Escaneá el código (el lector teclea los 13 dígitos y envía Enter). La búsqueda sale al instante, sin la
   pausa de tipeo, y el campo queda listo para el siguiente escaneo.
3. Un texto de exactamente 13 dígitos busca por **coincidencia exacta** de código de barras en la
   organización; cualquier otro texto sigue buscando por nombre o SKU. Sin coincidencia: «No hay productos que
   coincidan».

El campo **Código de barras (EAN-13)** del alta y la edición acepta 13 dígitos, es único por organización y se
puede escanear («13 dígitos, o escanealo» / «Se puede escanear al armar un pedido o ingresar mercadería»). El
lector es el de teclado o USB; la cámara del teléfono quedó fuera de alcance.

## Matriz pantalla ↔ criterios

Las pantallas son las de Catálogo que ya existían; esta épica las amplía, no las rediseña. El detalle
pantalla por ítem (qué es de esta épica y qué queda fuera) está en `## Matriz pantalla↔criterios` de la spec.

| Pantalla | Qué suma esta épica | Criterio |
|---|---|---|
| **Productos · listado** (`/productos`) | Columna Costo (solo con Rentabilidad), columna Stock con la disponibilidad, filtro Disponibilidad y búsqueda por código de barras | FR-002, FR-009, FR-012, FR-013 |
| **Producto · edición** (`/productos/:id/edit`) | Sección Disponibilidad y bloque «Precios por escala · sin IVA» | FR-004, FR-008 |
| **Producto · alta** (`/productos/create`) | Sección Disponibilidad | FR-008 |
| **Empresa activa** | No cambia estos datos: la disponibilidad, el costo y el código de barras son **de la organización**. La empresa activa solo ordena el filtro de tienda del listado (MSF-160) | FR-002, FR-009, FR-012 (sin efecto por empresa) |

## Empresa activa

La disponibilidad, el costo y el código de barras son datos **de la organización**: no cambian con la empresa
activa. Lo único que la empresa activa ordena en esta pantalla es el filtro de tienda del listado (MSF-160), que
acota qué productos se ven; al cambiarla se vuelve a consultar el listado y cada producto conserva su propia
etiqueta de disponibilidad y su costo. Los diálogos de esta épica (alta, edición, «Descartar cambios») no
guardan datos de empresa: la organización sale de la sesión.

## Fuera de alcance y roadmap

| Tema | Estado |
|---|---|
| Reserva y descuento de stock de «A pedido» y «Stock entrante en breve» | MSF-292 (Stock · depósitos y reservas) |
| Depósitos, stock por depósito y reservado | MSF-292 |
| Cálculo, edición y margen de las escalas; tipo de cliente | Precios (MSF-114) |
| Columna Margen, stock numérico y «Stock bajo» | Rentabilidad (MSF-120) y Stock |
| Exportar, importar CSV, edición masiva, variantes y su código de barras | MSF-202, MSF-218 y variantes (P1) |
| Restringir el proveedor al Administrador | Decisión abierta de MSF-205 |
| Lector por cámara | Fuera de alcance (el lector es de teclado/USB) |
| Rediseño del listado y de las pantallas | Fuera de alcance: se amplían las de MSF-456 y MSF-160 |

## Estado

Implementado en la rama `epic/MSF-179-catalogo-catalogo-costo-y-disponibilidad` (merge `a485805f`), **pendiente
de merge a `main`**. Depende de MSF-160 (listado y vista `v_productos_listado`) y MSF-205 (proveedores), también
en sus ramas. El E2E de cierre está escrito pero **no se ejecutó** por falta de Docker en el entorno; se corre a
mano con `pnpm dev:supabase` (ver [Suite E2E](../e2e-app.md)).

## Para profundizar

- [Catálogo: costo y disponibilidad (técnico)](../tecnico/catalogo-costo-y-disponibilidad.md)
- [Catálogo de productos](../catalogo.md)
- [Stock: movimientos, historial, mínimo y sin negativos](../stock.md)
- [Permisos por rol](../permisos-por-rol.md)
- [Proveedores](../proveedores.md)
