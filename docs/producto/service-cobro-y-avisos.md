---
owner: producto
sources:
  - specs
  - design/pantallas
  - supabase/migrations
  - apps/web/src
---

# Service técnico: cobro, avisos y ficha del cliente (MSF-232)

**Épica:** MSF-232 · Service técnico · Service cobro y avisos. **Historias:** F-SVC-13 «Cobro de la reparación
mediante un comprobante de Ventas» (MSF-418), F-SVC-14 «Notificación al cliente por cambio de estado» (MSF-424) y
F-SVC-15 «Vínculo con la ficha del cliente» (MSF-429), más el cierre MSF-576 (recorrido E2E).
**Spec:** `specs/20261028-100000-service-cobro-y-avisos/`. **Rama:**
`epic/MSF-232-service-tecnico-service-cobro-y-avisos`, **pendiente de merge a `main`**.
Detalle técnico: [Service técnico: cobro, avisos y ficha del cliente (técnico)](../tecnico/service-cobro-y-avisos.md).

Esta página explica **qué resuelve** la épica: una reparación **se cobra generando un comprobante de Ventas**
(sin volver a cargar los ítems a mano), el cliente **recibe un correo cuando cambia el estado** de su equipo y la
**ficha del cliente muestra su historial de reparaciones**.

Hasta ahora (MSF-199) el total al cliente se copiaba a mano a Ventas, con riesgo de doble ingreso y de error; el
cliente no se enteraba del estado de su reparación salvo que alguien lo llamara; y el historial de reparaciones no
estaba en la ficha del cliente.

## Qué resuelve

- **Cobrar la reparación sin recargarla**: desde el detalle de la reparación se genera una **factura en borrador**
  de Ventas con una línea por ítem de mano de obra o repuesto. Después se confirma, se cobra y se anula en Ventas
  como cualquier otra factura.
- **Que el cliente se entere solo**: al cambiar el estado de la reparación se puede **avisar al cliente por correo**
  (tienda, número, equipo y estado nuevo con su descripción). El aviso **no bloquea** el cambio de estado: si el
  correo falla, el estado queda cambiado igual.
- **Ver el historial del cliente**: la ficha del cliente gana una pestaña **«Reparaciones»** con sus reparaciones,
  paginadas y filtradas por la tienda de la empresa activa.

## Para quién

| Persona | Qué hace con esta entrega |
|---|---|
| **Técnico / mostrador** | Carga mano de obra y repuestos, genera el comprobante de la reparación desde el mismo detalle y avisa al cliente por correo al cambiar el estado. |
| **Administración / Ventas** | Confirma y cobra en Ventas el comprobante generado desde Service; ve el origen «Reparación R-000N» y el enlace de vuelta al detalle. |
| **Consulta** (lectura) | Ve el comprobante asociado (número, total y estado) y el historial de avisos, **sin** el botón «Generar comprobante», ni la casilla, ni «Reenviar». |
| **Cliente final** | No usa el panel: recibe el aviso por correo (si su ficha tiene correo cargado). |

## Cobro de la reparación con un comprobante de Ventas

En el detalle de la reparación (`/service-tecnico/reparaciones/:id`) el botón **«Generar comprobante»** aparece en la
sección **«Mano de obra y repuestos»**, junto al «Total al cliente».

- Se ofrece solo con **`service_tecnico` en edición** y **`ventas` en edición** en la tienda de la reparación, con
  al menos un ítem cargado, con la reparación **no anulada** y **sin** comprobante vigente.
- Genera una **factura en `borrador`** en la **tienda de la reparación** y con **su cliente**, con una línea por ítem
  (descripción, cantidad y precio sin IVA). El botón queda deshabilitado mientras genera («Generando comprobante…»)
  y un error se muestra al lado, sin tragarse en silencio.
- **Es idempotente**: si la reparación ya tiene un comprobante vigente, se devuelve ese, no se crea otro, y el botón
  deja de ofrecerse. Si dos personas pulsan a la vez, ambas ven el mismo comprobante.
- La tarjeta **«Comprobante asociado»** muestra **Número**, **Tipo**, **Estado** (Borrador / Pendiente / Cobrado /
  Deuda / Anulada, con las etiquetas del catálogo de Ventas), **Tienda** y **Total (con IVA)**, con el botón
  **«Abrir en Ventas»** (`/ventas/comprobantes/:id`) **solo si** la persona tiene acceso a Ventas en esa tienda. Con
  lectura en Service pero sin Ventas, se ven número, total y estado, pero no el enlace.
- En **Ventas**, el comprobante muestra **«Origen: Reparación R-000N»** con enlace al detalle de Service **solo si**
  la persona tiene acceso a Service; sin acceso, el texto aparece sin enlace.
- **Las líneas de Service no mueven stock**: se confirman, se cobran y se anulan sin sacar mercadería del depósito ni
  reservar. El descuento de repuestos del depósito es de [MSF-217](service-repuestos-y-stock.md) y no se duplica.
  En Ventas esas líneas se ven en solo lectura, con la marca «No descuenta stock».
- **El comprobante es una foto del momento**: si los ítems de la reparación cambian después, el comprobante no se
  resincroniza. Mientras esté en `borrador` se corrige en Ventas.
- **Anular** el comprobante libera la reparación: se puede generar uno nuevo y el anulado queda como historial.

!!! warning "Una decisión pendiente de confirmar con el cliente"
    Se genera una **factura**, no un presupuesto, y la **alícuota de IVA** de cada línea se resuelve con
    [Precios e IVA](precios-e-iva.md): la del producto del catálogo para un repuesto vinculado y la **alícuota
    general vigente** para mano de obra y repuestos libres. Es una decisión **provisoria** de la spec
    (*Decisiones abiertas* 1): si el taller factura sin IVA o con presupuesto, cambia solo la generación.

## Aviso al cliente por cambio de estado

El aviso es **por correo** (WhatsApp queda en el backlog, [MSF-118]). El cliente **puede no tener correo**: en ese
caso se avisa en pantalla y no se encola nada.

- La **casilla «Avisar al cliente»** aparece junto al selector de estado, **destildada por defecto** (no se manda un
  correo sin querer). Al confirmarse el cambio, el estado cambia **primero** y el aviso se pide **después**: si el
  aviso falla, el estado **no se revierte** y la pantalla informa «No pudimos avisar al cliente. El estado ya quedó
  cambiado: probá avisar de nuevo.»
- El botón **«Avisar al cliente»** del encabezado avisa el **estado actual** sin cambiarlo. Cuando el aviso queda
  encolado, la pantalla muestra **«Aviso enviado al cliente»**.
- Un cliente **sin correo** muestra el aviso **«El cliente no tiene correo»**: la casilla y el botón no encolan nada
  y el cambio de estado se guarda igual.
- La sección **«Avisos al cliente»** lista el historial, del más reciente al más antiguo: estado avisado, destinatario,
  fecha, **quién lo pidió** (nombre visible, nunca el correo de la persona) y el resultado (**Pendiente** /
  **Enviado** / **Fallido**, con un motivo corto si falló). Con el historial vacío la pantalla dice «Todavía no se
  avisó al cliente».
- **«Reenviar»** (solo con edición, en los avisos Enviados y Fallidos) crea un aviso **nuevo** del mismo estado con
  el **correo actual** del cliente. El doble clic es un solo aviso.
- El **correo** lleva tienda, número `R-000N`, equipo, **estado nuevo y su descripción** (por ejemplo, «Se avisa al
  cliente para que retire.»). **No lleva importes ni costos**, y los valores van escapados.
- El envío se hace **por la cola de trabajos**: reintenta **3 veces** y, si sigue fallando, el aviso queda
  **Fallido** con un motivo fijo (nunca el detalle técnico del SMTP). Si la organización no tiene habilitada la
  conexión de envíos, la pantalla avisa «El envío de avisos todavía no está habilitado para tu organización.
  Pedile a un administrador que lo active.» y no encola nada.

!!! note "El aviso nunca bloquea el cambio de estado"
    Es una regla de la épica: el cambio de estado va primero y el aviso se pide aparte. Un correo que falla no
    «deshace» la reparación ni la deja en un estado raro.

## La pestaña «Reparaciones» de la ficha del cliente

La ficha (`/clientes/show/:id`) queda con dos pestañas: **«Datos»** (todo lo que había antes, sin cambios) y
**«Reparaciones»** (la nueva). La segunda se carga al abrirla y **no aparece** si la persona no tiene acceso a
Service técnico; con lectura aparece, pero sin acciones de edición.

- La tabla muestra **Reparación** (`R-0238`, con enlace al detalle), **Tienda**, **Equipo** (con el modelo debajo),
  **Estado** (chip), **Ingreso**, **Entrega** y **Total** («A presupuestar» si es cero, «—» si falta un dato), más
  el contador **«N reparaciones»**.
- El orden es **de más reciente a más antigua** y la paginación es **en el servidor** (25 por página): el navegador
  nunca descarga todas las reparaciones.
- Un cliente sin reparaciones muestra el estado vacío **«Este cliente todavía no tiene reparaciones»**; con error,
  el patrón compartido con «Reintentar».
- Cada fila lleva al detalle `/service-tecnico/reparaciones/:id`. En escritorio es tabla y en móvil, tarjetas.

## Empresa activa

La pestaña **«Reparaciones»** respeta la **empresa activa** de la barra superior (Principio VIII):

- Con una tienda elegida se ven **solo** sus reparaciones; con «Todas» se ven todas las accesibles.
- Al **cambiar de empresa** la consulta se invalida y se recarga, la paginación vuelve a la **página 1** y **no**
  quedan filas de la empresa anterior.

El detalle de una reparación y su comprobante son de **una sola tienda** (la de la reparación): al cambiar la
empresa activa se recarga la consulta del comprobante y se descarta el de la tienda anterior.

## Permisos

| Acción | Sección | Quién |
|---|---|---|
| Generar el comprobante | `service_tecnico` ≥ edición **y** `ventas` ≥ edición en la tienda | Técnico/mostrador con Ventas |
| Ver el comprobante asociado (número, total, estado) | `service_tecnico` ≥ lectura | Todos los que ven la reparación |
| Enlace «Abrir en Ventas» | `ventas` ≥ lectura en la tienda | Con acceso a Ventas |
| Avisar al cliente (casilla, botón y «Reenviar») | `service_tecnico` ≥ edición | Técnico/mostrador |
| Ver el historial de avisos | `service_tecnico` ≥ lectura | Todos los que ven la reparación |
| Pestaña «Reparaciones» de la ficha | `service_tecnico` ≥ lectura | Con acceso a Service |

El servidor **vuelve a comprobar** los permisos: ocultar el botón no alcanza (la base rechaza con `42501`).

## Matriz pantalla↔criterios

Prototipos: `design/pantallas/ServicioReparacion.dc.html` y `design/pantallas/ClienteFicha.dc.html`
(inventarios generados con `pnpm prototipo:inventario`). «Ya entregado» = existe desde MSF-182 / MSF-199 y esta
épica no lo cambia. Lo que **no tiene artboard** lo pide la épica.

### Service técnico · Reparación (detalle)

| Ítem visible | Dueño |
|---|---|
| Tienda, Cliente, Contacto, equipo, Modelo, N.º de serie, Accesorios, Falla informada | ya entregado (MSF-182) |
| Técnico, Ingreso, Entrega prevista, Entrega real, botón «Guardar», «Reparaciones», «Imprimir orden», selector Estado e historial | ya entregado (MSF-182 / MSF-199) |
| Costo mano de obra y costo repuestos (tarjeta «Costo interno») | ya entregado (MSF-182) |
| Secciones «Mano de obra y repuestos» con sus diálogos y «Total al cliente» | ya entregado (MSF-199) |
| Botón **«Generar comprobante»** (junto al total) y tarjeta **«Comprobante asociado»** | FR-001, FR-004, FR-009 (sin artboard) |
| Casilla **«Avisar al cliente»** junto al cambio de estado | FR-028 (sin artboard) |
| Botón **«Avisar al cliente»** del encabezado y mensaje **«Aviso enviado al cliente»** | FR-028 (el botón sí está en el prototipo) |
| Sección **«Avisos al cliente»** con Pendiente / Enviado / Fallido y **«Reenviar»** | FR-026, FR-027 (sin artboard) |
| Aviso **«El cliente no tiene correo»** | FR-023 (sin artboard) |
| Campo «Depósito de mercadería de donde se descuenta» | **FUERA DE ALCANCE** — es de MSF-217; las líneas cobradas no mueven stock |
| Catálogo de servicios de mano de obra («·Sugerido ·», «Editar el catálogo de servicios →») | **FUERA DE ALCANCE** — ninguna historia de la épica lo pide |
| **Empresa activa** | FR-005, FR-021: las acciones operan sobre la tienda de la reparación y la base valida el acceso |

### Clientes · Ficha

| Ítem visible | Dueño |
|---|---|
| Todos los datos, botones y comprobantes de la ficha | ya entregado (MSF-180 / MSF-237), quedan en la pestaña «Datos» |
| Pestaña **«Reparaciones»** con su tabla y el contador | FR-041 (sin artboard: «falta dibujarla») |
| Estado vacío de la pestaña | FR-044 (sin artboard) |
| Paginación y orden | FR-042 |
| Fila → detalle de la reparación | FR-046 |
| Pestaña oculta sin acceso a Service | FR-045 |
| **Empresa activa** | FR-043 |

### Correo al cliente (sin artboard)

| Elemento | Dueño |
|---|---|
| Asunto, saludo, tienda, `R-000N`, equipo, estado y descripción | FR-024 (*Decisiones abiertas* 3) |
| Sin importes ni costos | FR-024, FR-090 |

## Cómo probarlo

### Prerrequisitos

- **Entorno:** un stack local con la rama de la épica (`pnpm dev:supabase` + `pnpm dev`, panel en
  `http://localhost:5173`) **con la conexión de envíos habilitada** en la organización (si no, el aviso no se
  encola), o el ambiente **DEV** con la épica desplegada. Para ver el correo, **Kestra + Mailpit** levantados y
  `E2E_CORREO_KESTRA=1` (ver «Cómo automatizarlo»).
- **Personas y permisos** (en la organización de prueba):
  - **Administrador** con `service_tecnico` en edición **y** `ventas` en edición en la tienda: ve «Generar
    comprobante», la casilla y «Reenviar».
  - **Técnico** con `service_tecnico` en **lectura** (y sin Ventas): ve la tarjeta «Comprobante asociado» (número,
    total y estado) y el historial de avisos, pero **no** el botón «Generar comprobante», ni el enlace «Abrir en
    Ventas», ni la casilla, ni «Reenviar».
- **Datos a sembrar:**
  - Una organización con **dos tiendas** (para probar el filtro por empresa activa).
  - Un **modelo de equipo** (el sembrado de Service trae siete) y los **estados** de reparación.
  - Un **cliente con correo** (para el aviso) y otro **sin correo** (para el aviso «El cliente no tiene correo»).
  - Una **reparación con dos ítems** (por ejemplo «Cambio de pantalla» a 1500,50 y «Pantalla de repuesto» a 8200):
    sin ítems el botón no se ofrece.
  - Una **reparación anulada** (para ver que no se puede cobrar).

### Pasos

1. **Abrir la reparación.** Entrá a `http://localhost:5173/service-tecnico/reparaciones` y abrí una reparación con
   dos ítems: se tiene que ver la sección «Mano de obra y repuestos» con el **Total al cliente** y, a la vista, el
   botón **«Generar comprobante»**.
2. **Sin permisos.** Repetí el paso 1 con la sesión de **Técnico en lectura**: el botón «Generar comprobante» **no**
   aparece y el total se sigue viendo.
3. **Generar el comprobante.** Con la sesión de **Administrador**, pulsá **«Generar comprobante»**: se tiene que ver
   el botón deshabilitado con «Generando comprobante…» y, apenas termina, la tarjeta **«Comprobante asociado»** con
   número, tipo «Factura», estado **Borrador**, la tienda y el total con IVA.
4. **El botón no se repite.** Recargá la página: el botón «Generar comprobante» **desapareció** (ya hay comprobante
   vigente) y la tarjeta sigue mostrando el mismo número.
5. **Ver el comprobante en Ventas.** Pulsá **«Abrir en Ventas»**: se abre `/ventas/comprobantes/:id` con la factura
   en borrador, **dos líneas** (una por ítem) marcadas **«No descuenta stock»** y con **«Sin depósito»**, y el texto
   **«Origen: Reparación R-000N»** con enlace al detalle de Service.
6. **Confirmar y cobrar.** En Ventas, confirmá la factura y cobrala: se tiene que ver el estado del comprobante
   (**Pendiente**, que es la factura confirmada, y luego **Cobrado**) y **ningún** movimiento de stock en el depósito.
   Volvé al detalle de la reparación: la tarjeta «Comprobante asociado» muestra el estado nuevo.
7. **Anular y volver a cobrar (opcional).** Anulá la factura en Ventas: la reparación vuelve a ofrecer «Generar
   comprobante» y el comprobante anulado queda en el historial de Ventas.
8. **Avisar al cliente.** Con la sesión de **Administrador**, en la misma reparación, pulsá el botón **«Avisar al
   cliente»** del encabezado: se tiene que ver el mensaje **«Aviso enviado al cliente»** y, en la sección **«Avisos al
   cliente»**, una fila con el estado avisado, el correo del cliente, la fecha, quién lo pidió y el resultado
   **Pendiente** (o **Enviado** si el flow ya corrió).
9. **Cambiar el estado con aviso.** Elegí otro estado en el selector y **tildá** la casilla **«Avisar al cliente»**
   (viene destildada): el estado cambia y aparece un aviso nuevo en el historial con ese estado. Con la casilla
   destildada, el estado cambia **sin** aviso nuevo.
10. **El aviso no bloquea el estado.** Con un cliente **sin correo**, la casilla «Avisar al cliente» aparece
    deshabilitada y el botón del encabezado no se ofrece; al cambiar el estado se tiene que ver el aviso **«El
    cliente no tiene correo»** en la sección «Avisos al cliente» y el estado **igual cambia**.
11. **Reenviar.** Con la sesión de **Administrador**, en un aviso **Fallido** o **Enviado**, pulsá **«Reenviar»**: se
    crea un aviso **nuevo** (fila nueva en el historial) con el correo actual del cliente. Con la sesión de
    **Técnico en lectura**, el botón «Reenviar» no aparece.
12. **Historial de avisos.** Revisá la sección «Avisos al cliente»: cada fila dice el estado avisado, el
    destinatario, la fecha, quién lo pidió y el resultado. Con un cliente sin avisos: «Todavía no se avisó al
    cliente».
13. **La ficha del cliente.** Abrí `http://localhost:5173/clientes/show/<id del cliente>`: la ficha tiene las pestañas
    **«Datos»** y **«Reparaciones»**. En «Reparaciones» se tiene que ver el contador («N reparaciones») y la tabla con
    **Reparación**, **Tienda**, **Equipo**, **Estado**, **Ingreso**, **Entrega** y **Total**; la fila lleva al detalle
    de la reparación.
14. **Sin acceso a Service.** Con una sesión sin `service_tecnico`, la ficha **no** muestra la pestaña
    «Reparaciones» y la de «Datos» sigue igual.
15. **Cambiar de empresa.** Con la pestaña «Reparaciones» abierta, cambiá la empresa activa en la barra superior: la
    tabla se recarga, la paginación vuelve a la **página 1** y **no** quedan filas de la tienda anterior.
16. **Cliente sin reparaciones.** Abrí la ficha de un cliente sin reparaciones: la pestaña «Reparaciones» muestra el
    vacío **«Este cliente todavía no tiene reparaciones»**.

### Resultado esperado

- **Given** una reparación con ítems y con permisos, **When** se pulsa «Generar comprobante», **Then** se crea una
  factura en borrador con el cliente y la tienda de la reparación, una línea por ítem y la tarjeta «Comprobante
  asociado»; al pulsarlo de nuevo no se crea un segundo comprobante.
- **Given** un comprobante generado desde Service, **When** se confirma y se cobra en Ventas, **Then** no se mueve
  ni se reserva stock y el estado se refleja en el detalle de la reparación.
- **Given** un cambio de estado con la casilla «Avisar al cliente» tildada y un cliente con correo, **When** se
  confirma, **Then** el estado cambia y queda un aviso encolado que el cliente recibe por correo con tienda,
  número, equipo y estado.
- **Given** un cliente sin correo, **When** se intenta avisar, **Then** se ve «El cliente no tiene correo», no se
  encola nada y el cambio de estado se guarda igual.
- **Given** un fallo al encolar o enviar el aviso, **When** se mira la reparación, **Then** el estado **no** se
  revierte y el error se informa sin bloquear.
- **Given** una ficha de cliente con reparaciones, **When** se abre la pestaña «Reparaciones», **Then** se ven sus
  reparaciones, de la más reciente a la más antigua, paginadas y filtradas por la empresa activa.

### Cómo automatizarlo

**Hoy hay un E2E de la épica**: `apps/web/e2e/service-cobro-avisos.e2e.ts` (cierre **MSF-576**, tarea **T032** de
MSF-232, rótulo en el archivo: `[MSF-576:T032]`). Recorre la reparación con dos ítems → «Generar comprobante» →
comprobante en borrador con las dos líneas `sin_stock` → confirmación y cobro → aviso al cliente (con la fila en el
historial y la orden en la outbox) → la reparación visible en la pestaña «Reparaciones» de la ficha. Se omite sin
`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (no corre en el CI público) y **no monta el correo**: con
`E2E_CORREO_KESTRA=1` (Kestra + Mailpit) además espera el correo recibido y verifica que **no** tenga importes.

Lo que **no** está automatizado (queda pendiente de automatizar):

| Recorrido | Test E2E propuesto | Rótulo |
|---|---|---|
| Correo recibido de verdad (Kestra + Mailpit) como recorrido propio | `e2e/service-cobro-avisos-correo.e2e.ts` (pendiente: hoy el E2E solo lo cubre con `E2E_CORREO_KESTRA=1`) | `[MSF-232:T032]` |
| Cliente **sin correo**: «El cliente no tiene correo» y el estado igual cambia | `e2e/service-avisos-sin-correo.e2e.ts` (pendiente) | `[MSF-232:T023]` |
| **Reenviar** un aviso fallido y el doble clic | `e2e/service-avisos-reenviar.e2e.ts` (pendiente) | `[MSF-232:T027]` |
| Pestaña «Reparaciones» con **cambio de empresa** y estado vacío, en navegador | `e2e/clientes-reparaciones.e2e.ts` (pendiente) | `[MSF-232:T028]` |

Por arriba de todo eso, la cobertura de la historia está en **pgTAP** (`service_cobro.test.sql`,
`service_cobro_stock.test.sql`, `service_avisos.test.sql`, `service_cliente_reparaciones.test.sql`), en **Vitest**
(`reparacion.comprobante.test.tsx`, `reparacion.avisos.test.tsx`, `comprobante.origen.test.tsx`,
`show.reparaciones.test.tsx`) y en la **prueba del flow** (`pnpm test:kestra:reparaciones-aviso`).

!!! warning "El rótulo del E2E todavía no ata el test a la épica"
    `pnpm cobertura:e2e` resuelve la épica por el rótulo `[EPICA:TASK]` **y** la línea `**Jira Epic**:` del `spec.md`.
    La spec de MSF-232 sí la declara, pero el archivo de test se rotula `[MSF-576:T032]` (la historia del cierre), así
    que el manifiesto lo deja como «épica desconocida». Corregir el rótulo a `[MSF-232:T032]` es del **cierre de la
    épica** (dueño: responsable de plataforma).

## Límites y decisiones abiertas

| Tema | Estado |
|---|---|
| Factura o presupuesto, y alícuota del IVA | **Provisorio**: factura en `borrador`; alícuota del producto para repuestos vinculados y alícuota general vigente para mano de obra y repuestos libres. A confirmar con el cliente (*Decisiones abiertas* 1). |
| Texto del correo (asunto y cuerpo) | **Provisorio**: «Tu reparación R-000N: <estado> · <tienda>» y un cuerpo con saludo, tienda, número, equipo, estado y su descripción (*Decisiones abiertas* 3). |
| Casilla «Avisar al cliente» destildada por defecto | **Provisorio** (*Decisiones abiertas* 4): no se manda un correo sin querer. |
| Nombre de la primera pestaña de la ficha («Datos») | **Provisorio** (*Decisiones abiertas* 5): el prototipo no dibuja pestañas. |
| Quién puede generar el comprobante | **Provisorio** (*Decisiones abiertas* 7): `service_tecnico` en edición **y** `ventas` en edición en la tienda. |
| Ítems que cambian después de generar el comprobante | El comprobante es una foto; **no** se resincroniza. Se corrige en Ventas mientras esté en borrador. |
| Reintentos y vencimiento | 3 reintentos del flow y luego `fallido` con «Reenviar»; sin cola nueva de espera creciente (*Decisiones abiertas* 6). |
| Entrega del correo | **Al menos una vez**: si Kestra se corta entre enviar y cerrar, el correo puede salir dos veces. |

## Fuera de alcance de esta épica

- **WhatsApp** u otro canal distinto del correo (backlog de la épica; lo extiende F-SVC-30 de MSF-118).
- **Centro de notificaciones** para el personal (F-NOT, MSF-224): no bloquea, es otra línea.
- **Resincronizar** el comprobante si cambian los ítems, y un **comprobante propio de Service**: el cobro se hace con
  Ventas.
- **Cobro y conciliación** de comprobantes: son de [Ventas · cobros y conciliación](ventas-cobros-y-conciliacion.md).
- **Otras pestañas de la ficha** (Comprobantes u otras) y los **KPIs del listado** (MSF-124).
- El **descuento de stock de los repuestos**: es de [MSF-217](service-repuestos-y-stock.md).

## Pendientes con dueño

| Qué falta | Por qué | Dueño |
|---|---|---|
| **Merge de la épica a `main`** | La implementación (migraciones, RPC, flow, pantallas y pruebas) está en la rama de la épica | responsable de plataforma (cierre de MSF-232) |
| **Rótulo del E2E** | El test se rotula `[MSF-576:T032]` y el manifiesto de cobertura no lo ata a MSF-232 | responsable de plataforma (cierre de MSF-232) |
| **Confirmar las decisiones provisorias** (factura vs. presupuesto, alícuota, texto del correo, casilla destildada, nombre de la pestaña, quién genera) | Son decisiones de la spec que el cliente tiene que confirmar | Producto (cliente) |
| **Artefacto del prototipo de la pestaña «Reparaciones»** | `ClienteFicha.dc.html` no la dibuja y el aviso tampoco tiene artboard | Producto / diseño |
| **E2E de navegador** del correo recibido, del cliente sin correo, del «Reenviar» y del cambio de empresa en la ficha | Hoy los cubre el E2E de la épica (parcial), pgTAP, Vitest y la prueba del flow | responsable de plataforma |

## Estado

Implementado en la rama `epic/MSF-232-service-tecnico-service-cobro-y-avisos` con sus tres historias (F-SVC-13 /
MSF-418, F-SVC-14 / MSF-424, F-SVC-15 / MSF-429) y el cierre (MSF-576), **pendiente de merge a `main`**. La fuente
funcional es `specs/20261028-100000-service-cobro-y-avisos/spec.md`; las pruebas están en
`supabase/tests/database/service_cobro*.test.sql`, `supabase/tests/database/service_avisos.test.sql`,
`supabase/tests/database/service_cliente_reparaciones.test.sql`, en `apps/web/src/pages/service-tecnico/*.test.tsx`,
en `apps/web/src/pages/clientes/show.reparaciones.test.tsx` y en `apps/web/e2e/service-cobro-avisos.e2e.ts`.

## Para seguir

- **[Service técnico: cobro, avisos y ficha del cliente (técnico)](../tecnico/service-cobro-y-avisos.md)** — modelo,
  RPC, flow de correo, pantallas y reversión.
- **[Service técnico: listado, ítems e impresión (producto)](service-listado-items-impresion.md)** — de dónde salen
  los ítems que se cobran.
- **[Ventas · comprobantes (producto)](ventas-comprobantes.md)** — cómo se confirma y se cobra la factura.
- **[Clientes (producto)](../clientes.md)** — la ficha del cliente.
