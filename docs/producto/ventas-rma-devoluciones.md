---
owner: producto
sources:
  - specs
  - design/pantallas
---

# Ventas · devoluciones (RMA) (MSF-178)

**Épica:** MSF-178 · **Historias:** F-VTA-28 (alta de RMA por ítem, MSF-288), F-VTA-29 (formas de
resolución y seguimiento, MSF-304) y F-VTA-30 (RMA con nota de crédito y stock, MSF-320); cierre MSF-573.
**Spec:** `specs/20261027-100000-ventas-rma-devoluciones/` · **Rama:**
`epic/MSF-178-ventas-y-despacho-ventas-rma-devolucione`, **pendiente de merge a `main`**.
**Prioridad:** P1 · alcance diciembre · 24 h (3 × M), con las etiquetas `alcance-diciembre` y
`revisar-roadmap`.
Detalle técnico: [Ventas · devoluciones (RMA), técnico](../tecnico/ventas-rma-devoluciones.md).

Esta página explica **qué resuelve** la épica: registrar una devolución o un reclamo sobre una factura
vendida, seguir el caso hasta cerrarlo y resolverlo devolviendo el importe (nota de crédito) o la
mercadería (reingreso de stock). La factura, su confirmación y la nota de crédito se cargan en
[Ventas · comprobantes](ventas-comprobantes.md) y [Ventas · listado, estados y anulación](ventas-listado-estados-y-anulacion.md).

## Qué resuelve

- **Un registro por ítem**: cada devolución o reclamo se abre sobre **una factura confirmada** y una de
  sus líneas, con su **forma de RMA**, su **motivo** y sus **observaciones**. Queda numerado `RMA-####`
  y con el operador que lo cargó.
- **Un seguimiento visible**: el RMA pasa por **Abierta → En gestión → Cerrada**, con el evento de quién
  lo movió y cuándo. El listado permite filtrar por forma de RMA y ver el estado de cada caso.
- **Una resolución que cierra el caso**: una **devolución de importe** se resuelve emitiendo una **nota de
  crédito** vinculada; las formas físicas se resuelven **reingresando el stock** al depósito de origen. En
  ambos casos el RMA queda **Cerrado** y el vínculo se ve en el listado.

La épica **no reimplementa** la nota de crédito ni el stock: reutiliza `emitir_nota_credito` (F-VTA-11,
MSF-177) y `registrar_movimiento_stock` (MSF-136). La factura sigue siendo la fuente de lo vendido y el
RMA no la modifica.

## Para quién

| Persona | Qué hace con esta entrega |
|---|---|
| **Administrador** | Registra devoluciones, las sigue y las resuelve por las dos vías: en la matriz inicial tiene Ventas en edición, la acción `emitir_nota_credito` y Stock en edición. |
| **Administración** | Con Ventas en edición registra, sigue y emite la nota de crédito (`emitir_nota_credito`); **no** reingresa stock desde el RMA porque en la matriz inicial tiene Stock en lectura (sí puede cargar la entrada desde Stock). |
| **Mostrador / Operador** | Con **Ventas en edición** registra y sigue devoluciones. Solo puede emitir la nota si además tiene la acción `emitir_nota_credito`; el reingreso exige además **Stock en edición** (el Operador lo tiene en la matriz inicial; el Mostrador no). |
| **Depósito** | Con **Ventas en lectura** ve el listado y los estados, pero **no** registra, no avanza el estado y no resuelve desde esta pantalla: el reingreso exige Ventas en edición (aunque tenga Stock en edición, puede cargar la entrada desde Stock). |
| **Consulta** | Con Ventas en lectura ve las devoluciones y su estado; no tiene acciones. |
| **Sin la sección Ventas** | La pantalla muestra «Acceso restringido». |

El permiso se resuelve **en la empresa del RMA**, no en la empresa activa: tener edición en una tienda no
habilita a tocar devoluciones de otra. Detalle de la matriz: [Permisos por rol](../permisos-por-rol.md).

## Las cinco formas de RMA

Las formas son **valores fijos**: no hay una pantalla para editarlas. Viven como `check` en la base y un
catálogo único en el frontend (`apps/web/src/lib/formasRma.ts`).

| Forma | Qué significa | Cómo se resuelve hoy |
|---|---|---|
| **Cambio directo** | Se entrega otro producto en el momento. | Reingreso de stock. |
| **Enviado a proveedor** | El ítem vuelve al proveedor para reparación o cambio. | Reingreso de stock. |
| **Faltante en envío** | El paquete llegó incompleto. | Reingreso de stock. |
| **Reclamo faltante** | Reclamo abierto al transporte o al proveedor. | Reingreso de stock. |
| **Devolución de importe** | Se reintegra el pago al cliente. | Nota de crédito de importe. |

!!! note "Mapeo a confirmar"
    El mapeo **forma → mecanismo** es una propuesta de la spec (*Decisiones abiertas* 6) a confirmar con el
    cliente. Cambiarlo es ajustar la RPC de resolución, no la estructura. Hoy la pantalla lo aplica así:
    «Devolución de importe» ofrece **Emitir nota de crédito** y las otras cuatro, **Reingresar stock**.

## Los estados

El documento del componente define tres estados; el prototipo solo dibuja «Abierta» y «Cerrada». Manda el
comportamiento de la épica: **tres estados**, con las etiquetas visibles del prototipo más «En gestión».

| Estado guardado | Etiqueta | Qué significa | Acción disponible |
|---|---|---|---|
| `abierto` | **Abierta** | El caso se registró y todavía no se tomó. | «Pasar a En gestión» |
| `en_gestion` | **En gestión** | Alguien lo está siguiendo. | «Cerrar» |
| `cerrado` | **Cerrada** | El caso terminó (a mano o por la resolución). | — (acción deshabilitada) |

- La transición es **lineal**: no se salta de Abierta a Cerrada con la acción de estado ni se retrocede. La
  base lo rechaza con un mensaje claro.
- Reintentar el mismo estado **no duplica** el evento ni cambia nada.
- La **resolución** (nota de crédito o reingreso) también deja el RMA en **Cerrada**.
- Cada cambio queda en **Actividad**: «Pasó la devolución RMA-#### de Abierta a En gestión».

## La pantalla Devoluciones (RMA)

Entrada **Devoluciones** en el grupo **Ventas** del menú (icono `AssignmentReturnIcon`), ruta
`/ventas/devoluciones`. El prototipo es `design/pantallas/VentasDevoluciones.dc.html` (inventario en
`design/pantallas/VentasDevoluciones.inventory.json`).

- **Título** «Devoluciones (RMA)» y subtítulo «Devoluciones y reclamos por ítem: cambio, envío a proveedor,
  faltante en envío y devolución de importe.».
- **Pestañas** Comprobantes · Presupuestos · Devoluciones (RMA). El prototipo muestra además Pagos,
  Faltantes y Transportes y contrarreembolsos: son de otras épicas y **no** entran acá.
- **Columnas:** RMA (número y fecha) · Tienda (chip) · Comprobante (enlace al detalle) · Cliente ·
  Producto (con ×cantidad) · Forma de RMA (chip y, si está resuelto, el vínculo) · Motivo / operador ·
  Estado (chip y acciones).
- **Contador** «N devoluciones», **paginación de 8 por página** («1–8 de N») y **filtro Tienda** con las
  píldoras «Todas las tiendas» + las tiendas accesibles.
- **Estados de la pantalla:** carga inicial, error con «Reintentar», y dos vacíos: «Sin devoluciones ·
  Todavía no registraste devoluciones.» (sin filtro de forma) y «Sin devoluciones · No hay registros con
  esa forma de RMA.» (con una forma elegida). En pantallas angostas la tabla se muestra como tarjetas.
- **No hay buscador en la pantalla** en esta entrega: la RPC `listar_rma` admite búsqueda por RMA,
  comprobante, cliente o producto, pero la UI no expone el campo.

## Nueva devolución

El botón **Nueva devolución** solo aparece con **Ventas en edición**. Abre el diálogo homónimo.

| Campo | Regla |
|---|---|
| **Comprobante** | Autocompletado por número o cliente. Solo se ofrecen **facturas** de la tienda del filtro (o de todas las accesibles) que **no** estén en borrador ni anuladas. Los presupuestos y las notas de crédito no admiten RMA. |
| **Ítem** | Una línea de esa factura, con su descripción y la cantidad vendida. |
| **Cantidad** | Entero de **1 a lo vendido menos lo ya devuelto** en esa línea. No está dibujada en el prototipo, pero la base la exige. |
| **Forma de RMA** | Una de las cinco, con su descripción. |
| **Motivo** | Obligatorio, hasta **200** caracteres. |
| **Observaciones** | Opcional, hasta **1000** caracteres. |

- En esta entrega el diálogo registra **un ítem por devolución** (la RPC admite varias líneas, pero la
  pantalla manda una).
- Con **Cancelar** se cierra sin guardar; **Registrar devolución** crea el RMA y sus ítems en una sola
  transacción, con el número correlativo y el evento `rma.registrada`.
- El éxito dice **«Devolución registrada · {forma}»** y el RMA aparece en el listado con su número, su
  fecha y su ítem.
- Si la cantidad excede lo vendido o lo aún no devuelto, no se crea nada y la pantalla muestra el mensaje
  de la base («No podés devolver más de lo vendido: de X quedan Y por devolver»).
- Si se cambia de **empresa activa** con el diálogo abierto, se cierra con aviso y no se guarda nada de la
  tienda anterior.

## Seguimiento

- **Filtro Forma de RMA**: píldoras **Todas** + las cinco formas. El filtro se resuelve **en el servidor**
  (`p_forma_rma` de `listar_rma`), vuelve a la página 1 y actualiza el contador «N devoluciones».
- **Avance de estado**: junto al chip, quien edita ve **Pasar a En gestión** (si está Abierta) o **Cerrar**
  (si está En gestión). Con el RMA Cerrado la acción queda deshabilitada.
- El resultado se avisa con «Devolución RMA-#### · En gestión» / «… · Cerrada», y el listado se vuelve a
  leer.
- **Conflicto**: si otra persona modificó el RMA mientras lo mirabas, la pantalla avisa «Otra persona
  modificó esta devolución. Actualizamos el listado: revisá y volvé a intentar.» y recarga. No se pisa el
  cambio ajeno.

## Resolver la devolución

Un RMA **sin resolver** muestra en la columna Estado una segunda acción, según su forma. No está dibujada
en el prototipo: se agregó con los componentes del kit y se anotó en el PR.

| Forma | Acción | Qué hace |
|---|---|---|
| **Devolución de importe** | **Emitir nota de crédito** | Pide **importe sin IVA** y **concepto** (hasta 200 caracteres). Emite la nota sobre la factura reutilizando `emitir_nota_credito`, la vincula al RMA y lo cierra. |
| Las otras cuatro | **Reingresar stock** | Confirma el reingreso: crea una **entrada por ítem** en el depósito de origen de la línea, con el motivo **«Devolución»** y la nota **`RMA-####`**, y cierra el RMA. |

- En el listado, la columna **Forma de RMA** muestra el vínculo: **«Nota de crédito {número}»** (enlace al
  comprobante de la nota) o **«Stock reingresado»**.
- **Idempotencia**: repetir la resolución no emite otra nota ni duplica movimientos. Si el RMA ya tiene
  nota, la devuelve; si ya tiene reingreso, lo devuelve.
- **Exclusión mutua**: un RMA resuelto con nota **no** admite reingreso y uno resuelto con reingreso **no**
  admite nota. La base lo rechaza para no devolver dos veces la mercadería o el dinero.
- La **nota** exige la acción `emitir_nota_credito` en la tienda del RMA. El **reingreso** exige Ventas en
  edición **y** Stock en edición (lo valida `registrar_movimiento_stock`); si falta Stock en edición, no
  queda nada a medias.
- El reingreso va **al depósito de origen de cada línea**. La pantalla no permite elegir otro depósito
  (la RPC admite `p_deposito_id`, pero la UI manda nulo).

!!! note "Nota de crédito de importe ≠ devolución de productos"
    La resolución desde el RMA usa la nota de **devolución de importe**. La nota de **devolución de
    productos** (que también mueve stock) sigue emitiéndose desde la pantalla del comprobante (MSF-177) y
    no descuenta de lo ya devuelto en RMA.

## Empresa activa

Todas las pantallas de esta épica siguen la **empresa activa** de la barra superior.

- El **filtro Tienda** hereda la empresa activa: al cambiarla, la pantalla se vuelve a montar, la
  paginación vuelve a la **página 1**, el filtro de forma vuelve a **Todas** y se descartan las filas y
  el total de la empresa anterior.
- Si hay un **diálogo abierto** (Nueva devolución o resolución) al cambiar de empresa, **se cierra con
  aviso** y no se guarda nada de la tienda anterior: «Cambiaste de tienda: cerramos la devolución que
  estabas cargando…».
- El alta y la resolución validan el permiso **en la empresa del comprobante/RMA**, no en la activa.

## Matriz pantalla↔criterios

Prototipo: `VentasDevoluciones.dc.html`. Lo que la épica no pidió se declara fuera de alcance.

| Ítem visible | Dueño |
|---|---|
| Título «Devoluciones (RMA)» y subtítulo | FR-004 |
| Entrada de menú «Devoluciones» (grupo Ventas) y «Acceso restringido» sin Ventas | FR-004 |
| Tabla: RMA, Tienda, Comprobante, Cliente, Producto, Forma de RMA, Motivo / operador, Estado | FR-006, FR-007 |
| Chips de forma y de estado con su tono | FR-003, FR-012 |
| Filtro Tienda (`FiltroEmpresa`) y su texto de ayuda | FR-008 |
| Filtro Forma de RMA (chips «Todas» + las cinco) y contador «N devoluciones» | FR-010 |
| Vacío «Sin devoluciones» y «No hay registros con esa forma de RMA.» | FR-007 |
| Paginación «1–8 de N» | FR-007 |
| Botón «Nueva devolución» y diálogo con Comprobante / Ítem / Forma / Motivo / Observaciones / Cancelar / Registrar devolución | FR-005 |
| Campo **Cantidad** del diálogo (no está en el prototipo) | FR-005 |
| Aviso «Devolución registrada · {forma}» | FR-005 |
| Acción de avance de estado (no está en el prototipo) | FR-011, FR-012 |
| Acciones y diálogos de resolución: «Emitir nota de crédito» y «Reingresar stock» (no están en el prototipo) | FR-021, FR-022 |
| Vínculo visible a la nota de crédito y al reingreso | FR-023 |
| Pestañas Pagos / Faltantes / Transportes y contrarreembolsos | **FUERA DE ALCANCE** — MSF-195, MSF-135 y MSF-139 |
| Buscador por RMA/comprobante/cliente/producto | **FUERA DE ALCANCE** en la UI; la RPC lo admite |
| Caso con proveedor (estados, responsable, plazos) | **FUERA DE ALCANCE** — se lleva en Observaciones |
| **Empresa activa** | FR-008 |

## Permisos

| Acción | Requisito | Quién en la matriz inicial |
|---|---|---|
| Ver el listado y el estado | `ventas` ≥ lectura en la empresa | Todos los roles con Ventas |
| Registrar una devolución | `ventas` en edición en la empresa del comprobante | Administrador, Administración, Operador, Mostrador |
| Avanzar el estado | `ventas` en edición en la empresa del RMA | Los mismos |
| Emitir la nota de crédito | acción `emitir_nota_credito` de Ventas en la empresa del RMA (la UI además exige edición) | Administrador, Administración |
| Reingresar stock | `ventas` en edición **y** `stock` en edición en la empresa del RMA | Administrador y Operador (Administración y Mostrador tienen Stock en lectura; Depósito tiene Ventas en lectura) |

No se agregan acciones nuevas a `permisos_rol_accion`: la épica reutiliza las que ya existen. Detalle:
[Permisos por rol](../permisos-por-rol.md).

## Límites y decisiones abiertas

- **Hito**: el roadmap ubica «Devoluciones RMA y faltantes con aviso» en **diciembre** (ola 3); el documento
  del componente la mandaba a Etapa 2. Manda el roadmap para el alcance, con las etiquetas
  `alcance-diciembre` y `revisar-roadmap` hasta que el cliente confirme.
- **Tres estados, no dos**: el prototipo dibuja Abierta/Cerrada; la épica agrega **En gestión** porque lo
  define el documento del componente.
- **Mapeo forma → resolución propuesto** (nota para importe; stock para las físicas): a confirmar con el
  cliente.
- **El seguimiento con proveedor no es un flujo**: durante las primeras semanas se lleva en las
  **Observaciones** del RMA. No hay caso con proveedor, responsable ni plazos.
- **Las formas no se editan desde el panel**: son un `check` de la base y un catálogo del frontend.
- **Un ítem por devolución en la pantalla**: la RPC acepta varias líneas; la UI manda una.
- **Sin buscador en la pantalla**: la búsqueda existe en la RPC, no en la interfaz.
- **La resolución y el avance de estado no están en el prototipo**: se agregaron con el kit y se anotaron
  en el PR.
- **Nota y reingreso son excluyentes**: no se puede cerrar el mismo RMA por las dos vías.
- **El cierre manual no impide resolver**: un RMA cerrado a mano y sin vínculo todavía puede resolverse;
  la resolución lo deja cerrado y con su nota o su reingreso.
- **Una nota de crédito emitida aparte no descuenta de lo devuelto**: el tope por línea cuenta solo los
  ítems de RMA previos, no las notas de «Devolución de productos» emitidas desde el comprobante.
- **El reingreso no elige depósito**: va al depósito de origen de la línea (la RPC admite otro, la UI no).
- **La empresa del RMA manda**: el permiso no se hereda de la empresa activa.

## Fuera de alcance de esta épica

Caso con proveedor (reparación, plazos, responsable), edición del catálogo de formas, buscador en la
pantalla, resolución conjunta por nota y stock, aviso al cliente, integración con Service técnico,
devoluciones de Mercado Libre y edición de la línea original de la factura. La nota de crédito de
devolución de productos sigue siendo de MSF-177.

## Cómo probarlo

### Prerrequisitos

- **Entorno:** stack local con la rama de la épica (`pnpm dev:supabase` + `pnpm dev`, panel en
  `http://localhost:5173`) o el ambiente **DEV** con la épica desplegada.
- **Personas y permisos**, en la organización de prueba:
  - **Administrador** con **Ventas en edición**, la acción `emitir_nota_credito` y **Stock en edición**:
    registra, sigue y resuelve por las dos vías. Para la nota alcanza con **Administración** (Ventas en
    edición + `emitir_nota_credito`); para el reingreso, un **Operador** (Ventas y Stock en edición).
  - Una persona con **Ventas en lectura** (por ejemplo Depósito o Consulta): solo ve el listado.
  - Opcional: una segunda persona con edición para probar el **conflicto** de estado.
- **Datos a sembrar:**
  - Dos **empresas** de la misma organización y un **cliente**.
  - Un **producto** con stock en el **depósito de origen** de la empresa.
  - Una **factura confirmada** con al menos una línea de **2 o más unidades** (se carga en
    [Ventas · comprobantes](ventas-comprobantes.md)).
  - La factura **no** debe estar anulada ni cubierta por una nota que agote lo acreditable.

### Pasos

1. **Abrir la pantalla.** Entrá al panel y abrí **Ventas › Devoluciones**. Se tiene que ver el título
   **Devoluciones (RMA)**, el subtítulo, el botón **Nueva devolución** (si tenés edición), el filtro
   **Tienda** y el filtro **Forma de RMA** con «Todas» y las cinco formas.
2. **Registrar una devolución.** Pulsá **Nueva devolución**. Elegí la **factura confirmada** en
   **Comprobante**, el **Ítem** de la línea, escribí **Cantidad** `1`, elegí **Enviado a proveedor**,
   escribí un **Motivo** («No enciende») y unas **Observaciones**, y pulsá **Registrar devolución**. Se
   tiene que ver el aviso **«Devolución registrada · Enviado a proveedor»**, el diálogo se cierra y el
   listado muestra el **RMA-0001** con su fecha, la tienda, el comprobante, el cliente, el producto
   `×1`, el chip **Enviado a proveedor**, el operador y el chip **Abierta**.
3. **Probar el tope de cantidad.** Abrí otra vez **Nueva devolución**, elegí la misma factura y la misma
   línea y escribí una **Cantidad mayor que lo que queda por devolver**. Al registrar, la pantalla
   muestra el mensaje de la base («No podés devolver más de lo vendido: de X quedan Y por devolver») y
   **no** se crea un RMA nuevo.
4. **Probar el filtro por forma.** Con el RMA del paso 2, pulsá **Todas** y después **Faltante en
   envío** (una forma sin registros): se tiene que ver el vacío **«Sin devoluciones · No hay registros
   con esa forma de RMA.»**. Volvé a **Todas** y comprobá que el contador dice **«1 devolución»**.
5. **Seguir el caso.** En la fila del RMA, pulsá **Pasar a En gestión**. Se tiene que ver el aviso
   **«Devolución RMA-0001 · En gestión»** y el chip **En gestión**. Después pulsá **Cerrar**: el chip
   pasa a **Cerrada** y la acción queda **deshabilitada**.
6. **Resolver con stock.** Creá un segundo RMA con forma **Cambio directo**. En su fila pulsá
   **Reingresar stock**, leé la confirmación (los productos vuelven al depósito de origen con motivo
   «Devolución») y confirmá. Se tiene que ver el aviso **«Devolución RMA-0002 · stock reingresado»**, el
   chip **Cerrada** y, en la columna Forma de RMA, el texto **Stock reingresado**. En **Stock ›
   Movimientos** tiene que aparecer una **entrada** por la cantidad del ítem, con motivo **Devolución** y
   la nota **RMA-0002**, en el depósito de origen.
7. **Resolver con nota de crédito.** Creá un tercer RMA con forma **Devolución de importe**. En su fila
   pulsá **Emitir nota de crédito**, escribí un **importe sin IVA** (por ejemplo `100`) y un **concepto**,
   y confirmá. Se tiene que ver el aviso **«Devolución RMA-0003 · nota de crédito emitida y vinculada»**,
   el chip **Cerrada** y, en la columna Forma de RMA, el enlace **«Nota de crédito {número}»**. Al abrir
   el enlace se ve la nota asociada a la factura; la acción de reingreso ya no se ofrece para ese RMA.
8. **Probar la exclusión.** En el RMA resuelto con nota, comprobá que **no** hay acción **Reingresar
   stock**; en el resuelto con stock, que **no** hay **Emitir nota de crédito**.
9. **Probar el conflicto de estado.** Abrí el panel en dos sesiones con edición. En la primera, pasá un
   RMA de **Abierta** a **En gestión**. En la segunda, que tenía el listado viejo, intentá avanzarlo: la
   pantalla avisa que **otra persona lo modificó**, recarga el listado y no pisa el cambio.
10. **Probar la empresa activa.** Abrí **Nueva devolución**, cargá un comprobante y una forma, y **cambiá
    la empresa activa** en la barra superior: el diálogo se **cierra con aviso** y no guarda nada. En el
    listado, al cambiar de empresa se recarga todo, la paginación vuelve a la **página 1**, el filtro de
    forma vuelve a **Todas** y no quedan filas de la empresa anterior.
11. **Probar solo lectura.** Entrá con una persona con **Ventas en lectura** y sin acciones: ve el
    listado, los chips y los vínculos, pero **no** ve «Nueva devolución», ni las acciones de avance, ni
    las de resolución.

### Resultado esperado

- **Given** una factura confirmada con una línea de N unidades, **When** se registra un RMA por una
  cantidad entre 1 y lo aún no devuelto, **Then** queda un `RMA-####` con su ítem, su forma, su motivo y
  su operador; con una cantidad mayor, se rechaza sin crear nada.
- **Given** un RMA **Abierta**, **When** se avanza el estado, **Then** pasa por **En gestión** y
  **Cerrada**, sin saltos, con el evento de quién y cuándo; reintentar el mismo estado no duplica nada.
- **Given** un RMA **Devolución de importe**, **When** se emite la nota de crédito, **Then** la nota queda
  vinculada, el RMA queda **Cerrada** y el vínculo se ve en el listado; no se puede además reingresar.
- **Given** un RMA de una forma física, **When** se reingresa el stock, **Then** se crea una entrada por
  ítem en el depósito de origen con motivo **Devolución** y nota **RMA-####**, y el RMA queda **Cerrada**.
- **Given** dos empresas activas distintas, **When** se cambia de empresa con un diálogo abierto, **Then**
  el diálogo se cierra con aviso, no se guarda nada de la anterior y el listado se recarga sin sus filas.

### Cómo automatizarlo

| Recorrido | Test E2E | Rótulo | Estado |
|---|---|---|---|
| Alta de RMA y listado con su número e ítem | `apps/web/e2e/ventas-rma.e2e.ts` | `[MSF-288:T009]` | **Existe**. Usa el stack local y se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (no corre en el CI público). |
| Filtro por forma y avance Abierta → En gestión → Cerrada | `apps/web/e2e/ventas-rma.e2e.ts` | `[MSF-304:T014]` | **Existe** con las mismas condiciones. |
| Resolución con nota de crédito y reingreso de stock | `apps/web/e2e/ventas-rma.e2e.ts` (a agregar) | `[MSF-320:T020]` | **Pendiente de automatizar**: F-VTA-30 se validó con pgTAP y Vitest, no con E2E. |

Los rótulos siguen la convención `[MSF-<historia>:T0yy]` de `docs/e2e-app.md` y los usa
`pnpm cobertura:e2e`. El alta y el seguimiento usan los de sus historias (MSF-288 y MSF-304); el recorrido
de resolución de MSF-320 queda como deuda de automatización.

## Pendientes

| Qué falta | Por qué | Dueño |
|---|---|---|
| **E2E de resolución** (nota de crédito y reingreso) | F-VTA-30 validó con pgTAP (`rma_nota_stock.test.sql`) y Vitest (`devoluciones.nota.test.tsx`); no hay test E2E con rótulo. Propuesto: `[MSF-320:T020]` | responsable de plataforma (cierre de MSF-320) |
| **Confirmar el mapeo forma → mecanismo** | Es una propuesta de la spec (*Decisiones abiertas* 6); si cambia, se ajusta la RPC, no la estructura | Producto / cliente |
| **Caso con proveedor** (estados, responsable, plazos) | Hoy se lleva en las **Observaciones**; no es un flujo de la épica | Producto |
| **Pantalla de resolución en el prototipo** | Las acciones de nota y reingreso no están dibujadas; se hicieron con el kit | Producto / diseño |
| **Buscador en la pantalla** | La RPC `listar_rma` lo admite; la UI no lo expone | Producto / plataforma |

## Estado

Implementado en la rama de la épica con sus tres historias y el cierre (F-VTA-28/MSF-288, F-VTA-29/MSF-304,
F-VTA-30/MSF-320 y cierre MSF-573), **pendiente de merge a `main`**. La fuente funcional es
`specs/20261027-100000-ventas-rma-devoluciones/spec.md`; las pruebas están en
`supabase/tests/database/rma_alta.test.sql`, `rma_seguimiento.test.sql` y `rma_nota_stock.test.sql`, en
`apps/web/src/pages/ventas/devoluciones.test.tsx`, `devoluciones.seguimiento.test.tsx` y
`devoluciones.nota.test.tsx`, y en `apps/web/e2e/ventas-rma.e2e.ts`.

## Para seguir

- **[Ventas · devoluciones (RMA), técnico](../tecnico/ventas-rma-devoluciones.md)** — tablas, RPC, permisos,
  pruebas y reversión.
- **[Ventas · comprobantes (producto)](ventas-comprobantes.md)** — cómo se carga y confirma la factura.
- **[Ventas · listado, estados y anulación (producto)](ventas-listado-estados-y-anulacion.md)** — la nota de
  crédito que reutiliza la resolución.
- **[Permisos por rol](../permisos-por-rol.md)** — secciones, niveles y acciones.
- **[Stock](../stock.md)** — depósitos y movimientos del reingreso.
