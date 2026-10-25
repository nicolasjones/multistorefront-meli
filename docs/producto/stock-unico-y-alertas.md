---
owner: producto
sources:
  - specs
---

# Stock único y alertas (MSF-231)

**Épica:** MSF-231 · **Historias:** F-STK-04 (MSF-249, stock único y consistente entre canales) y
F-STK-01 (MSF-268, stock actual con alertas de reposición).
**Spec:** `specs/20261018-180000-stock-unico-y-alertas/`.
**Alcance de entrega:** `refine` (`apps/web`) y `supabase`.

**Qué resuelve:** que todas las empresas y canales vean **la misma cantidad** de cada producto aunque
varias personas operen a la vez, que cada cambio quede listo para avisarse a otros canales y que el
equipo vea en **una sola pantalla** qué hay, qué falta y qué está por faltar. La pantalla de Stock se
actualiza sola cuando otra sesión mueve existencias.

## Para quién

| Persona | Qué puede hacer |
|---|---|
| **Administrador/a, Operador/a y Depósito** con `stock` en edición | Ver el stock en vivo, registrar movimientos y editar el mínimo |
| **Consulta, Mostrador y Administración** con `stock` en lectura | Ver el stock en vivo y las alertas, sin botones de edición |
| **Quien no tiene acceso a Stock** | No ve la sección ni recibe filas |

Los permisos no cambian respecto de MSF-136: la base sigue siendo la autoridad y valida el nivel de
Stock en cada consulta y escritura.

## Stock único y consistente (F-STK-04)

- Hay **una sola cantidad por producto y organización**, compartida por todas las empresas y canales.
  No se duplica por tienda ni por empresa activa.
- La única vía de escritura sigue siendo `public.registrar_movimiento_stock` (MSF-136): serializa las
  operaciones del mismo producto y rechaza el saldo negativo.
- Con **20 salidas simultáneas de 1 unidad** sobre un producto con stock 10, quedan **10 aceptadas** y
  **10 rechazadas** con «No hay stock suficiente»; el stock termina en **0**. Las rechazadas no dejan
  movimiento, actividad ni evento.
- Cada movimiento aceptado (entrada, salida o ajuste) deja un evento `stock.actualizado` listo para
  propagarse a otros canales, en la misma transacción. Si la operación se revierte, el evento no existe.
  Definir el mínimo no mueve cantidad y no emite evento.

En el Hito 2 **solo se emite**: todavía no hay consumidor, worker ni flow de Kestra que envíe el stock a
Mercado Libre. Los eventos esperan en la cola sin perderse y sin bloquear las operaciones de stock.

## Alertas de reposición en vivo (F-STK-01)

La pantalla **Stock → Stock actual** (`/stock`) ya existía (MSF-136); esta épica la hace **en vivo** y
verifica sus alertas contra los requisitos.

- **Tabla por producto:** nombre, SKU, **stock total**, mínimo, estado (**Sin stock / Stock bajo /
  Disponible**) y último movimiento, con el total de productos.
- **Resumen de reposición:** «N productos sin stock y M con stock bajo» sobre toda la organización, no
  solo sobre la página visible. **Ver solo alertas** filtra a esos productos.
- **Búsqueda y filtros:** buscar por nombre o SKU y filtrar por Todos / Sin stock / Stock bajo /
  Disponible; la lista y el total reflejan el filtro.
- **Actualización sin recargar:** si otra sesión registra un movimiento, la cantidad, el estado, el
  último movimiento y el resumen se actualizan solos. La búsqueda, el filtro, la página y el foco no se
  pierden.
- **Sin conexión en vivo:** si el canal de Realtime falla, la pantalla sigue funcionando con los últimos
  datos y se puede recargar a mano; no queda bloqueada.
- **Ráfagas:** varios avisos seguidos (por ejemplo, 20 salidas) se agrupan en un solo refresco.

## Empresa activa

**No aplica.** El stock es **único por organización** y no se separa por empresa; el listado no filtra
por empresa ni muestra una columna de empresa, así que cambiar la empresa activa no cambia las
cantidades. La suscripción en vivo sí se vuelve a abrir si cambia la **organización activa**, para no
seguir escuchando la anterior.

## Límites y fuera de alcance

- **F-STK-04 no tiene pantalla propia:** se resuelve en la base de datos y en el contrato de eventos.
- **Envío a Mercado Libre (MSF-123):** llega en Etapa 2 y consumirá el evento `stock.actualizado`; acá
  no hay consumidor ni integración.
- **Stock por depósito, Reservado y Disponible:** los agrega MSF-292 (Stock depósitos y reservas). Acá el
  listado muestra solo el total.
- **Tiendas públicas:** leen existencias por la vista pública en el Hito 3; no se construye acá.
- **Estados «A pedido» y «Entrante en breve»:** no están en los requisitos y no tienen dato de origen.
- **Faltantes, Ingreso de mercadería, Depósitos de mercadería y Actualizar por Excel:** son otras
  historias o épicas y no se tocan en esta.
- **Prototipo:** muestra columnas y filtros que esta épica no implementa (Reservado, Disponible,
  depósitos, «A pedido / entrante»); se implementó solo lo que piden F-STK-04 y F-STK-01.

## Estado

La implementación vive en la rama `epic/MSF-231-stock-stock-unico-y-alertas` y se integró al lote de
STG (`112250fd`); a la fecha de esta página **todavía no está promovida a `main`**. El detalle técnico,
las migraciones, las pruebas y la reversión están en
[Stock único y alertas: cola de eventos y Realtime](../tecnico/stock-unico-y-alertas.md).

## Para seguir

- **[Stock único y alertas: técnica](../tecnico/stock-unico-y-alertas.md)** — cola, contrato del evento,
  Realtime, pruebas y reversión.
- **[Stock: movimientos, historial y alertas](../stock.md)** — el resto de la sección Stock.
- **[Capacidades](capacidades.md)** — el módulo Stock en el mapa de producto.
- Spec de la épica: `specs/20261018-180000-stock-unico-y-alertas/`.
