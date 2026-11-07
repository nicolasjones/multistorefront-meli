---
owner: producto
sources: []
---

# Importaciones y exportaciones: seguir las cargas y descargas masivas

## Para qué sirve

Cuando alguien carga o descarga muchos datos de una vez (productos, stock, publicaciones de una tienda o el historial de ventas), el trabajo puede tardar y algunas filas pueden fallar. **Importaciones** reúne todos esos trabajos en un solo lugar para que puedas ver:

- cuáles están esperando, cuáles están en curso y cuáles ya terminaron;
- cuánto avanzó cada uno y cuánto tardó;
- cuántas filas fallaron y por qué;
- y, si todavía no terminó, cancelarlo.

Esta pantalla **no inicia** cargas ni descargas: solo muestra y sigue las que hacen las demás áreas del sistema.

## Quién puede verla

| Rol | Acceso |
|---|---|
| **Administrador** | Ve la pantalla y puede cancelar procesos de su organización. |
| Cualquier otro rol | No ve el ítem en el menú ni puede abrir la pantalla. |

## Dónde la encontrás

Menú **Administración → Importaciones**.

## Qué muestra la tabla

Cada fila es una carga o descarga, de la más reciente a la más antigua.

| Columna | Qué significa |
|---|---|
| **Fecha** | Cuándo se pidió el trabajo. |
| **Origen** | El nombre del trabajo, con el área de donde viene (por ejemplo, Catálogo, Stock, Mercado Libre o Exportación total) y si es una importación o una exportación. |
| **Estado** | En qué punto está (ver abajo). |
| **Avance** | Cuántas filas se procesaron sobre el total. Mientras está abierto muestra una barra de progreso. |
| **Errores** | Cuántas filas no se pudieron procesar. |
| **Duración** | Cuánto tardó, o «en curso» / «sin empezar» si todavía no terminó. |

### Los estados

| Estado | Qué quiere decir |
|---|---|
| **Pendiente** | Se pidió pero todavía no empezó. |
| **En curso** | Se está procesando. |
| **Cancelando** | Pediste cancelarlo y se va a detener al terminar el lote que está procesando. |
| **Completado** | Terminó sin errores. |
| **Con errores** | Terminó, pero algunas filas no se pudieron procesar. El detalle dice cuáles y por qué. |
| **Fallido** | No pudo terminar. Las filas que ya se habían procesado se conservan. |
| **Cancelado** | Se detuvo a pedido tuyo. Lo que ya se había procesado se conserva. |

Mientras haya trabajos **Pendiente** o **En curso**, la tabla se actualiza sola cada pocos segundos. Cuando todos terminaron, deja de consultar.

Si todavía no hay trabajos, ves el mensaje **«Todavía no hay importaciones ni exportaciones»**. Aparecerá una fila cuando algún área del sistema registre una carga o una descarga.

## Ver el detalle y los errores

1. En la fila del trabajo, hacé clic en **Ver detalle**.
2. Se abre el cuadro **«Detalle de la importación»** con un resumen: nombre, origen, estado, avance, cantidad de errores, fecha de creación y duración.
3. Más abajo está la tabla de errores, con **Fila**, **Referencia** y **Motivo**. Se muestra de a diez; usá **Anterior** y **Siguiente** para recorrerla.
4. Si el trabajo no tuvo errores, el cuadro dice **«Este proceso no registró errores»**.
5. Para cerrarlo, usá **Cerrar** o la tecla **Escape**.

## Cancelar un trabajo

El botón **Cancelar** aparece solo mientras el trabajo está **Pendiente** o **En curso**.

1. Hacé clic en **Cancelar** en la fila del trabajo.
2. El cuadro **«¿Cancelar este proceso?»** te muestra el nombre del trabajo y te avisa que lo ya procesado se conserva.
3. Confirmá con **Sí, cancelar el proceso** o volvé con **No, volver**.

Qué pasa según el estado:

- Si estaba **Pendiente**, pasa a **Cancelado** de inmediato y no llega a ejecutarse.
- Si estaba **En curso**, queda **Cancelando** hasta que se detiene al terminar el lote actual y pasa a **Cancelado**.
- Si ya había terminado, aparece el aviso **«El proceso ya terminó, no se puede cancelar.»**

## La empresa activa

La pantalla sigue la **empresa activa** de la barra superior.

- Con una empresa elegida, ves solo los trabajos de esa empresa.
- Con **Todas mis empresas**, ves los de todas, incluidos los que no pertenecen a una empresa en particular.
- Al cambiar de empresa, la tabla se recarga desde la primera página. Si tenías un cuadro abierto, se cierra con un aviso para que no queden datos de la empresa anterior en pantalla.

## Lo que todavía no hace esta pantalla

- **No inicia** cargas ni descargas: cada área las dispara desde su propia pantalla.
- **No reintenta** las filas con error ni permite descargar el registro de errores.
- **No muestra** los errores internos del panel ni las alertas del equipo de soporte: eso se revisa por fuera de esta pantalla.

Hasta que las demás áreas empiecen a registrar sus cargas y descargas, la pantalla puede estar vacía.
