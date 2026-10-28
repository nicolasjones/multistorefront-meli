---
owner: producto
sources:
  - specs
  - design/pantallas
---

# Ventas · despacho y faltantes (MSF-135)

**Épica:** MSF-135 · **Historias:** F-VTA-15 (armado, control y entrega con responsables), F-VTA-16 (transporte y
guía de envío), F-VTA-17 (tablero de despacho) y F-VTA-18 (registro de faltantes). **Spec:**
`specs/20261024-130000-ventas-despacho-y-faltantes/` · **Rama:**
`epic/MSF-135-ventas-y-despacho-ventas-despacho-y-falt`, **pendiente de merge a `main`**.
Detalle técnico: [Ventas · despacho y faltantes (técnico)](../tecnico/ventas-despacho-y-faltantes.md).

Esta página explica **qué resuelve** la épica: que una factura confirmada tenga un responsable en cada paso del
despacho, que salga con transporte y guía, y que lo que no se pudo despachar por falta de stock quede registrado.
La factura y el presupuesto se cargan en [Ventas · comprobantes (MSF-159)](ventas-comprobantes.md) y el listado
completo está en [Ventas · listado, estados y anulación (MSF-177)](ventas-listado-estados-y-anulacion.md).

## Qué resuelve

- **Un estado de despacho por factura** que se mueve solo: nadie edita un campo a mano. Cada paso lo firma una
  persona y queda registrado quién lo hizo.
- **Un responsable por paso**: quién armó, quién controló y quién entregó. **Quien armó no puede controlar**
  (salvo el Administrador): es la regla que hace del control un control de verdad.
- **Transporte y guía en la propia factura**: la que sale con transporte queda con su guía y su fecha de envío, y
  **no se puede entregar sin ellos** cuando la forma de envío los exige.
- **Un tablero** con todas las facturas por despachar, filtrable por estado y con el conteo de cada estado.
- **Los faltantes quedan escritos**: la línea que no se pudo armar por falta de stock se registra, la factura pasa a
  **Incompleto** y la línea aparece en la pantalla **Faltantes**.

## Para quién

| Persona | Qué hace con esta entrega |
|---|---|
| **Depósito** | **Arma** el pedido (pasa la factura a **Armando**) y **controla** el armado (pasa a **Listo para despachar**). Con la acción `despachar` puede también registrar faltantes. |
| **Administrador** | Puede armar, controlar y entregar (la excepción a «quien armó no controla» es suya). |
| **Mostrador / Operador / Administración** | Ven el estado del despacho, los responsables y el envío. Sin la acción `despachar` no avanzan el pedido. |
| **Consulta** | Solo ve el estado y los responsables; la tarjeta aparece sin acciones. |
| **Administración** | Usa el **tablero** para ver qué falta salir y la pantalla **Faltantes** para saber qué línea quedó sin stock. |

El permiso que habilita a mover el despacho es la **acción `despachar`** de la sección **Ventas** (Administrador y
Depósito en la matriz inicial). Con Ventas en **lectura** alcanza: no hace falta edición para despachar.

Sin la sección **Ventas** las pantallas muestran «Acceso restringido».

## Los estados del despacho

El estado del despacho es un campo **propio** de la factura, separado del estado documental (Pendiente, Aceptado,
Cobrado… de MSF-177). Los dos comparten dos nombres (**Armando** e **Incompleto**) pero viven en columnas distintas
y los mueve esta épica, no la de los estados documentales.

| Estado | Qué significa | Qué sale de él |
|---|---|---|
| **Sin armar** | La factura está confirmada y todavía no se armó. Es el estado inicial por defecto. | «Empezar a armar» → **Armando** |
| **Armando** | Se está armando el pedido en el depósito. | «Controlar» → **Listo para despachar** · «Registrar faltantes» → **Incompleto** |
| **Incompleto** | Faltan productos: el armado quedó incompleto. | «Reanudar el armado» → **Armando** |
| **Listo para despachar** | El pedido está controlado y listo para salir. | «Entregar» → **Entregado** |
| **Entregado** | El pedido salió. Es el estado final: no se retrocede. | — |

- Al **confirmar** la factura, el estado inicial sale de la **forma de envío** elegida (`Sin armar`, `Armando` o
  `Listo para despachar`); si la forma no define uno, queda `Sin armar`.
- El texto de ayuda de **Entregado** dice que el stock normal **ya se descontó al confirmar** la factura y que al
  entregar se descuentan las **reservas «A pedido»**.
- Cambiar el estado **queda registrado**: «Despacho: *anterior* → *nuevo* en la factura *N* (*responsable*)».
- **Reintentar el mismo estado no duplica nada**: ni actividad, ni descuentos de stock.

## Armado, control y entrega con responsables

En la factura confirmada aparece la tarjeta **Responsables**, con el estado de despacho arriba y tres campos:
**Armó**, **Controló** y **Entregó**. El **Operador** (quien cargó la factura) se muestra, pero solo como dato.

| Paso | Quién puede firmarlo | Regla |
|---|---|---|
| **Armó** | Depósito o Administrador de la tienda de la factura | — |
| **Controló** | Depósito o Administrador | Tiene que ser **distinto de quien armó**, salvo que sea el Administrador |
| **Entregó** | Rol con la acción `despachar` | Fija la fecha y hora de la entrega |

- Solo se puede elegir responsable entre los **usuarios activos de esa tienda** que pueden ver Ventas en ella; el
  desplegable «Seleccionar» ofrece la lista y la base la vuelve a validar.
- La acción de avance queda **deshabilitada** hasta que se elige el responsable del paso, y queda deshabilitada
  mientras la petición está en vuelo (el doble clic no manda dos veces).
- Si otra persona modificó la factura mientras la mirabas, la tarjeta avisa el conflicto, **vuelve a leer** el
  despacho y te pide elegir de nuevo al responsable.
- Una factura confirmada **antes** de esta entrega (sin estado de despacho) muestra el aviso «Esta factura todavía
  no entró al despacho.» y no ofrece acciones.
- Al **entregar** se descuentan, **todo o nada**, las reservas «A pedido» de las líneas de esa factura: las líneas
  de stock normal no se vuelven a tocar (ya se descontaron al confirmar).

## Transporte y guía de envío

En la misma factura confirmada, antes de la tarjeta de responsables, aparece el bloque **Envío y transporte**.

- El **selector de transporte** lleva el rótulo de la forma de envío: «Transporte / expreso» (expreso y terminal),
  «Correo» o «Mensajería propia» (moto). Con la forma **Retiro en local** no hay selector y el bloque dice
  «El cliente retira en el local. No hace falta transporte ni guía.»
- Debajo están los campos **Guía** (hasta 100 caracteres) y **Fecha de envío**. Si no se carga la fecha, se toma la
  del día de Argentina.
- Solo se ofrecen los transportes **activos**, **usados en esa tienda** y del **tipo** que corresponde a la forma de
  envío. Un transporte ya cargado que hoy no se puede elegir sigue visible, con el motivo a la vista («(desactivado)»,
  «(no corresponde a esta forma de envío)», «(no se usa en esta tienda)»).
- **Guardar envío** manda transporte, guía y fecha. El aviso «Envío guardado.» aparece cuando la base confirma y
  desaparece en cuanto se edita la guía.
- En una factura **entregada** el bloque es de solo lectura: avisa «Esta factura ya fue entregada: no se puede
  cambiar el envío.»
- **No se puede entregar sin transporte y guía** cuando la forma de envío los exige: el mensaje dice **qué falta**
  («…falta el transporte» / «…falta la guía»). Con «Retiro en local» se entrega sin ellos.

## El tablero de despacho

La pantalla **Ventas › Despacho** (`/ventas/despacho`) lista las facturas por armar, controlar y entregar. Es de
**solo lectura**: para avanzar el despacho se va al comprobante.

- **Columnas:** Comprobante (enlace al detalle) · Tienda · Fecha · Cliente · Estado (chip) · Responsables (Armó /
  Controló / Entregó, «—» si ese paso no se dio) · Transporte y guía.
- **Búsqueda** «Buscar por cliente o número» y **filtro por estado** con el **conteo** de cada estado
  («Todos (N)», «Sin armar (N)», «Armando (N)», «Incompleto (N)», «Listo para despachar (N)», «Entregado (N)»),
  más «Limpiar filtros» y el filtro de tienda.
- **Estados de la pantalla:** carga, vacío «Sin resultados» (distingue «sin filtros» de «probá con otra búsqueda») y
  error con «Reintentar». En pantallas angostas la tabla se ve como tarjetas.
- Entran solo las **facturas confirmadas y no anuladas**: los borradores, los presupuestos, las notas de crédito y las
  facturas anuladas no aparecen.

!!! note "Esta pantalla no tiene prototipo"
    El artboard «Despacho» del prototipo **no existe**: se construyó con los componentes del kit (encabezado,
    barra de herramientas, tabla, filtro de tienda y estados). Si más adelante se dibuja, se ajusta la disposición.

## Los faltantes

Un **faltante** es una línea de una factura que no se pudo despachar por falta de stock. Se registra **desde la
factura**: en la tarjeta de responsables, el chip **Incompleto** abre el diálogo «Registrar faltantes».

- El diálogo pide, línea por línea, **cuántas unidades faltaron**. La cantidad tiene que estar **entre 1 y lo
  pedido** en esa línea; si no, se rechaza con un mensaje claro y no se registra nada.
- Al registrar, la factura pasa a **Incompleto** y queda el evento «Faltantes en la factura *N*: …». Si la línea ya
  tenía un faltante abierto, **se actualiza la cantidad**: no se duplica. Cuando la factura ya está Incompleta, el
  chip dice **«Ajustar faltantes»** en lugar de «Incompleto».
- Un faltante **no mueve stock**: corregir el stock es del módulo Stock (toma de inventario).
- El faltante **se cierra al reanudar el armado**: cuando la factura vuelve de **Incompleto** a **Armando**, sus
  faltantes abiertos pasan a **resueltos** y dejan de listarse.

La pantalla **Ventas › Faltantes** (`/ventas/faltantes`) los lista:

- Título «Faltantes» y descripción «Líneas vendidas o pedidas sin stock.», con **filtro de tienda** y su texto de
  ayuda: «Por defecto se ven todas; si elegís una empresa en la barra superior, se filtra por esa tienda.»
- **Columnas:** Tienda · Cliente · Producto (con SKU) · Pedido (las unidades que faltan) · Comprobante · Desde
  (cuándo se registró) · Stock hoy (estado del producto y unidades disponibles).
- Es de **solo lectura**: los faltantes los registra el despacho, no esta pantalla.
- Estados de carga, vacío «Sin resultados» y error con «Reintentar»; paginación de 10 en el servidor.

## Empresa activa

Todas las pantallas de esta épica siguen la **empresa activa** de la barra superior.

- En el **tablero** y en **Faltantes**, el filtro de tienda hereda la empresa activa: al cambiarla se **descartan**
  filas, total y conteos de la empresa anterior, se recarga todo y la paginación vuelve a la primera página.
- En la **factura**, al cambiar de tienda la tarjeta de responsables suelta lo elegido, muestra el aviso y relee el
  despacho; si la nueva tienda no es la del comprobante, la pantalla **se cierra con aviso**.
- El **diálogo «Registrar faltantes»** se **cierra con aviso** si cambia la empresa activa: nunca se guarda un
  faltante de una tienda bajo otra.
- El bloque **Envío y transporte** se relee al cambiar de tienda y nunca guarda el envío de una tienda bajo otra.

## Matriz pantalla↔criterios

### Ventas · Comprobante (`VentasComprobante`)

| Ítem visible | Dueño |
|---|---|
| Tarjeta **Responsables**: chip del estado, Operador (solo lectura) y Armó / Controló / Entregó con «Seleccionar» | F-VTA-15 |
| Acciones de avance («Empezar a armar», «Reanudar el armado», «Controlar», «Entregar») | F-VTA-15 |
| Chip **Incompleto** que abre el diálogo «Registrar faltantes» | F-VTA-18 |
| Bloque **Envío y transporte**: selector de transporte, Guía y Fecha de envío | F-VTA-16 |
| Texto «El cliente retira en el local. No hace falta transporte ni guía.» | F-VTA-16 |
| Chips de Envío y transporte (Retiro en local, Moto, Expreso, Correo) | **MSF-159** — la elección de la forma de envío |
| Estados Pendiente, Aceptado, Cobrado, En proceso, Deuda | **FUERA DE ALCANCE** — estado documental y de cobro: MSF-159/MSF-177/MSF-195 |
| Botón «Nota de crédito» y diálogo «Nota de crédito» | **FUERA DE ALCANCE** — MSF-177 |
| «Copiar», «Imprimir», «Imprimir remito», «Enviar por correo» y el diálogo de impresión | **FUERA DE ALCANCE** — impresión y envío: MSF-213 |
| Botón «Agregar flete» | **FUERA DE ALCANCE** — MSF-159 no lo pidió |
| Cuenta de cobro y «Ir a Pagos →» | **FUERA DE ALCANCE** — cobros: MSF-195 |
| Tabla **Historial de estados y acciones** (Cuándo, Acción, Quién, Tienda) | **FUERA DE ALCANCE** como pantalla (MSF-177); los cambios de despacho quedan en la actividad |
| Aviso de contrarreembolso («El transporte cobra al entregar…») y rendición | **FUERA DE ALCANCE** — contrarreembolsos: MSF-195 / MSF-139 |
| **Empresa activa** | F-VTA-15, F-VTA-16, F-VTA-18 |

### Ventas · Faltantes (`VentasFaltantes`)

| Ítem visible | Dueño |
|---|---|
| Título «Faltantes» y subtítulo «Líneas vendidas o pedidas sin stock.» | F-VTA-18 |
| Filtro Tienda («Todas las tiendas» + una por empresa) y su texto de ayuda | F-VTA-18 |
| Tabla: Tienda, Cliente, Producto (con SKU), Pedido, Comprobante, Desde, Stock hoy | F-VTA-18 |
| Paginación y «Sin resultados» | F-VTA-18 |
| Casillas, «N seleccionados de M faltantes» y botón «Avisar a los seleccionados» | **FUERA DE ALCANCE** — aviso al cliente: MSF-161 |
| Columna **Aviso** («Sin avisar» / «Avisado») y diálogo «Avisar a los clientes» | **FUERA DE ALCANCE** — MSF-161 |
| Tabla «Avisos de la tienda web» | **FUERA DE ALCANCE** — MSF-161 |
| Texto «Un faltante se cierra solo cuando se ingresa la mercadería» | **FUERA DE ALCANCE** — el cierre de esta épica es al **reanudar el armado** |
| Pestañas Comprobantes, Presupuestos, Pagos, Devoluciones (RMA), Transportes y contrarreembolsos | **FUERA DE ALCANCE** — son de otras épicas |
| **Empresa activa** | F-VTA-18 |

### Ventas · Despacho (tablero, F-VTA-17) — sin artboard

| Ítem visible | Dueño |
|---|---|
| Tabla Comprobante, Tienda, Fecha, Cliente, Estado, Responsables, Transporte y guía | F-VTA-17 |
| Búsqueda «Buscar por cliente o número», filtro por estado con conteos y «Limpiar filtros» | F-VTA-17 |
| Paginación, «Sin resultados», carga y error con «Reintentar» | F-VTA-17 |
| Entrada «Despacho» en el grupo Ventas del menú | F-VTA-17 |
| **Empresa activa** | F-VTA-17 |

### Ventas · Transportes y contrarreembolsos (`VentasTransportes`)

| Ítem visible | Dueño |
|---|---|
| Catálogo de transportes (tabla, «Nueva empresa», «Guardar empresa» y su diálogo) | **MSF-139** — ya entregado; esta épica solo lo consume |
| Columna «Envíos del mes» | **FUERA DE ALCANCE** — la épica no pide seguimiento de envíos |
| Tablas de envíos y botón «Marcar cobrado» | **FUERA DE ALCANCE** — contrarreembolsos: MSF-195 |

## Permisos

| Acción | Sección | Quién |
|---|---|---|
| Ver el tablero y la pantalla de Faltantes | `ventas` ≥ lectura | Quien tenga Ventas en lectura o edición en la tienda |
| Ver el estado y los responsables de una factura | `ventas` ≥ lectura | Igual que arriba |
| Armar, controlar, entregar y registrar faltantes | acción `despachar` de `ventas` | Administrador y Depósito (matriz inicial) |
| Guardar el envío y la guía | acción `despachar` **o** `ventas` en edición | Administrador y Depósito; Mostrador/Operador/Administración con edición |

Detalle de la matriz: [Permisos por rol](../permisos-por-rol.md).

## Límites y decisiones abiertas

- **El comprobante es interno, no fiscal**: no emite CAE ni tiene validez impositiva.
- **La matriz de roles es una propuesta a confirmar con el cliente.** La acción `despachar` viene sembrada para
  Administrador y Depósito; cambiarla es un cambio de datos (la matriz de permisos), no de código.
- **Quién entrega** es, hoy, quien tenga `despachar`. Si hay que sumar otro rol (Mostrador, Operador), se le da la
  acción en la matriz: no hace falta migración.
- **El faltante se cierra al reanudar el armado**, no cuando ingresa la mercadería: el cierre automático por ingreso
  de stock **no** está hecho (acopla el módulo Stock) y el texto del prototipo al respecto **no** se muestra.
- **El aviso al cliente por faltante no está hecho**: es de otra épica (MSF-161, P1).
- **Solo las líneas «A pedido» reservan stock hasta la entrega.** Los productos normales se descontaron al confirmar
  la factura y no se vuelven a tocar.
- **Un presupuesto nunca entra al despacho**, ni una factura anulada.
- **El tablero no tiene artboard:** se construyó con el kit de panel.
- El **diálogo «Registrar faltantes»** no está en el prototipo: lo pide el requisito y se anotó en el PR.

## Fuera de alcance de esta épica

Aviso al cliente por faltantes (MSF-161), contrarreembolsos y rendición (MSF-195 / MSF-139), cierre automático del
faltante por ingreso de mercadería, historial de envíos por transporte, RMA y devoluciones (MSF-178) e impresión y
envío por correo (MSF-213).

## Cómo probarlo

### Prerrequisitos

- **Entorno:** un stack local con la rama de la épica (`pnpm dev:supabase` + `pnpm dev`, panel en
  `http://localhost:5173`) o el ambiente **DEV** con la épica desplegada.
- **Personas y permisos** (en la organización de prueba):
  - **Depósito** con Ventas en **lectura** en la empresa: arma y controla.
  - **Depósito** (o **Administrador**) con la acción `despachar`: entrega y registra faltantes.
  - Un **segundo Depósito** distinto del que arma: hace el control (la regla «quien armó no controla»).
  - **Administrador** de la organización.
- **Datos a sembrar:**
  - Dos **empresas** (tiendas) de la misma organización y un producto con stock en un depósito.
  - Una **forma de envío** de tipo **Expreso** con «exige transporte y guía» y otra de tipo **Retiro en local**.
  - Un **transporte activo** asignado a la primera tienda (catálogo de **Ventas › Transportes**, MSF-139).
  - Una **factura en borrador** con al menos una línea de stock normal (se carga en
    [Ventas · comprobantes](ventas-comprobantes.md)) y una con una línea «A pedido».

### Pasos

1. **Cargar y confirmar la factura.** En `http://localhost:5173/ventas/comprobantes/nuevo`, creá una factura con una
   línea, elegí la forma de envío **Expreso** y pulsá **Confirmar factura**. Al confirmar, la pantalla se recarga y
   el comprobante queda en solo lectura.
2. **Ver el estado inicial.** Abrí la factura confirmada y mirá la tarjeta **Responsables**: el chip de estado
   dice **Sin armar** (o el estado inicial de la forma de envío) y debajo aparece el bloque **Envío y transporte**.
3. **Armar.** Con la sesión de **Depósito**, en la tarjeta **Responsables**, elegí el responsable en **Armó** y
   pulsá **Empezar a armar**. Se tiene que ver el chip **Armando** y el responsable con su nombre.
4. **Intentar controlarse a uno mismo.** Con la misma sesión de Depósito, intentá **Controlar** eligiéndote como
   **Controló**: la base lo rechaza con un mensaje en castellano y el estado sigue **Armando** (no cambia nada).
5. **Controlar con otra persona.** Entrá con la sesión del **segundo Depósito** y pulsá **Controlar** eligiendo al
   segundo Depósito. Se tiene que ver el chip **Listo para despachar** y **Controló** con su nombre.
6. **Entregar sin guía (control negativo).** Con la sesión de Depósito, elegí el responsable en **Entregó** y pulsá
   **Entregar** sin haber cargado el envío: la entrega se rechaza y el mensaje dice **qué falta** («falta el
   transporte» o «falta la guía»); la factura sigue **Listo para despachar** y no se descuenta ninguna reserva.
7. **Cargar el envío.** Con la sesión de Depósito, en **Envío y transporte** elegí el transporte, escribí una guía y
   pulsá **Guardar envío**. Se tiene que ver el aviso «Envío guardado.» y los campos con el transporte, la guía y la
   fecha.
8. **Entregar.** Con la sesión de Depósito, elegí el responsable en **Entregó** y pulsá **Entregar**. Se tiene que
   ver el chip **Entregado** y la fecha de entrega; el bloque de envío queda deshabilitado con el aviso «Esta factura
   ya fue entregada: no se puede cambiar el envío.»
9. **Mirar el tablero.** Abrí `http://localhost:5173/ventas/despacho`: la factura aparece con su estado, sus tres
   responsables (Armó, Controló, Entregó) y el transporte con la guía. Filtrá por estado **Entregado**: la lista se
   queda solo con esa factura y el conteo de la píldora muestra cuántas facturas entregadas hay en esa tienda.
10. **Registrar un faltante.** En otra factura, con la sesión de Depósito, llevá el estado a **Armando** y pulsá el
    chip **Incompleto**: se abre el diálogo «Registrar faltantes». Elegí una línea, escribí una cantidad **mayor que
    lo pedido** y confirmá: se rechaza con un mensaje claro y **no** se registra nada. Escribí una cantidad válida
    (por ejemplo, 3 de una línea de 10) y confirmá: la factura pasa a **Incompleto**.
11. **Ver el faltante listado.** Abrí `http://localhost:5173/ventas/faltantes`: aparece la fila con Tienda, Cliente,
    Producto y SKU, Pedido (3), Comprobante, Desde y Stock hoy. Al volver al **tablero**, la factura está en
    **Incompleto**.
12. **Reanudar el armado.** Volvé a la factura y pulsá **Reanudar el armado**: el estado vuelve a **Armando** y el
    faltante **desaparece** de la pantalla Faltantes (quedó resuelto).
13. **Cambiar de empresa.** Con el diálogo «Registrar faltantes» abierto, cambiá la empresa activa en la barra
    superior: el diálogo **se cierra con aviso** y no se guarda nada. Después, en el tablero y en Faltantes, al
    cambiar de empresa se recargan las listas y la paginación vuelve a la primera página, sin filas de la empresa
    anterior.
14. **Solo lectura.** Entrá con una persona que tenga Ventas en **lectura** y sin `despachar`: ve el estado y los
    responsables, pero no hay acciones de avance; en el tablero y en Faltantes ve las listas y no puede cambiar nada.

### Resultado esperado

- **Given** una factura confirmada, **When** se la entrega con un responsable elegible, **Then** pasa por
  **Armando → Listo para despachar → Entregado**, con **Armó**, **Controló** y **Entregó** anotados, la guía y el
  transporte guardados, y las reservas «A pedido» descontadas **todo o nada**.
- **Given** una factura `armando` armada por X, **When** se intenta controlar con X, **Then** se rechaza salvo que
  X sea Administrador, y la factura y el stock quedan como estaban.
- **Given** una forma de envío que exige transporte y guía, **When** se intenta entregar sin alguno de los dos,
  **Then** se rechaza indicando **qué falta** y la factura no queda entregada.
- **Given** una factura en `armando`, **When** se registra un faltante de una cantidad válida, **Then** queda un
  faltante abierto, la factura pasa a `incompleto` y la línea aparece en Faltantes; al **reanudar el armado** el
  faltante queda resuelto y deja de listarse.
- **Given** dos empresas activas distintas, **When** se cambia de empresa con un diálogo abierto, **Then** el
  diálogo se cierra con aviso, no se guarda nada de la empresa anterior y las listas se recargan sin sus filas.

### Cómo automatizarlo

**Hoy no hay ningún E2E de esta épica**: el cierre probó con pgTAP y Vitest, y el rótulo de cobertura por historia
(`[EPICA:TASK]`) todavía no tiene ningún test de MSF-135. Queda pendiente de automatizar, con estos rótulos:

| Recorrido | Test E2E propuesto | Rótulo |
|---|---|---|
| Armado, control y entrega con responsables | `apps/web/e2e/ventas-despacho.e2e.ts` | `[MSF-135:T011]` |
| Transporte, guía y exigencia al entregar | `apps/web/e2e/ventas-despacho.e2e.ts` | `[MSF-135:T019]` |
| Tablero: columnas, filtro con conteos y cambio de empresa | `apps/web/e2e/ventas-despacho.e2e.ts` | `[MSF-135:T026]` |
| Faltantes: registrar, listar y resolver al reanudar | `apps/web/e2e/ventas-faltantes.e2e.ts` | `[MSF-135:T037]` |

Las tareas son de `specs/20261024-130000-ventas-despacho-y-faltantes/tasks.md`: **T011** (tarjeta de responsables),
**T019** (bloque de envío), **T026** (tablero) y **T037** (pantalla y diálogo de faltantes). El rótulo lo usa
`pnpm cobertura:e2e` para atar cada test a su historia.

## Pendientes

| Qué falta | Por qué | Dueño |
|---|---|---|
| **E2E de la épica** (armado → control → entrega, envío y guía, tablero, faltantes) | La épica validó con pgTAP y Vitest; el rótulo `[EPICA:TASK]` de esta épica todavía no tiene ningún test. Rótulos previstos: `[MSF-135:T011]`, `[MSF-135:T019]`, `[MSF-135:T026]`, `[MSF-135:T037]` | responsable de plataforma (cierre de MSF-135) |
| **Cierre automático del faltante** al ingresar la mercadería | La épica solo registra el faltante y lo resuelve al **reanudar el armado**; el cierre por ingreso de stock acopla el módulo Stock y quedó **fuera de alcance** | Producto / Stock |
| **Aviso al cliente** por faltante (casillas, columna «Aviso» y diálogo del prototipo) | Es de otra épica: **MSF-161** (P1) | Ventas avisos de faltantes (MSF-161) |
| **Artboard «Despacho»** en el prototipo | El tablero se construyó con el kit de panel; si se dibuja, se ajusta la disposición y se actualiza la matriz | Producto / diseño |
| **Confirmar la matriz de roles** (quién entrega) | La acción `despachar` viene sembrada para Administrador y Depósito como **propuesta**; si entra otro rol, se le da la acción en la matriz, sin migración | Producto (cliente) |

## Estado

Implementado en la rama de la épica con sus cuatro historias y el cierre (F-VTA-15/MSF-152, F-VTA-16/MSF-166,
F-VTA-17/MSF-183 y F-VTA-18/MSF-201), **pendiente de merge a `main`**. La fuente funcional es
`specs/20261024-130000-ventas-despacho-y-faltantes/spec.md`; las pruebas están en
`supabase/tests/database/despacho_*.test.sql`, `envio_transporte.test.sql` y `faltantes.test.sql`, y en
`apps/web/src/components/ventas/ResponsablesDespacho.test.tsx`, `EnvioTransporte.test.tsx`,
`RegistrarFaltantesDialog.test.tsx` y `apps/web/src/pages/ventas/despacho.test.tsx` y `faltantes.test.tsx`.

## Para seguir

- **[Ventas · despacho y faltantes (técnico)](../tecnico/ventas-despacho-y-faltantes.md)** — tablas, RPC, permisos y
  reversión.
- **[Ventas · comprobantes (producto)](ventas-comprobantes.md)** — cómo se carga la factura y el presupuesto.
- **[Ventas · listado, estados y anulación (producto)](ventas-listado-estados-y-anulacion.md)** — el estado
  documental y la anulación.
- **[Permisos por rol](../permisos-por-rol.md)** — secciones, niveles y acciones (incluida `despachar`).
- **[Stock](../stock.md)** — depósitos, movimientos y reservas «A pedido».
