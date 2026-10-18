# Feature Specification: Stock · Stock único y alertas

**Feature Branch**: `epic/MSF-231-stock-stock-unico-y-alertas`

**Jira Epic**: MSF-231 — Stock · Stock único y alertas (spec `stock-unico-y-alertas`)

**Created**: 2026-10-18

**Status**: Ready for implementation — la especificación viene completa desde Jira. Los puntos de «A revisar» se resolvieron al traducir y figuran en *Decisiones* (uno queda para el OK de Nicolás).

**Delivery scope**: `refine` (apps/web) y `supabase` (migraciones + pgTAP). Sin `kestra`, `superset` ni `workers`.

**Prioridad / Hito**: P0 · Hito 2 (2 al 20 de noviembre de 2026) · 23 h (la fuente indica 23 h; las tallas L+M suman 24 h, se mantiene 23 h) · alcance diciembre.

**Dependencias**:
- Bloqueada por: MSF-136 (Stock movimientos: `existencias`, `movimientos_stock` y `registrar_movimiento_stock`). Ya está en `main`.
- Bloquea a: MSF-292 (Stock depósitos y reservas) y MSF-368 (Stock carga, exportación y avisos), y a épicas de otros componentes que lo declaran en su propio texto.
- Relacionada, sin bloqueo: MSF-123 (Mercado Libre · ventas y envío de stock) consumirá el evento `stock.actualizado` en Etapa 2 y se construye contra el contrato de esta spec. Las tiendas públicas (Hito 3) leen existencias por la vista pública (no se construye acá).

**Input**: Epic MSF-231. Objetivo: «Al terminar, el stock es el mismo para todas las empresas y canales aunque haya operaciones simultáneas, cada cambio queda listo para propagarse a otros canales, y el equipo ve en una sola pantalla las existencias, qué falta y qué está por faltar.»

**Regla de fuentes** (literal de la épica):
- Comportamiento y datos: mandan los requisitos y escenarios de esta spec.
- Qué se ve (disposición, textos, estados, popups, flujos): el prototipo validado es la referencia visual y hay que ser lo más fiel posible (no se exige idéntico al pixel; lo que aún no se construye o queda fuera de alcance se anota, no se omite).
- Cómo se construye (componentes, estilos y patrones): mandan el template y el sistema de diseño (MSF-117, `docs/sistema-de-diseno.md`). No se copia HTML ni CSS.
- El prototipo muestra más que esta historia: se implementa solo lo que piden los requisitos de F-STK-04 y F-STK-01.
- Si algo no se puede igualar: lo más cercano, sin inventar, anotando la diferencia en el PR. Si prototipo y requisitos se contradicen: requisitos para el comportamiento, prototipo para lo visual, y la contradicción queda anotada en el PR.
- Prototipo (solo lectura, ya presente en el árbol: `design/pantallas/Stock.dc.html`; la rama `design/prototipo` no existe en `origin` hoy): artboard «Stock actual (Local y Depósito)».

## Modelo y supuestos

- **Stock único por organización**, compartido entre empresas y canales: un producto tiene una sola cantidad en `dominio.existencias` (MSF-136). Hay uno o más depósitos por organización (hoy uno solo) sobre ese stock único; esta épica **no** modela depósitos.
- **La única vía de escritura** de cantidad es `public.registrar_movimiento_stock` (MSF-136), que ya serializa por producto (`select … for update`) y rechaza el saldo negativo (disparador F-STK-06). Esta épica no la reemplaza: la **verifica bajo concurrencia real** y le cuelga el evento.
- **El envío de stock a Mercado Libre (F-MLS-02) llega en Etapa 2**: en el Hito 2 solo se **emite** el evento `stock.actualizado` a una cola con reintentos; no hay consumidor, worker ni flow de Kestra.
- **La actualización en pantalla usa Supabase Realtime** (self-hosted; la constitución prohíbe asumir Supabase Cloud).
- **Permisos** (contrato vigente `private.nivel_seccion('stock')`): `lectura`/`edicion` ven el listado; `ninguno` no. No se cambia ningún permiso.

### Esquema de datos (Constitución, Principio VII)

| Objeto | Esquema | Justificación | RLS |
|--------|---------|---------------|-----|
| `cola_eventos` (nueva) | **`public`** | Infraestructura transversal de eventos de dominio de la plataforma (no es una entidad de negocio de Stock): la consumirán integraciones de otros componentes (MSF-123). Mismo criterio que `despachos_ejecucion`, la outbox del template, que vive en `public`. | Select solo del Administrador de la organización (`private.es_administrador_de`); **sin** políticas ni privilegios de escritura para `authenticated`; `anon` sin privilegios. La escribe solo el disparador. |
| `existencias` (existente, MSF-136) | **`dominio`** | Cantidad vigente: regla de negocio del producto. Esta épica solo la agrega a la publicación de Realtime; no se altera. | Ya tiene RLS por organización y `nivel_seccion('stock')`; Realtime la aplica a cada suscriptor. |
| `movimientos_stock` (existente) | **`dominio`** | Libro de movimientos. Solo se le agrega un disparador `AFTER INSERT`. | Sin cambios. |

La prueba pgTAP de aislamiento recorre `public` + `dominio` y debe seguir verde con la tabla nueva. El esquema de cada tabla se re-verifica en spec, plan, tareas, implementación y revisión (tarea de cierre).

## Navegación y patrones del panel (Principio VI)

- **Sin pantalla nueva ni ruta nueva**: el listado ya existe en `/stock` (pestaña «Stock actual», ítem Stock de la navegación, MSF-136). Esta épica lo hace «en vivo» y verifica sus alertas. F-STK-04 no tiene pantalla.
- Audiencia y contexto: organización activa (`ContextoOrganizacionActiva`), igual que hoy. Sin rutas anteriores que mantener.
- Estados compartidos de carga, vacío, error y éxito; teclado, lector de pantalla y 320 / 768 / 1440 px; sin UUID visible. **La actualización en vivo no mueve el foco ni borra la búsqueda, el filtro o la página.** La suscripción no pesa en el recorrido principal: vive en la página de Stock, ya cargada de forma diferida.

## Decisiones tomadas al traducir («A revisar»)

1. **Orden resuelto (stock por depósito, reservado, disponible)**: el listado muestra el **total**. Las columnas por depósito, Reservado y Disponible las agrega F-STK-14 (MSF-292). Fuera de alcance acá.
2. **Outbox del template**: el relevamiento se confirmó contra el código. `public.despachos_ejecucion` exige `ejecucion_id uuid not null unique` hacia `ejecuciones_worker`: está atada a órdenes de ejecución de worker y **no admite eventos de dominio sin consumidor**. Por eso F-STK-04 crea una cola propia `public.cola_eventos` con **el mismo modelo** (estados `pendiente / reclamada / completada / agotada`, reclamo exclusivo, lease, reintentos con espera, error sanitizado) y su propia función de reclamo y resolución. En consecuencia **F-STK-04 se mantiene en talla L** (no baja a M). **Aprobado por Nicolás (2026-10-18): OK a crear la cola propia `cola_eventos`.**
3. **Realtime**: la épica dice que F-STK-01 y F-STK-04 lo usan. Como F-STK-04 no tiene pantalla, **toda la pieza Realtime (publicación + suscripción + refresco del listado) tiene un único dueño: F-STK-01**. Así las dos historias son independientes y corren en paralelo.
4. **Dónde se emite el evento**: disparador `AFTER INSERT` sobre `dominio.movimientos_stock` (cada cambio de cantidad es un movimiento, MSF-136 FR-002), en la **misma transacción** que el cambio; una salida rechazada no deja evento. Cuando MSF-292 amplíe la RPC, el evento sigue saliendo del libro.
5. **Mínimo**: definir el stock mínimo no cambia la cantidad → no emite `stock.actualizado`.
6. **Tiendas públicas / vista pública** (Hito 3): supuesto de la épica; no se construye acá.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Stock único y consistente entre canales (F-STK-04, P0, L)

Como equipo que vende por varias empresas y canales, necesito que el stock sea uno solo y no se desincronice aunque varias personas operen a la vez, y que cada cambio quede listo para avisarse a otros canales.

**Why this priority**: sin esto, dos ventas simultáneas pueden vender lo que no hay, y Mercado Libre (Etapa 2) no tendría de dónde enterarse de los cambios.

**Independent Test**: prueba de concurrencia contra Supabase local (20 salidas simultáneas) + pgTAP de la cola; no necesita pantalla.

**Acceptance Scenarios**:
1. **Given** un producto con stock 10, **When** 20 salidas de 1 unidad llegan en simultáneo, **Then** exactamente 10 quedan aceptadas, 10 se rechazan con «No hay stock suficiente», el stock queda en 0 y hay 10 movimientos y 10 eventos.
2. **Given** dos personas de la misma organización con distinta empresa activa, **When** consultan el mismo producto, **Then** ven la misma cantidad (hay una sola fila de existencias por producto).
3. **Given** una entrada, salida o ajuste aceptado, **When** se confirma la transacción, **Then** existe un evento `stock.actualizado` pendiente con producto, movimiento, cantidad resultante y diferencia; si la transacción se revierte, no hay evento.
4. **Given** una salida rechazada por falta de stock, **When** se revisa la cola, **Then** no hay evento.
5. **Given** un evento pendiente y ningún consumidor, **When** pasa el tiempo, **Then** el evento sigue pendiente, no se pierde y no bloquea ninguna operación de stock.
6. **Given** un consumidor futuro que reclama eventos, **When** dos reclaman a la vez, **Then** cada evento lo recibe uno solo; si no lo confirma antes de vencer su reclamo, vuelve a estar disponible; tras el máximo de intentos queda `agotada`.
7. **Given** una persona de otra organización o sin ser Administrador, **When** consulta la cola, **Then** no ve eventos ajenos; `anon` no accede.

### User Story 2 — Stock actual con alertas de reposición (F-STK-01, P0, M)

Como equipo, quiero ver en una sola pantalla las existencias, qué falta y qué está por faltar, y que se actualice sola cuando otra persona mueve stock.

**Why this priority**: es la vista diaria de reposición; hoy hay que recargar para ver lo que hizo otra sesión.

**Independent Test**: Vitest del listado y del refresco + E2E con dos sesiones.

**Acceptance Scenarios**:
1. **Given** productos con distintos estados, **When** abro `/stock`, **Then** veo por producto nombre, SKU, stock total, mínimo, estado (Sin stock / Stock bajo / Disponible) y último movimiento, con el total de productos.
2. **Given** productos sin stock o con stock bajo, **When** abro `/stock`, **Then** el resumen dice «N productos sin stock y M con stock bajo» y «Ver solo alertas» filtra a esos productos.
3. **Given** el listado, **When** busco por nombre o SKU o filtro por estado, **Then** la lista y el total reflejan el filtro.
4. **Given** el listado abierto con una búsqueda, un filtro y una página, **When** otra sesión registra un movimiento que cambia un producto, **Then** cantidad, estado, último movimiento y resumen se actualizan **sin recargar**, y la búsqueda, el filtro y la página siguen igual.
5. **Given** que se pierde la conexión en vivo, **When** la persona sigue usando la pantalla, **Then** el listado sigue funcionando con los últimos datos y puede recargarse a mano.
6. **Given** un rol `lectura`, **When** abro `/stock`, **Then** veo el listado en vivo sin botones de edición; con `ninguno` no accedo.
7. **Given** que cambio la empresa u organización activa, **When** se recarga el listado, **Then** la suscripción en vivo pasa a la organización nueva y no queda escuchando la anterior.

### Edge Cases

- Ráfaga de eventos Realtime (p. ej. 20 salidas seguidas): el listado se refresca agrupando (un refresco por tanda), no uno por evento.
- Dos movimientos del mismo producto en el mismo milisegundo: la clave de idempotencia es el id del movimiento; un reintento del disparador no duplica el evento.
- Producto con mínimo 0: pasa de «Disponible» a «Sin stock» directo (regla de `stock_estados`, MSF-136).
- Realtime caído al abrir la pantalla: se muestra el listado cargado por consulta normal (sin error bloqueante).

## Requirements *(mandatory)*

### Functional Requirements

**F-STK-04 — Stock único y consistente entre canales**
- **FR-001**: Hay una sola cantidad por producto y organización, compartida por todas las empresas y canales; ningún camino de la app escribe cantidad fuera de `registrar_movimiento_stock`.
- **FR-002**: Las operaciones simultáneas sobre un producto se serializan: ninguna se pierde ni deja el stock en negativo (20 salidas sobre stock 10 → 10 aceptadas, stock 0). Las rechazadas no dejan movimiento, evento ni actividad.
- **FR-003**: Cada cambio de cantidad aceptado genera, en la misma transacción, un evento de dominio `stock.actualizado` en la cola, con contrato `{organizacion_id, producto_id, movimiento_id, tipo_movimiento, cantidad, diferencia, ocurrido_en}`.
- **FR-004**: La cola es durable (`public.cola_eventos`), con estados `pendiente / reclamada / completada / agotada`, intentos, próximo intento, vencimiento del reclamo y último error sanitizado, y sin consumidor en el Hito 2 los eventos quedan `pendiente` sin bloquear la escritura de stock.
- **FR-005**: Reclamo exclusivo con lease, reintentos con espera creciente y paso a `agotada` tras el máximo de intentos; no se puede confirmar un intento vencido o reemplazado (mismo modelo que la outbox del template).
- **FR-006**: Idempotencia: un único evento por movimiento (clave = id del movimiento); reintentar no duplica.
- **FR-007**: La cola tiene RLS por organización (lectura solo Administrador), nada de escritura para `authenticated`, `anon` sin privilegios, y las funciones de reclamo/resolución no son ejecutables por `authenticated` ni `anon`.
- **FR-008**: El contrato del evento y la cola quedan documentados (`docs/stock-eventos.md`) para que MSF-123 se construya contra él.

**F-STK-01 — Stock actual con alertas de reposición**
- **FR-009**: `dominio.existencias` se publica en Supabase Realtime (self-hosted), aplicando la RLS de cada suscriptor.
- **FR-010**: Un hook de suscripción (`postgres_changes` sobre existencias de la organización activa) avisa cambios, se limpia al desmontar o cambiar de organización y tolera caídas de conexión sin romper la pantalla.
- **FR-011**: El listado `/stock` se refresca ante cada aviso (agrupando ráfagas) conservando búsqueda, filtro de estado y página, y sin mover el foco.
- **FR-012**: El listado muestra por producto nombre, SKU, **stock total**, mínimo, estado y último movimiento, y el total de productos (entregado por MSF-136; se confirma y completa si falta algo).
- **FR-013**: El resumen de reposición «N productos sin stock y M con stock bajo» y el botón «Ver solo alertas» funcionan sobre toda la organización (no solo la página visible).
- **FR-014**: La búsqueda por nombre o SKU y el filtro por estado (Todos / Sin stock / Stock bajo / Disponible) funcionan y actualizan el total.
- **FR-015**: Permisos sin cambios: `lectura` ve el listado (en vivo) sin botones de edición, `edicion` además registra movimientos y edita el mínimo, `ninguno` no accede.

**Fuera de alcance (declarado)**: stock por depósito, Reservado y Disponible (F-STK-14 / MSF-292); estados «A pedido» y «Entrante en breve»; Faltantes, Ingreso de mercadería, Depósitos de mercadería y Actualizar por Excel (otras historias o épicas); envío a Mercado Libre y cualquier consumidor del evento (Etapa 2, MSF-123); vista pública de existencias para tiendas (Hito 3); worker o flow de Kestra.

### Key Entities

- **Evento de stock (`cola_eventos`)**: tipo `stock.actualizado`, organización, clave de idempotencia (id del movimiento), carga con el contrato de FR-003, estado de despacho e intentos.
- **Existencia (`dominio.existencias`)**: una fila por producto; fuente única de la cantidad y de lo que ve el listado.

## Success Criteria *(mandatory)*

- **SC-001**: Prueba de concurrencia: 20 salidas simultáneas sobre un producto con stock 10 dejan exactamente 10 aceptadas, stock 0, 10 movimientos y 10 eventos; dos sesiones de empresas distintas ven la misma cantidad.
- **SC-002**: Hay un evento `stock.actualizado` por cada movimiento aceptado y ninguno por uno rechazado o revertido; el mínimo no emite.
- **SC-003**: La cola cumple reclamo exclusivo, vencimiento del lease, reintento con espera, agotamiento y rechazo de confirmaciones vencidas (pgTAP).
- **SC-004**: E2E con dos sesiones: lo que registra una se ve en la otra sin recargar, con el resumen de alertas actualizado.
- **SC-005**: Aislamiento: `cola_eventos` pasa `rls_en_toda_tabla` y `aislamiento_organizaciones`; otra organización o un no Administrador no ve eventos; `anon` sin acceso.
- **SC-006**: El listado muestra el resumen de alertas y los filtros funcionan (Vitest).
- **SC-007**: `existencias` está en la publicación de Realtime y un suscriptor de otra organización no recibe sus cambios (pgTAP).
- **SC-008**: Ráfaga de avisos → un refresco por tanda, con filtros conservados y sin fugas de suscripción (Vitest).

## Matriz pantalla↔criterios

Inventario determinista con `pnpm prototipo:inventario` sobre `Stock.dc.html` (`design/pantallas/Stock.inventory.json`, coincide con el generado). «MSF-136» = ya entregado por esa épica y sin cambios acá; se lista para que ningún elemento visible quede sin dueño.

| Ítem del inventario | Destino | Criterio |
|---------------------|---------|----------|
| Tabla, columna `Producto` | En alcance | FR-012, US2-1 |
| Tabla, columna `Stock` (total) | En alcance | FR-012, US2-1, FR-011 |
| Tabla, columna `Reservado` | **Fuera de alcance** — lo crea F-STK-14 (MSF-292), bloqueada por esta épica | Decisión 1 |
| Tabla, columna `Disponible` | **Fuera de alcance** — F-STK-14 (MSF-292) | Decisión 1 |
| Tabla, columna `Mínimo` | En alcance | FR-012, US2-1 |
| Tabla, columna `Estado` | En alcance | FR-012, FR-014, US2-1/3 |
| Tabla, columna `Último movimiento` | En alcance | FR-012, FR-011, US2-1/4 |
| Tabla, columna de acciones (sin título; editar mínimo) | MSF-136 (F-STK-05); visibilidad por rol | FR-015, US2-6 |
| Campo `(buscar: Buscar por nombre o SKU)` | En alcance | FR-014, US2-3 |
| Botón `Ver solo alertas` (y su aviso «Necesitan reposición») | En alcance | FR-013, US2-2 |
| Botón `Nuevo movimiento` | MSF-136 (F-STK-02); visibilidad por rol | FR-015, US2-6 |
| Pestaña/botón `Stock actual` | En alcance (pestaña activa) | FR-012 |
| Pestaña/botón `Movimientos` | MSF-136 (F-STK-03) | — |
| Pestaña/botón `Ingreso de mercadería` y botón del encabezado `Ingreso de mercadería` | **Fuera de alcance** — otra historia de Stock; no la pide F-STK-01 ni F-STK-04 | Fuera de alcance |
| Pestaña/botón `Depósitos de mercadería` | **Fuera de alcance** — MSF-292 | Decisión 1 |
| Pestaña/botón `Faltantes` | **Fuera de alcance** — pantalla de otra historia (Ventas/Faltantes) | Fuera de alcance |
| Pestaña/botón `Actualizar por Excel` | **Fuera de alcance** — MSF-368 (carga y exportación) | Fuera de alcance |
| Chips de filtro de estado (`Todos`, `Sin stock`, `Stock bajo`, `Disponible`) | En alcance | FR-014, US2-3 |
| Chip de filtro `A pedido / entrante` y estados `A pedido`, `Entrante en breve` | **Fuera de alcance** — no están en los requisitos ni hay dato de origen | Fuera de alcance |
| Chips `Depósito de mercadería` | **Fuera de alcance** — MSF-292 | Decisión 1 |
| Diálogo `Registrar movimiento de stock` y sus campos `Producto`, `Tipo de movimiento`, `Fecha`, `Motivo`, `Nota (opcional)` | MSF-136 (F-STK-02) | — |
| Campos del diálogo `Depósito de mercadería` y `Tienda o canal`; botones `Depósito principal`, `Local mostrador` | **Fuera de alcance** — MSF-292 | Decisión 1 |
| Botones del diálogo `Movimiento`, `Entrada`, `Salida`, `Ajuste`, `Cancelar`, `Registrar` | MSF-136 (F-STK-02/06) | — |
