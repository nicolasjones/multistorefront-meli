---
owner: producto
sources:
  - specs
---

# Stock · lotes e inventario (MSF-131)

**Qué resuelve:** que el depósito cargue un remito completo de una sola vez, con un mismo número de lote, y que
pueda hacer una toma de inventario ordenada que corrija las diferencias contra el sistema sin perder el historial.

Reúne las dos historias de la épica MSF-131:

| Historia | Qué agrega |
|----------|------------|
| F-STK-10 · Movimientos en lote (MSF-407) | Carga de un remito con varios productos bajo un número de lote |
| F-STK-11 · Toma de inventario (MSF-415) | Conteo por categoría y corrección con ajustes |

**Estado:** implementado en la rama de la épica (`epic/MSF-131-stock-stock-lotes-e-inventario`); pendiente de merge
a `main` a la fecha de esta página. Spec: `specs/20261024-120000-stock-lotes-e-inventario/`. Las pantallas no estaban
dibujadas en el prototipo: se construyeron con el sistema de diseño.

## Para quién

| Persona | Qué hace |
|---------|----------|
| **Depósito** | Carga remitos en lote, consulta el historial de lotes y hace tomas de inventario |
| **Administrador/a u Operador/a con edición en Stock** | Puede registrar lotes y confirmar tomas |
| **Consulta o cualquier rol sin edición en Stock** | Ve el historial de lotes y la toma, pero no registra ni confirma |

## Carga en lote (F-STK-10)

En **Stock → Carga en lote** se carga un remito completo:

1. Se completa **Proveedor** (opcional, texto libre de hasta 120 caracteres), **Fecha** (por defecto hoy, no puede ser
   futura) y **Motivo** (solo motivos activos que apliquen a entradas).
2. Se agregan las líneas **Producto + Cantidad**. Cada línea necesita un producto activo y una cantidad entera mayor a
   cero; el mismo producto no puede repetirse en el lote.
3. Al confirmar se crea **un movimiento de entrada por línea**, todos con el **mismo número de lote** asignado por el
   servidor, y el stock de cada producto sube en su cantidad.
4. La pantalla muestra «Lote N registrado» y el lote aparece en el historial.

**Garantías que ve el depósito:**

- **Todo o nada:** si una línea es inválida o falla un movimiento, no se crea el lote, no queda ningún movimiento y el
  stock no cambia.
- **Sin duplicados por doble clic o reintento:** dos envíos del mismo contenido devuelven el mismo lote y mueven el
  stock una sola vez. Si se edita el formulario, se genera un envío nuevo.
- **Correcciones:** el lote y sus movimientos no se editan ni se borran. Para corregir se registra un movimiento nuevo.

**Historial de lotes:** muestra número, fecha, proveedor, cantidad de productos y unidades, del más reciente al más
antiguo. Al abrir un lote se ven sus movimientos (producto, SKU, cantidad, saldo y fecha). Lo puede ver cualquier
persona con lectura o edición en Stock.

## Toma de inventario (F-STK-11)

En **Stock → Toma de inventario**:

1. Se elige una **Categoría** (una categoría raíz incluye sus subcategorías).
2. La tabla muestra **Producto/SKU**, **Stock en el sistema** y un campo **Contado** por producto.
3. Al escribir un contado distinto, la fila muestra la **Diferencia** (contado − sistema) con su signo.
4. Al **Confirmar**, se crea un único movimiento de tipo **ajuste** por cada producto con diferencia, con el motivo
   **«Toma de inventario»**, que deja el stock en lo contado. Los productos sin diferencia no generan movimiento.
5. La pantalla muestra los ajustes generados (producto, diferencia y saldo) y el historial de Movimientos los lista.

**Reglas:**

- Un campo **Contado vacío no toca el producto**. El contado debe ser un entero de cero o más; un valor negativo,
  decimal o de texto se rechaza y no se envía.
- **Todo o nada:** si falla un ajuste, no queda ninguno de la toma.
- **Repetir la confirmación no crea movimientos**: la diferencia ya es cero.
- Los movimientos anteriores quedan intactos; la corrección es siempre un ajuste nuevo.
- La toma opera sobre el **depósito por defecto**. Elegir otro depósito queda fuera de alcance.
- Si la categoría supera los 1000 productos, se pide elegir una subcategoría. Si el motivo «Toma de inventario» está
  desactivado, la pantalla avisa que se active desde **Motivos**.

## Permisos

| Acción | Nivel necesario en Stock |
|--------|--------------------------|
| Ver el historial de lotes y sus movimientos | `lectura` o `edicion` |
| Ver la toma de inventario | `lectura` o `edicion` |
| Registrar un lote | `edicion` |
| Confirmar una toma | `edicion` |

La base es la autoridad: sin `edicion`, las RPC de escritura rechazan la operación aunque se llame directamente.
La historia F-STK-11 hablaba de «Operador sin permiso de edición en Stock»; se interpreta como **cualquier rol cuyo
nivel en Stock no sea `edicion`**, no como el rol Operador por defecto.

## Límites y fuera de alcance

- La carga en lote es siempre de **entradas** (un remito); no sirve para salidas ni ajustes.
- El **proveedor es texto libre**: no exige ni crea un proveedor en la sección Proveedores.
- No se elige depósito: ambas pantallas operan sobre el depósito por defecto.
- La toma **no se guarda como borrador ni como entidad**; no hay exportar, imprimir hoja de conteo ni escaneo.
- No se puede editar, anular ni borrar un lote. Tampoco se edita el historial de movimientos.
- La épica no trae un recorrido E2E propio; la verificación es con pruebas de base (pgTAP) y de pantalla (Vitest).

## Empresa activa

**No aplica.** El stock es único por organización y no se separa por empresa; lotes, movimientos y toma no leen ni
escriben datos acotados a una empresa. Las pantallas no muestran selector ni columna de empresa y no cambian al
cambiar la empresa activa.

## Para seguir

- **[Guía técnica de lotes e inventario](../tecnico/stock-lotes-e-inventario.md)** — tablas, RPC, permisos y reversión.
- **[Stock: movimientos, historial y alertas](../stock.md)** — el resto de la sección Stock.
- Spec de la épica: `specs/20261024-120000-stock-lotes-e-inventario/`.

> **Revisión de fuentes:** 2026-10-25 23:00 — se revisaron las fuentes de esta página (specs, prototipos, migraciones y código) y su contenido no cambia.
