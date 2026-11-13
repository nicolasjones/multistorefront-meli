---
owner: producto
sources:
  - specs
---

# Catálogo: alta y edición (MSF-456)

**Épica:** MSF-456 · **Historias:** F-CAT-02 (alta), F-CAT-03 (SKU único), F-CAT-04 (edición), F-CAT-05 (imágenes) y
F-CAT-06 (activo / inactivo).
**Spec:** `specs/20261017-120000-catalogo-alta-y-edicion/`.
**Construcción interna:** [Catálogo: alta y edición (técnico)](../tecnico/catalogo-alta-y-edicion.md). Referencia
completa por historia: [Catálogo de productos](../catalogo.md).

## Qué resuelve

El equipo puede cargar un producto nuevo con sus fotos, corregirlo, desactivarlo sin perderlo y reactivarlo. El
sistema impide repetir un SKU y todo queda en Actividad (sin mostrar costo ni precio).

## Para quién

| Persona | Qué puede hacer |
|---|---|
| Administrador | Todo lo del Operador, y además ve y edita el **costo** (acceso a Rentabilidad). |
| Operador (edita Productos) | Crear, editar, subir fotos y activar/desactivar. **No ve** el campo costo. |
| Consulta (solo lectura) | Ve la grilla, la ficha y las fotos; no puede guardar, subir, quitar ni cambiar el estado. |

## Cómo se usa

- **Alta** (`/productos/create`, botón «Nuevo producto»): nombre y precio de lista (> 0, sin IVA, en USD o ARS)
  son obligatorios; descripción, «Compatible con» (lista de valores libres) y SKU son opcionales. No hay «Stock
  inicial». «Precio en pesos» figura como «No disponible» hasta que Precios lo entregue. El producto nace
  **activo**.
- **SKU único:** no puede repetirse dentro de la organización, sin distinguir mayúsculas ni espacios en los
  extremos (otra organización sí puede repetirlo). Si se deja vacío, el sistema asigna uno con formato
  `PRD-XXXXXXXX`.
- **Edición** (`/productos/:id/edit`): se corrigen nombre, descripción, SKU, «Compatible con», moneda y precio. Si
  otra persona guardó antes, se avisa del conflicto y no se pisa su cambio.
- **Fotos:** hasta 4 por producto, JPG, PNG o WebP de hasta 2 MB; la primera es la principal. Se suben al guardar.
- **Estado:** Activar/Desactivar desde la fila de la grilla `/productos` (nombre, SKU y estado) o desde la ficha.
  Un producto inactivo conserva datos e imágenes y se muestra con la etiqueta «Inactivo». No hay borrado.
- Avisos «Faltan datos obligatorios» y diálogo «Descartar cambios» en alta y edición.

## Empresa activa

No aplica: los productos son del catálogo de la organización, no de una empresa (`dominio.productos` filtra por
`organizacion_id`, sin columna de empresa; ver [técnico](../tecnico/catalogo-alta-y-edicion.md)).

## Cómo probarlo

### Prerrequisitos

- **Entorno:** DEV, o local con `pnpm dev:supabase` y la web servida (`/productos`).
- **Dos usuarios de la misma organización:** un **Administrador** y un **Operador** (ver
  [Permisos por rol](../permisos-por-rol.md)); opcionalmente un usuario de **Consulta** (solo lectura) y una
  segunda organización para comprobar el aislamiento.
- Tres archivos de prueba: dos imágenes válidas (JPG/PNG/WebP ≤ 2 MB), una de más de 2 MB y un PDF; más de 4
  imágenes válidas para el tope.

### Pasos

1. Como **Operador**, abrí `/productos` y pulsá «Nuevo producto». Se ve el formulario **sin** campo Costo, **sin**
   «Stock inicial» y con «Precio en pesos: No disponible».
2. Pulsá Guardar con todo vacío. Aparece «Faltan datos obligatorios», se marcan nombre y precio y no se crea nada.
3. Cargá nombre «Joystick Pro», descripción, «Compatible con» (dos valores), moneda USD, precio 10 y SKU «ABC-1».
   Elegí dos imágenes válidas y guardá. El producto queda creado y **activo**, con aviso de éxito y sus fotos
   (la primera es la principal).
4. Creá otro producto con SKU «abc-1 » (minúsculas y espacio final). Se rechaza con «Ese SKU ya existe» y se
   conserva lo cargado. Dejá el SKU vacío y guardá: el sistema le pone uno `PRD-XXXXXXXX` que se ve en la ficha.
5. Escribí algo en el formulario de alta y pulsá Cancelar: aparece «Descartar cambios».
6. Abrí `/productos/:id/edit` de «Joystick Pro», cambiá nombre y precio y guardá: los cambios persisten. Guardar
   sin cambios no genera evento.
7. En la ficha intentá sumar una imagen de más de 2 MB, un PDF y una quinta imagen válida: cada una se rechaza con
   mensaje claro. Quitá la imagen principal: la siguiente pasa a ser la principal.
8. Con dos pestañas abiertas sobre el mismo producto, guardá en una y luego en la otra: la segunda avisa del
   conflicto, conserva lo escrito y ofrece recargar.
9. En `/productos` pulsá Desactivar en la fila de «Joystick Pro»: pasa a «Inactivo». Abrí su ficha: datos e
   imágenes intactos. Pulsá Activar: vuelve a activo.
10. Ingresá como **Administrador** y abrí la ficha: ahora sí se ve el campo **Costo**; cargalo y guardá.
11. Como usuario de **Consulta**, abrí la ficha: se ve todo pero no se puede guardar, subir ni cambiar el estado, y
    la grilla no muestra acciones.
12. Abrí `/actividad`: hay eventos de creación, edición, imagen agregada/eliminada, activado y desactivado, con
    quién y cuándo, y **sin** costo ni precio.
13. (Aislamiento) En otra organización creá un producto con SKU «ABC-1»: se permite y no ve los productos de la
    primera.

### Resultado esperado

- **Given** una persona con permiso de edición en Productos, **when** completa nombre y precio válidos y guarda,
  **then** el producto queda activo, con hasta 4 fotos y un evento en Actividad.
- **Given** un SKU ya usado en la organización, **when** se guarda otro igual (sin distinguir mayúsculas ni
  espacios extremos), **then** se rechaza sin perder lo cargado; con SKU vacío se genera uno.
- **Given** un producto activo, **when** se desactiva y se reactiva, **then** conserva el 100 % de sus datos e
  imágenes y ambos movimientos quedan en Actividad.
- **Given** un Operador, **then** nunca ve ni modifica el costo; **given** solo lectura, **then** no puede escribir.

### Cómo automatizarlo

El E2E de punta a punta «crear, editar, subir fotos y desactivar» con Administrador y Operador es la tarea T025 de la
spec, rótulo `[MSF-456:T025]`. **Todavía no existe**: se cerró con desvío por falta de fixtures por rol (seguimiento
MSF-499, ver [E2E de la app](../e2e-app.md)). **Pendiente de automatizar:** todos los pasos anteriores; dueño:
Catálogo. Hoy los cubren pgTAP (`catalogo_productos`, `catalogo_sku_unico`, `catalogo_actualizar_producto`,
`catalogo_producto_imagenes`, `catalogo_estado_producto`) y Vitest (`pages/productos`, `lib/productos`,
`lib/productoImagenes`, `components/productos`).

## Fuera de alcance y roadmap

Categoría y listado completo (MSF-160), proveedor y código de barras (MSF-205, hoy entregado por separado),
IVA y «Precio en pesos» (MSF-114), variantes, relacionados, escalas de precio, stock inicial, video, sugerencias de
«Compatible con» (F-CAT-09), publicaciones de Mercado Libre y borrado físico.

## Estado

Implementada. Ampliada después por [costo y disponibilidad (MSF-179)](catalogo-costo-y-disponibilidad.md).
