---
owner: producto
sources:
  - specs
  - design/pantallas
---

# Service técnico: repuestos y stock (MSF-217)

Épica **MSF-217 · Service técnico · Service repuestos y stock**. Historias: **F-SVC-10** (repuestos que descuentan
stock del depósito elegido, MSF-390), **F-SVC-11** (devolución al quitar ítems o anular, MSF-402) y **F-SVC-12**
(aviso de repuesto sin stock, MSF-412), más el cierre de la épica (MSF-575). Spec:
`specs/20261028-100000-service-repuestos-y-stock/spec.md`. Implementación en la rama
`epic/MSF-217-service-tecnico-service-repuestos-y-stoc` (PR #509), **pendiente de merge a `main`** al momento de
esta página. Detalle técnico: [Service técnico: repuestos y stock](../tecnico/service-repuestos-y-stock.md).

Hasta ahora (MSF-182, MSF-199) los repuestos de una reparación eran un renglón informativo: se cargaban con
descripción y precio, sumaban al total al cliente y **no tocaban el stock**. Con esta épica, cada repuesto del
catálogo **descuenta del depósito de mercadería elegido** en el momento en que se carga, **vuelve al depósito** si
se quita o si se anula la reparación, y el taller puede **dejarlo pendiente** cuando no hay stock.

## Qué resuelve y para quién

| Persona | Qué puede hacer |
|---|---|
| **Técnico / mostrador** | Cargar un repuesto del catálogo eligiendo de qué depósito sale, ver el disponible antes de confirmar, quitar un repuesto y recuperar las unidades, y dejar el repuesto pendiente cuando falta mercadería. |
| **Administración** | Confiar en que el stock del depósito refleja lo que el taller usó, y ver en el listado qué reparaciones tienen repuestos pendientes de stock. |
| **Depósito** | Ver en el historial de movimientos las salidas y devoluciones del taller, con la reparación y el depósito de origen. |

El **Técnico no necesita permiso de Stock**: el descuento lo hace una función interna de la base, no el botón de
movimientos de Stock.

## Qué se ve

### Agregar un repuesto

En el detalle de la reparación, «Agregar repuesto» suma al diálogo el campo **«Depósito de mercadería de donde se
descuenta»**: botones segmentados con los **depósitos activos** de la organización, con el **depósito por defecto**
preseleccionado. Debajo, la nota **«Disponible en &lt;depósito&gt;: N u.»**; si la cantidad que se está por cargar
pasa lo disponible, la nota agrega **«(falta stock: pedí el repuesto al proveedor)»**.

- Si la organización **no tiene ningún depósito activo**, el diálogo avisa «No hay depósitos activos: pedile a un
  administrador que active uno».
- Al confirmar con stock suficiente, el repuesto queda cargado y el mensaje de éxito dice **«Repuesto agregado · se
  descuenta de &lt;depósito&gt;»**. El disponible de ese depósito baja en la cantidad cargada y los totales de la
  reparación se recalculan en la misma operación.
- Si **no alcanza**, el error es **«No hay stock suficiente»** y **no queda nada guardado**: ni ítem, ni movimiento
  de stock, ni cambio en los totales.
- Si la falta de stock se puede resolver más tarde, el diálogo ofrece **«Dejar pendiente»**: el repuesto se carga
  igual, **suma al total al cliente**, **no descuenta stock** y queda marcado **«Pendiente de stock»**. El mensaje
  de éxito pasa a ser «Repuesto agregado · queda pendiente de stock».
- Un **repuesto libre** (sin producto del catálogo) y la **mano de obra** no mueven stock: la columna de depósito
  muestra «—». Lo mismo con un producto **«a pedido»** (se pide al proveedor).

La tabla de repuestos suma la columna **DEPÓSITO DE MERCADERÍA** con el depósito del que salió cada repuesto, y la
ayuda de la sección «Repuestos» aclara que **el descuento ocurre al agregar el repuesto**.

> **El prototipo y la épica no coinciden en ese punto.** El prototipo `design/pantallas/ServicioReparacion.dc.html`
> dice «Se descuentan del depósito de mercadería elegido al marcar la reparación como Entregado»; la épica pide
> descontar **al agregar**, y así quedó implementado (spec, *Decisiones abiertas* 2). Manda la épica en el
> comportamiento y el prototipo en lo visual.

### Quitar un repuesto

La confirmación de quitar avisa **«Las unidades vuelven al depósito del que se descontaron.»** cuando el repuesto
había descontado stock. Al confirmar, las unidades **vuelven al depósito original**, el ítem desaparece de la tabla
y los totales se recalculan. Si el repuesto estaba pendiente de stock o no movía stock, no se devuelve nada.

### Anular una reparación

El diálogo de anulación lista los **repuestos descontados** con una casilla por repuesto: **«Consumido, no se
devuelve»**. Por defecto **se devuelven todos**; el aviso del diálogo dice «Los repuestos descontados vuelven al
stock, salvo los que marques como consumidos».

- Al anular, cada repuesto descontado **vuelve a su depósito original** y queda marcado **«Devuelto»**.
- Los marcados como consumidos **no vuelven** al stock y quedan marcados **«Consumido»**.
- Una reparación **entregada** se puede anular como antes, pero **no devuelve stock** (sus ítems ya son de solo
  lectura) y no admite marcar consumidos.

### Listado de reparaciones

Las reparaciones con repuestos pendientes muestran el indicador **«Pendiente de stock»** bajo el estado, en la
tabla y en la tarjeta de móvil. El indicador desaparece cuando se quita el repuesto pendiente (o cuando la
reparación se anula o se entrega) y **no** se descuenta stock por estar pendiente.

## Empresa activa

La reparación pertenece a una tienda, así que el detalle no tiene selector propio: el almacén se lee en el
contexto de la reparación. Lo que sí cambia con la **empresa activa** de la barra superior es el **diálogo «Agregar
repuesto»**: si se cambia de empresa con el diálogo abierto, **se cierra con aviso** y, al reabrirlo, vuelve a
consultar la disponibilidad de los depósitos (spec FR-012). El indicador de pendientes del listado respeta el
filtro de empresa como el resto de las filas.

## Reglas que conviene tener a mano

| Situación | Qué pasa con el stock |
|---|---|
| Repuesto del catálogo, producto común, con stock | Descuenta del depósito elegido **al agregar**. |
| Repuesto del catálogo sin stock suficiente | No se guarda nada; se puede **dejar pendiente** (sin descuento). |
| Producto **«a pedido»** | No descuenta (la mercadería se pide al proveedor). |
| Repuesto **libre** (sin producto) y **mano de obra** | No mueven stock. |
| Se **quita** un repuesto descontado | Vuelve al depósito original, **una sola vez**. |
| Se **anula** la reparación | Vuelve todo lo descontado salvo lo marcado «Consumido, no se devuelve». |
| Repuesto **pendiente** | No descuenta ni devuelve: hay que quitarlo y volverlo a cargar cuando llega. |
| Repuestos cargados **antes** de esta épica | No se tocan: quedan sin movimiento (no hay retroactive). |
| **Stock negativo** | Sigue bloqueado: «No hay stock suficiente». La barrera es el **disponible** del depósito (cantidad − reservado). |

## Límites y fuera de alcance

| Tema | Estado |
|---|---|
| **Resolución automática de un pendiente** cuando entra la mercadería | Fuera de alcance: el pendiente no se descuenta solo. Hay que quitar el ítem y volverlo a cargar (spec, *Decisiones abiertas* 5). |
| **Filtro de pendientes** en el listado | Fuera de alcance: la épica pide el indicador, no un filtro (cambiaría el contrato del listado). |
| **Reserva** de stock en vez de descuento | Fuera de alcance: el descuento es inmediato, al agregar (es la decisión de la épica). |
| **Cobro y avisos al cliente** (F-SVC-13) | Fuera de alcance: es de MSF-232. El cobro ya no vuelve a descontar stock. |
| **Fotos, garantía, enlace de consulta y reportes** del seguimiento | Fuera de alcance: son de MSF-124 y no dependen del descuento de stock. |
| **Editar** un ítem ya cargado | Fuera de alcance: se quita y se vuelve a cargar (el mismo límite de MSF-199). |
| **Devolución a un depósito que hoy está inactivo** | La devolución va igual al depósito original (la mercadería vuelve físicamente ahí). Si el negocio prefiere otro destino, es un cambio en la base. |
| **Stock por empresa** | No aplica: el stock es único por organización y el depósito es de la organización (ver [Stock · depósitos y reservas](stock-depositos-y-reservas.md)). |

## Cómo probarlo

### Prerrequisitos

- **Entorno:** stack local con la rama de la épica (`pnpm dev:supabase` + `pnpm dev`, panel en
  `http://localhost:5173`) o el ambiente **DEV** con la épica desplegada. Rutas:
  `http://localhost:5173/service-tecnico/reparaciones` y el detalle de una reparación.
- **Personas y permisos** (en la organización de prueba):
  - **Técnico** (o cualquier rol) con **Service técnico en edición**: es el que carga, quita y anula.
  - Un rol con **Service técnico en lectura**: sirve para ver que no aparecen los botones.
  - **Administrador** de la organización: crea el depósito y el producto del catálogo.
- **Datos a sembrar**:
  - **Dos depósitos activos**: el que ya viene por defecto en cada organización («Depósito principal») y uno nuevo
    «Local», con el mismo producto del catálogo en ambos: 5 unidades en cada uno. El producto tiene que estar
    **activo** y **no** ser «a pedido».
  - Un **segundo producto** del catálogo **sin unidades** en ningún depósito (para probar la falta de stock).
  - Un **tercer producto «a pedido»** (para comprobar que no descuenta).
  - Una **reparación abierta** (estado que no cierre) con su cliente, equipo y modelo.

  Las unidades se cargan desde **Stock → Movimientos** con tipo *entrada* y motivo «Compra a proveedor» eligiendo
  el depósito (o por SQL sobre `dominio.existencias_deposito`).

### Pasos

1. **Agregar un repuesto con stock.** En el detalle de la reparación, pulsá **«Agregar repuesto»**, buscá el
   producto por **Nombre o SKU**, escribí la cantidad y el precio. Se tiene que ver el campo **«Depósito de
   mercadería de donde se descuenta»** con los dos depósitos y la nota **«Disponible en &lt;depósito&gt;: 5 u.»**.
2. **Elegir el depósito y confirmar.** Elegí «Local» y pulsá **«Agregar repuesto»**. Se tiene que ver el mensaje
   **«Repuesto agregado · se descuenta de Local»**, el repuesto en la tabla con **DEPÓSITO DE MERCADERÍA = Local**,
   y el disponible de «Local» bajado a 3 (lo se ve en **Stock → Stock actual** eligiendo ese depósito, o en
   **Stock → Movimientos** con la última salida).
3. **Probar el stock insuficiente.** Volvé a abrir «Agregar repuesto», buscá el producto **sin unidades**, elegí
   «Local» y confirmá. Se tiene que ver el aviso **«No hay stock suficiente»** (con el disponible) y **no** se tiene
   que ver ningún repuesto nuevo en la tabla ni ningún cambio en los totales.
4. **Dejar pendiente.** Con el mismo producto sin unidades y el depósito «Local», pulsá **«Dejar pendiente»**. Se
   tiene que ver el repuesto cargado, con la marca **«Pendiente de stock»** en su fila y su suma en el **Total al
   cliente**; el disponible de «Local» **no** cambia.
5. **Ver el indicador en el listado.** Volvé al listado de reparaciones: la reparación con el repuesto pendiente
   tiene que mostrar el indicador **«Pendiente de stock»**; las demás, no.
6. **Quitar el repuesto pendiente.** En el detalle, quitá el repuesto pendiente (confirmación). Se tiene que ver
   que desaparece de la tabla, que **no** se devuelve stock (el disponible de «Local» sigue en 3) y que el
   indicador del listado desaparece.
7. **Quitar un repuesto descontado.** Quitá el repuesto de «Local» del paso 2. En la confirmación se tiene que ver
   **«Las unidades vuelven al depósito del que se descontaron.»**; al confirmar, el disponible de «Local» vuelve a
   5 y los totales se recalculan.
8. **Probar la anulación con consumo.** Agregá **dos** repuestos de «Local» (2 unidades cada uno: el disponible de
   «Local» pasa de 5 a 1) y **anulá** la reparación con motivo. En el diálogo se tiene que ver la lista de
   repuestos descontados con la casilla **«Consumido, no se devuelve»** y el aviso de que el resto vuelve al stock.
   Marcá la casilla de uno de los dos y confirmá la anulación: ese repuesto tiene que quedar marcado **«Consumido»**
   y **no** volver al stock (el disponible de «Local» queda en 1); el otro vuelve a su depósito (el disponible de
   «Local» vuelve a 3) y queda marcado **«Devuelto»**.
9. **Probar que «a pedido» no descuenta.** Agregá el producto **«a pedido»**: se tiene que ver que se carga con
   **DEPÓSITO DE MERCADERÍA = «—»** y que el stock no cambia.
10. **Probar la concurrencia.** Con un producto que tenga **1 sola unidad**, dos personas cargan ese repuesto a la
    vez (dos ventanas o dos personas): **una** lo carga y la otra ve **«No hay stock suficiente»**. El disponible
    nunca queda negativo.
11. **Cambiar de empresa activa.** Con el diálogo «Agregar repuesto» abierto, cambiá la empresa en la barra
    superior: el diálogo tiene que **cerrarse con aviso**; al reabrirlo, la disponibilidad se consulta de nuevo.
12. **Ver el acceso restringido.** Entrá con **Service técnico en lectura**: se ve la reparación y sus ítems, pero
    sin los botones de agregar, quitar ni anular; la base también rechaza el intento (`42501`).

### Resultado esperado

- **Given** un repuesto del catálogo con stock en un depósito, **When** se lo carga eligiendo ese depósito,
  **Then** el ítem queda con ese depósito, el disponible baja en la cantidad y los totales se recalculan en la
  misma operación.
- **Given** un repuesto sin stock suficiente, **When** se confirma, **Then** se ve «No hay stock suficiente» y no
  queda ítem, movimiento ni cambio de totales.
- **Given** un repuesto sin stock y la opción «Dejar pendiente», **When** se confirma, **Then** el ítem se carga,
  suma al total al cliente, **no** descuenta stock y queda marcado «Pendiente de stock»; el listado lo señala.
- **Given** un repuesto descontado que se quita, **When** se confirma, **Then** las unidades vuelven **una sola vez**
  al depósito original y los totales se recalculan.
- **Given** una reparación anulada con repuestos descontados, **When** se anula marcando alguno como consumido,
  **Then** los no marcados vuelven al stock y quedan «Devuelto», y los marcados quedan «Consumido» sin volver.
- **Given** dos cargas simultáneas del último artículo, **When** ocurren a la vez, **Then** una gana y la otra ve
  «No hay stock suficiente»; el disponible nunca queda negativo.
- **Given** un producto «a pedido», un repuesto libre o mano de obra, **When** se cargan, **Then** no mueven stock.

### Cómo automatizarlo

**Existe un E2E de la épica**: `apps/web/e2e/service-repuestos-stock.e2e.ts` (rótulo `[MSF-575:T033]`, tarea de
cierre **T033** de `specs/20261028-100000-service-repuestos-y-stock/tasks.md`). Recorre por **API** (PostgREST con
la sesión de la persona) agregar un repuesto desde un depósito, comprobar que el otro depósito no se toca, que el
exceso se rechaza con «No hay stock suficiente», que **quitar** devuelve las unidades y que **anular** devuelve lo no
consumido. Se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (no corre en el CI público) y aborta si el
Supabase no es local.

Lo que **no** está automatizado es el **recorrido por la interfaz** de los pasos 1 a 12 (selector de depósito, botón
«Dejar pendiente», marcas en la fila, indicador del listado). Hoy eso está cubierto por **Vitest**
(`apps/web/src/components/service/ItemsReparacion.test.tsx`, `AnularDialog.test.tsx` y
`apps/web/src/pages/service-tecnico/reparaciones.test.tsx`) y por **pgTAP**
(`supabase/tests/database/service_repuestos_stock.test.sql`, `service_repuestos_concurrencia.test.sql`,
`service_repuestos_devolucion.test.sql`, `service_repuestos_anulacion.test.sql`,
`service_repuestos_pendiente.test.sql`), no por un E2E de navegador. Queda pendiente de automatizar con estos
rótulos:

| Recorrido | Test E2E propuesto | Rótulo |
|---|---|---|
| Selector de depósito con disponible, error de stock y «Dejar pendiente» en el diálogo | `apps/web/e2e/service-repuestos-stock.e2e.ts` | `[MSF-217:T012]` |
| Quitar un repuesto (confirmación de devolución) y anular marcando consumidos | `apps/web/e2e/service-repuestos-stock.e2e.ts` | `[MSF-217:T020]` |
| Indicador «Pendiente de stock» en el listado | `apps/web/e2e/service-repuestos-stock.e2e.ts` | `[MSF-217:T030]` |

## Pendientes con dueño

| Qué falta | Por qué | Dueño |
|---|---|---|
| **E2E de navegador** de los pasos 1 a 12 (el E2E de la épica va por API) | La épica validó con pgTAP y Vitest; el E2E existente no recorre la interfaz | responsable de plataforma (cierre de MSF-217) |
| **Rótulo del E2E**: hoy es `[MSF-575:T033]` y el manifiesto de cobertura lo resuelve por `**Jira Epic**:` del spec, que es **MSF-217** | Con el rótulo actual el E2E no se atribuye a la épica en `pnpm cobertura:e2e` | responsable de plataforma (cierre de MSF-217) |
| **Resolución del pendiente** cuando entra la mercadería | La épica lo deja como decisión 5: no hay descuento automático posterior | Producto / negocio |
| **Destino de la devolución** cuando el depósito original está inactivo | Hoy vuelve al depósito original (FR-026); si el negocio prefiere otro, hay que cambiar la base | Producto / Stock |
| **Filtro de pendientes** en el listado | La épica pide solo el indicador | Producto / Service técnico |
| **Estimación de F-SVC-10** (16 h por talla contra las 20 h de la épica) | La spec lo anota como diferencia a revisar al planificar la Etapa 2 | Producto / plataforma |

## Estado

Implementado en la rama de la épica con sus tres historias y el cierre, **pendiente de merge a `main`**. La fuente
funcional es `specs/20261028-100000-service-repuestos-y-stock/spec.md`; las migraciones están en
`supabase/migrations/20270114100100`–`20270114140200` (más las de las historias previas de Service y Stock, que
están en sus propias épicas) y las pruebas en `supabase/tests/database/service_repuestos_*.test.sql` y
`apps/web/src/components/service/ItemsReparacion.test.tsx`.

## Para seguir

- **[Service técnico: repuestos y stock (técnico)](../tecnico/service-repuestos-y-stock.md)** — modelo, RPC, libro
  de movimientos, permisos, pruebas y reversión.
- **[Service técnico: listado, ítems e impresión](service-listado-items-impresion.md)** — la pantalla donde viven
  los ítems (MSF-199).
- **[Stock · depósitos y reservas](stock-depositos-y-reservas.md)** — depósitos, disponible, traslados y reservas.
- **[Stock · movimientos, historial y mínimo](../stock.md)** — el libro donde aparecen las salidas de Service.
- **[Empresa activa](../empresa-activa.md)** — cómo se comporta el cambio de empresa en las pantallas.
