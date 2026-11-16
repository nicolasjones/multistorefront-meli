---
owner: producto
sources: []
---

# Cierre de caja

## Para qué sirve

Al final del día cerrás la caja de una tienda: el sistema resume cuánto entró por **forma de pago** y por
**cuenta de cobro** y, a partir de ese momento, **no se puede registrar ni modificar ningún cobro de ese
día** hasta que reabras la caja.

Es el control del efectivo: si alguien quiere corregir o agregar un cobro de ayer, tiene que quedar
registrado que la caja se reabrió.

## Quién puede hacerlo

| Acción | Quién |
|---|---|
| Ver los cierres y sus resúmenes | Todos los roles con acceso a **Ventas** (Administrador, Operador, Mostrador, Administración, Consulta y Técnico). |
| **Cerrar** y **reabrir** la caja | Solo el **Administrador**. |

Con otros roles la pantalla lista los cierres, pero no muestra el botón **Cerrar caja** ni la acción
**Reabrir**.

## Dónde lo encontrás

En el menú de la izquierda: **Ventas → Cierre de caja**.

## Ver los cierres

1. Entrá en **Ventas → Cierre de caja**.
2. Arriba hay un filtro de tienda. Por defecto se ven **todas** tus tiendas; si elegís una tienda en la
   barra superior, la lista se filtra por esa.
3. La tabla muestra, por día y tienda:

   | Columna | Qué muestra |
   |---|---|
   | **Tienda** | A qué tienda pertenece el cierre. |
   | **Fecha** | El día que se cerró. |
   | **Estado** | **Cerrada**, **Reabierta** o **Abierta**. |
   | **Total** | Cuánto se cobró ese día, todo junto. |
   | **Detalle** | Un renglón por **forma de pago** y cuenta: por ejemplo, «Efectivo: $120.000» y «Transferencia bancaria · Banco Nación: $80.000». |

4. Abajo se pagina: «Cierres por página».

Si todavía no cerraste ninguna caja, se ve «Sin cierres de caja».

## Cerrar la caja del día

1. Elegí **una tienda concreta** en la barra superior. El botón **Cerrar caja** se habilita recién con
   una tienda elegida; con «Todas mis empresas» queda deshabilitado y se lee «Elegí una empresa en la
   barra superior para cerrar la caja de hoy.»
2. Hacé clic en **Cerrar caja**.
3. Aparece un cuadro de confirmación que te dice qué va a pasar: «Vas a cerrar la caja de <tienda> del
   <fecha>. Se resumen los cobros del día por forma de pago y cuenta, y no se podrán registrar ni
   modificar cobros de ese día hasta reabrirla.»
4. Confirmá con **Cerrar caja**.
5. Se ve el aviso «Caja cerrada · <tienda> · <fecha>» y la fila aparece en la tabla con el estado
   **Cerrada** y su detalle.

!!! tip "Cerrar dos veces el mismo día"
    No pasa nada: el cierre es idempotente. Si volvés a cerrar el mismo día, el sistema te devuelve el
    cierre que ya existía.

!!! warning "No se puede cerrar un día que todavía no llegó"
    Si intentás cerrar una fecha futura, el sistema lo rechaza.

## Qué pasa cuando la caja está cerrada

- No se puede **registrar** ningún cobro de ese día.
- No se puede **modificar** ningún cobro de ese día: tampoco cambiar el importe de uno, ni mover un cobro
  a ese día.
- Tampoco se puede **conciliar** un pago de ese día, ni registrar el cobro de un contrarreembolso.

El aviso que ves es: «La caja de ese día está cerrada; reabrila para registrar o modificar cobros.»

## Reabrir la caja

1. En la tabla, buscá la fila con estado **Cerrada** y hacé clic en **Reabrir**.
2. Aparece un cuadro de confirmación: «Vas a reabrir la caja de <tienda> del <fecha>. Se podrán registrar
   y modificar cobros de ese día; al volver a cerrarla se rehace el resumen.»
3. Confirmá con **Reabrir**.
4. Se ve el aviso «Caja reabierta · <tienda> · <fecha>» y la fila pasa a estado **Reabierta**.

Desde ese momento podés registrar y modificar cobros de ese día con normalidad.

## Volver a cerrar una caja reabierta

Cerrá de nuevo el mismo día: la **misma** fila vuelve a estado **Cerrada** y el **resumen se rehace**
con los cobros que haya ahora (incluidos los que se agregaron mientras estuvo reabierta).

## Cambiar de tienda con un cuadro abierto

Si cambiás de tienda en la barra superior mientras tenés el cuadro de **Cerrar caja** o **Reabrir**
abierto, el cuadro se cierra solo y la lista se recarga. Nunca se confirma un cierre de la tienda
anterior bajo la nueva.

## Detalle y límites

- El cierre es **por tienda y por día**: cada tienda tiene su propia caja.
- El **día** es el de la tienda: si tu organización tiene una zona horaria propia, el cierre usa esa
  hora, no la del servidor.
- La conciliación de pagos **sigue siendo manual**: el cierre resume lo que ya está registrado, no
  importa extractos del banco.
- El cierre **no cuenta el efectivo del cajón**: no se compara contra un conteo declarado.
- Cuando un cobro quedó bloqueado por la caja cerrada, primero reabrí y después registralo. Para más
  detalle de los cobros, mirá [Cobros y conciliación](ventas-cobros-y-conciliacion.md).

## Capturas

Las capturas de esta pantalla están pendientes de generar; el seguimiento está en la guía técnica de la
épica. Hasta que estén, seguí los pasos de esta página.
