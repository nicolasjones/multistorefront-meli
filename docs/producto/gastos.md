---
owner: producto
sources:
  - apps/web/src/pages/gastos
---

# Gastos de cada tienda

> Detalle de ingeniería: [guía de referencia](../gastos.md).

## Para qué sirve

La pantalla **Gastos** te deja anotar lo que cuesta operar cada tienda (alquiler, servicios, sueldos, fletes, insumos, impuestos y otros) y ver cuánto se va por período, por tienda y por concepto. Sirve para entender tus costos fijos. Cargar un gasto **no cambia** ninguno de los márgenes que ves hoy en Rentabilidad.

## Quién puede hacerlo

| Rol | Qué puede hacer |
|---|---|
| **Administrador** | Ver los gastos, cargarlos, editarlos, anularlos y exportarlos. |
| **Otros roles** | No ven el menú ni los importes. Si entran por la dirección ven el aviso «No tenés acceso a esta sección». |

## Dónde lo encontrás

En el menú de la izquierda: **Administración → Gastos**.

## Cómo cargar un gasto

1. Pulsá **Nuevo gasto**.
2. Elegí el **concepto**. El **tipo de costo** (fijo o variable) se completa solo según el concepto y lo podés cambiar.
3. Elegí la **tienda**: un gasto es de una sola tienda. Si un alquiler se comparte, cargá un gasto por tienda con su parte.
4. Indicá la **moneda**, el **importe** (admite centavos) y la **fecha**. El mes de la fecha es el mes al que se imputa el gasto.
5. Opcional: escribí un detalle y marcá **Recurrente** si se repite todos los meses (es solo una marca: no se carga solo).
6. Pulsá **Guardar gasto**.

Si el gasto es en dólares, se convierte a pesos con el dólar de la tienda más cercano a la fecha del gasto, y ese valor queda guardado. Si todavía no hay un dólar cargado, el sistema te pide cargarlo antes: «Cargá la cotización del dólar».

## Ver y filtrar

Elegí el período (**Hoy**, **Semana**, **Mes** o **Mes anterior**), la tienda y, si querés, un concepto o un tipo de costo. Arriba ves el **total del período** en pesos con el desglose por concepto. El listado carga de a tandas a medida que bajás; también podés usar **Cargar más**. Si no hay gastos, aparece «Sin gastos en el período».

## Editar, anular y exportar

- **Editar** corrige un gasto. Si otra persona lo cambió mientras tanto, te avisa que recargues la lista.
- **Anular** da de baja un gasto y pide un **motivo**. Un gasto anulado deja de sumar en los totales; se ve con **Mostrar anulados**. No se puede borrar.
- **Exportar** baja un archivo con los gastos del período y los filtros elegidos, con el importe original, la moneda y el importe en pesos.

Cada alta, edición, anulación y exportación queda registrada en [Actividad](actividad.md).

## Con varias tiendas

La pantalla sigue a la tienda activa de la barra superior. Con **Todas las tiendas** suma las tiendas a las que tenés acceso y muestra la columna Tienda. Si cambiás de tienda con un diálogo abierto, se cierra sin guardar nada.

## Margen después de costos fijos

Cuando el equipo técnico lo activa, Rentabilidad suma la pestaña **Después de costos fijos**. Reparte los gastos **fijos** de cada tienda (alquiler, servicios, sueldos…) entre sus productos **en proporción a lo que vendió cada uno en el mes** y muestra cuánto margen queda después de eso, por tienda, consolidado, producto y categoría.

- **El margen que ya ves no cambia**: la pestaña es una medida aparte. Los gastos **variables** (como fletes) no se reparten.
- **Sin atribuir**: es la parte de los costos fijos que le toca a ventas que no tienen costo guardado; sumada al reparto da el total de fijos del mes.
- **Mes sin ventas**: no hay con qué repartir; el tablero lo avisa y muestra el total de fijos del mes.
- **Mes en curso**: es provisorio, porque todavía se están cargando gastos y ventas.
- Si editás o anulás un gasto de un mes pasado, el margen de ese mes se recalcula solo.
- La pestaña sigue la tienda activa de la barra superior. Si no tenés permiso de lectura en Rentabilidad, ves el aviso de acceso restringido.
- Los eventos de gastos en [Actividad](actividad.md) los ve solo quien accede a esa tienda.
