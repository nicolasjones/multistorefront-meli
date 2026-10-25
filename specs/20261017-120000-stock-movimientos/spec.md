# Feature Specification: Stock · Stock movimientos

**Feature Branch**: `epic/MSF-136-stock-stock-movimientos`

**Componente**: Stock

**Jira Epic**: MSF-136 — Stock · Stock movimientos (spec `stock-movimientos`)

**Created**: 2026-10-17

**Status**: Ready for implementation — la especificación viene completa desde Jira. Los puntos de «A revisar» no bloquean; los que se resolvieron al traducir figuran en *Decisiones*.

**Delivery scope**: `refine` (apps/web) y `supabase` (migraciones + RPC + pgTAP). Sin `kestra`, `superset` ni `workers`.

**Prioridad / Hito**: P0 · Hito 2 (2 al 20 de noviembre de 2026) · 19 h (la fuente ya descuenta lo que reutiliza del template; las tallas M+M+S+S suman 24 h) · alcance diciembre.

**Dependencias**:
- Bloqueada por: MSF-125 (Acceso · Usuarios y roles: `private.nivel_seccion`) y MSF-138 (Acceso · Empresas: `registro_actividad`). Ambos ya están en `main`.
- **Bloqueo duro todavía sin link en Jira**: la épica de Catálogo `catalogo-alta-y-edicion` (MSF-456) crea `dominio.productos`, que es la clave foránea de `existencias.producto_id`. Hoy está en la rama `epic/MSF-456-catalogo-catalogo-alta-y-edicion` (migraciones `20261017120100…120300`) y **no en `main`**: la migración de F-STK-02 no se puede aplicar hasta que esa épica esté mergeada. Falta cargar el *Blocks* de MSF-456 hacia esta épica.
- Bloquea a: MSF-231 (Stock único y alertas) y MSF-131 (Stock lotes e inventario), y a épicas de otros componentes que lo declaran en su propio texto.
- Relacionada, sin bloqueo: MSF-292 (Stock depósitos y reservas amplía la RPC y las tablas de esta épica) y MSF-156 (Inicio: la tarjeta de alertas se arma contra la vista de estados `public.stock_estados` definida acá).

**Input**: Epic MSF-136. Objetivo: «Al terminar, el equipo puede registrar entradas, salidas y ajustes de cualquier producto, definir su mínimo, ver el historial completo e inmodificable de movimientos, y el sistema impide que el stock quede negativo.»

**Regla de fuentes** (literal de la épica):
- Comportamiento y datos: mandan los requisitos y escenarios de esta spec.
- Qué se ve (disposición, textos, estados, popups, flujos): el prototipo validado es la referencia visual y hay que ser lo más fiel posible (no se exige idéntico al pixel; lo que aún no se construye o queda fuera de alcance se anota, no se omite).
- Qué se ve (disposición, textos, estados, popups, flujos): el prototipo validado es referencia visual, no hace falta que quede idéntico.
- Cómo se construye (componentes, estilos y patrones): mandan el template y el sistema de diseño (MSF-117, `docs/sistema-de-diseno.md`). No se copia HTML ni CSS: se reproduce con los componentes del template y los tokens.
- El prototipo muestra más que esta historia: se implementa solo lo que piden los requisitos de F-STK-02, 03, 05 y 06.
- Si algo no se puede igualar: lo más cercano, sin inventar, anotando la diferencia en el PR. Si prototipo y requisitos se contradicen: requisitos para el comportamiento, prototipo para lo visual, y la contradicción queda anotada en el PR.
- Prototipos (solo lectura, ya presentes en el árbol de trabajo; la rama `design/prototipo` no existe en `origin` hoy): `design/pantallas/Stock.dc.html`, `StockNuevoMovimiento.dc.html`, `StockMovimientos.dc.html`, `Main.dc.html`.

## Modelo y supuestos

- **Stock único por organización**, compartido entre empresas. Un producto tiene una sola cantidad. No hay depósitos, reservas ni lotes en esta épica (MSF-292 y MSF-131).
- **Las existencias nacen en 0** al crear el producto (y se rellenan en 0 para los productos que ya existan).
- **Los movimientos no se editan ni se borran.** Una corrección es un movimiento nuevo (un ajuste).
- **Permisos** por sección: el **Operador edita** Stock; **Consulta lo ve en solo lectura**. Se resuelve con el contrato vigente `private.nivel_seccion('stock')` (`edicion` / `lectura` / `ninguno`), no con `puede_escribir()`.
- **Los motivos de movimiento los edita solo el Administrador.**
- **Tipos de movimiento**: `entrada` (suma), `salida` (resta) y `ajuste` (se informa el *stock contado* y el sistema registra la diferencia, como en el prototipo).
- El responsable y la fecha/hora del registro los pone el servidor, nunca el llamador.

### Esquema de datos (Constitución, Principio VII)

Los datos de stock son **dominio del producto** (entidades y reglas de negocio) → esquema **`dominio`**, nunca `public`. Las RPC se publican en `public` (patrón del repo) y son el único camino de escritura.

| Tabla | Esquema | Justificación | RLS |
|-------|---------|---------------|-----|
| `existencias` | **`dominio`** | Cantidad y mínimo de cada producto: regla de negocio del producto. | Select con `nivel_seccion('stock')` en `lectura`/`edicion`; **sin** políticas de escritura (solo las RPC). |
| `movimientos_stock` | **`dominio`** | Libro de movimientos: dominio. Solo de agregado. | Select igual que arriba; **sin** políticas de escritura; disparador de inmutabilidad (F-STK-03). |
| `motivos_movimiento` | **`dominio`** | Catálogo de motivos propio del negocio de stock (no es un mecanismo transversal). | Select con `lectura`/`edicion`; insert/update solo Administrador (`private.puede_escribir()`); sin DELETE (se desactivan). |

`public.registro_actividad` (plataforma, ya existe) recibe los eventos `stock.*`; no se altera. Todas las tablas nacen **sin privilegios para `anon`**; la prueba pgTAP de aislamiento recorre `public` + `dominio`. Se re-verifica el esquema de cada tabla en spec, plan, tareas, implementación y revisión (tarea de cierre).

## Navegación y patrones del panel (Principio VI)

- Ítem **Stock** en la navegación (icono de inventario del sistema de diseño), visible con `nivel_seccion('stock')` ≠ `ninguno`. Audiencia: la organización activa.
- Rutas canónicas: `/stock` (Stock actual), `/stock/movimientos` (Historial) y `/stock/motivos` (Motivos de movimiento; solo Administrador, dentro del ítem Stock, sin ítem propio). Pestañas «Stock actual · Movimientos» como en el prototipo. No hay rutas anteriores que mantener.
- Estados compartidos de carga, vacío, error y éxito; teclado, lector de pantalla y 320 / 768 / 1440 px; sin UUID visible (se muestran nombre y SKU del producto). Carga diferida del diálogo y del historial (no pesan en el recorrido principal).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Registrar un movimiento de stock (F-STK-02, P0, talla M)

Como persona con edición en Stock, quiero registrar una entrada, una salida o un ajuste de cualquier producto, para que el stock refleje la realidad.

**Why this priority**: sin movimientos no hay stock; es la base de las otras tres historias.

**Independent Test**: un Operador crea un producto (existencias en 0), carga una entrada de 10 y el stock pasa a 10; un usuario de Consulta ve el stock pero no puede registrar nada, ni por la interfaz ni llamando directo a la base.

**Acceptance Scenarios**:

1. **Given** un producto recién creado, **When** se consulta su stock, **Then** es 0.
2. **Given** un producto con stock 0, **When** el Operador registra una entrada de 10 con un motivo, **Then** el stock es 10, queda un movimiento con fecha, tipo, cantidad, saldo, motivo, nota y responsable, y se registra un evento `stock.*` en la actividad.
3. **Given** stock 10, **When** registra una salida de 4, **Then** el stock es 6.
4. **Given** stock 6, **When** registra un ajuste con stock contado 3, **Then** el stock es 3 y el movimiento guarda la diferencia (−3) y el saldo 3.
5. **Given** un usuario de Consulta, **When** abre Stock, **Then** ve las cantidades sin el botón «Nuevo movimiento», y una llamada directa a la RPC o una escritura directa a las tablas se rechaza.
6. **Given** dos organizaciones, **When** una registra movimientos, **Then** la otra no ve ni afecta esas existencias.
7. **Given** dos salidas simultáneas del mismo producto, **When** se confirman, **Then** ninguna se pierde y el saldo final es coherente con ambas.
8. **Given** el diálogo «Nuevo movimiento», **When** se elige tipo, producto, cantidad (o *stock contado* en ajuste), motivo, fecha y nota opcional, **Then** se muestra el stock resultante antes de confirmar y, al registrar, aparece la confirmación «Movimiento registrado».

### User Story 2 - Historial de movimientos (F-STK-03, P0, talla M)

Como persona con acceso a Stock (edición o lectura), quiero ver el historial completo de movimientos, para saber qué pasó con cada producto y quién lo hizo.

**Why this priority**: es la trazabilidad que hace confiable el stock.

**Independent Test**: tras tres movimientos de un producto, el historial muestra tres filas ordenadas por fecha descendente; ningún usuario (ni el Administrador) puede editar o borrar una fila.

**Acceptance Scenarios**:

1. **Given** movimientos de varios productos, **When** se abre `/stock/movimientos`, **Then** se listan paginados, del más reciente al más antiguo, con fecha, producto (nombre y SKU), tipo, motivo, nota, cantidad, saldo y responsable.
2. **Given** el historial, **When** se filtra por producto, **Then** solo se ven sus movimientos y el total acompaña a la paginación.
3. **Given** cualquier rol, **When** se intenta `update` o `delete` de un movimiento (por la API o SQL con el rol de la app), **Then** se rechaza y la fila queda intacta.
4. **Given** una organización sin movimientos, **When** se abre el historial, **Then** se ve el estado vacío del patrón compartido.
5. **Given** un usuario sin acceso a Stock (`ninguno`), **When** consulta, **Then** no recibe filas.

### User Story 3 - Stock mínimo y estados (F-STK-05, P0, talla S)

Como persona con edición en Stock, quiero definir el mínimo de cada producto y ver su estado, para reponer a tiempo.

**Why this priority**: habilita las alertas de reposición (Inicio y MSF-231).

**Independent Test**: se define mínimo 5 en un producto con stock 3 y el listado lo marca «Stock bajo»; con stock 0 es «Sin stock»; con stock 8 es «Disponible».

**Acceptance Scenarios**:

1. **Given** un producto, **When** el Operador define su mínimo (entero ≥ 0), **Then** queda guardado y se registra el evento de actividad.
2. **Given** cantidad y mínimo, **When** se calcula el estado, **Then**: cantidad = 0 → **Sin stock**; 0 < cantidad ≤ mínimo (con mínimo > 0) → **Stock bajo**; el resto → **Disponible**.
3. **Given** el listado de Stock, **When** se filtra por estado o se pulsa «Ver solo alertas», **Then** se muestran los productos sin stock y con stock bajo, con el resumen «N productos sin stock y M con stock bajo».
4. **Given** un usuario de Consulta, **When** abre el listado, **Then** ve mínimo y estado pero no puede editar el mínimo.
5. **Given** un valor inválido (negativo, decimal, vacío), **When** se guarda, **Then** se rechaza con un mensaje claro y no cambia nada.

### User Story 4 - Prevención de stock negativo (F-STK-06, P0, talla S)

Como responsable del stock, quiero que el sistema impida que una salida o un ajuste deje el stock en negativo, para que los números nunca sean imposibles.

**Why this priority**: es la regla de integridad central de la épica.

**Independent Test**: con stock 3, una salida de 5 se rechaza con «No hay stock suficiente»; el stock sigue en 3 y no queda movimiento ni evento.

**Acceptance Scenarios**:

1. **Given** stock 3, **When** se registra una salida de 5, **Then** se rechaza con el mensaje «No hay stock suficiente» y el detalle «Hay 3 unidades y la salida es de 5…», sin cambiar el stock ni crear movimiento ni evento.
2. **Given** el diálogo con cantidad mayor al stock, **When** se completa la cantidad, **Then** se muestra el aviso en el momento y «Registrar» queda deshabilitado.
3. **Given** una llamada directa a la base (RPC o SQL con el rol de la app) que dejaría el stock en negativo, **When** se ejecuta, **Then** se rechaza igual: la regla vive en la base, no solo en la interfaz.
4. **Given** dos salidas simultáneas que juntas superan el stock, **When** se confirman, **Then** solo una se acepta.

### Edge Cases

- Cantidad 0, negativa, decimal o vacía en entrada/salida → rechazada (en ajuste, el *stock contado* puede ser 0 pero no negativo).
- Ajuste que no cambia el stock (contado = actual) → se acepta y queda registrado con diferencia 0.
- Producto de otra organización o inexistente → error genérico, sin filtrar datos.
- Producto inactivo (Catálogo lo desactiva, no lo borra) → conserva su stock e historial; **no** se bloquea el movimiento (la épica no lo pide).
- Fecha: por defecto hoy; no se admite una fecha futura (el historial es lo ocurrido).
- Motivo desactivado → no se ofrece para movimientos nuevos, pero los movimientos viejos lo conservan.
- Doble clic en «Registrar» → un solo movimiento (envío deshabilitado mientras guarda).

## Requirements *(mandatory)*

### Functional Requirements

**F-STK-02 — Registrar un movimiento**

- **FR-001**: Al crear un producto, el sistema DEBE crear su fila de existencias con cantidad 0 en la misma transacción; para los productos ya existentes, una migración aditiva rellena las faltantes en 0.
- **FR-002**: El sistema DEBE permitir registrar un movimiento de tipo `entrada`, `salida` o `ajuste` de un producto mediante una RPC única (`public.registrar_movimiento_stock`) que actualiza la cantidad y escribe el movimiento (tipo, cantidad, diferencia, saldo resultante, motivo, nota, fecha) en una sola transacción.
- **FR-003**: En `entrada` y `salida` la cantidad DEBE ser un entero > 0; en `ajuste` se informa el stock contado (entero ≥ 0) y el sistema registra la diferencia contra la cantidad vigente.
- **FR-004**: La organización y el responsable (actor) los resuelve el servidor desde la sesión; nunca los envía el llamador. El stock es único por organización y compartido entre empresas (no lleva `empresa_id`).
- **FR-005**: La RPC DEBE exigir `nivel_seccion('stock') = 'edicion'`; las tablas `existencias` y `movimientos_stock` NO tienen privilegios ni políticas de escritura para `authenticated`, y `anon` no ejecuta la RPC ni accede a las tablas. La RPC lleva `revoke … from public, anon` y `grant execute … to authenticated`.
- **FR-006**: Cada movimiento DEBE registrar un evento `stock.entrada` / `stock.salida` / `stock.ajuste` en `registro_actividad` (en la misma transacción), con producto, cantidad y saldo, sin datos innecesarios.
- **FR-007**: Los motivos de movimiento viven en `dominio.motivos_movimiento` (nombre único por organización, tipo(s) de movimiento al que aplican, activo); solo el Administrador los crea o edita; todos los roles con acceso a Stock los leen; no se borran, se desactivan. Cada organización nace con motivos iniciales (p. ej. «Compra a proveedor», «Venta en local», «Conteo de inventario», «Devolución», «Rotura o pérdida») y las organizaciones existentes se rellenan.
- **FR-008**: Dos movimientos simultáneos del mismo producto DEBEN serializarse (bloqueo de la fila de existencias) sin perder ninguno.
- **FR-009**: La pantalla `/stock` DEBE listar los productos con su cantidad y ofrecer, a quien edita, «Nuevo movimiento» (también desde cada fila) con el diálogo del prototipo: producto, tipo (Entrada / Salida / Ajuste), cantidad o stock contado, fecha, motivo, nota opcional, vista previa del stock resultante y aviso «Responsable: … · se registra automáticamente con fecha y hora». Para Consulta, solo lectura.
- **FR-019**: Debe existir la pantalla `/stock/motivos` para que el Administrador cree, renombre, elija a qué tipos de movimiento aplica y active/desactive motivos (sin borrado), usando la escritura permitida por RLS de `dominio.motivos_movimiento` (FR-007) y los patrones compartidos (estados vacío/error/carga, teclado, 320/768/1440 px). Operador y Consulta no la ven ni pueden escribir; el diálogo de FR-009 solo ofrece motivos activos que aplican al tipo elegido.

**F-STK-03 — Historial**

- **FR-010**: La pantalla `/stock/movimientos` DEBE listar el historial de la organización ordenado por fecha descendente con: fecha, producto (nombre y SKU), tipo, motivo o comprobante/nota, cantidad, saldo y responsable (nombre visible, no identificador).
- **FR-011**: Los movimientos DEBEN ser inmodificables: no existen políticas ni privilegios de `update`/`delete` y un disparador rechaza cualquier `update`/`delete`, incluido el del propietario de la función que escribe.
- **FR-012**: La lectura se hace por una RPC de solo lectura (`public.listar_movimientos_stock`, *security invoker*) con paginación en servidor (tamaño con tope), total y filtro opcional por producto; respeta RLS por organización y `nivel_seccion('stock')` en `lectura`/`edicion`.

**F-STK-05 — Mínimo y estados**

- **FR-013**: El sistema DEBE permitir definir el mínimo de cada producto (entero ≥ 0, por defecto 0) mediante la RPC `public.definir_minimo_stock`, que exige `nivel_seccion('stock') = 'edicion'` y registra `stock.minimo`.
- **FR-014**: El sistema DEBE exponer la vista `public.stock_estados` (*security_invoker*) con producto, cantidad, mínimo, **estado** (`sin_stock` / `stock_bajo` / `disponible`) y fecha del último movimiento; es el contrato que consume la tarjeta de alertas de Inicio (MSF-156) y MSF-231.
- **FR-015**: El listado `/stock` DEBE mostrar mínimo, estado y último movimiento; filtrar por estado; buscar por nombre o SKU; mostrar el resumen de reposición y «Ver solo alertas»; y permitir editar el mínimo a quien tiene edición.

**F-STK-06 — Prevención de stock negativo**

- **FR-016**: La cantidad de existencias NO PUEDE ser negativa: la base lo garantiza con una restricción `check (cantidad >= 0)` más un disparador que rechaza con el mensaje «No hay stock suficiente» (con la cantidad vigente y la pedida en el detalle), también ante llamadas directas y concurrencia.
- **FR-017**: Un movimiento rechazado no deja rastro: ni cambio de cantidad, ni fila en `movimientos_stock`, ni evento de actividad.
- **FR-018**: El diálogo DEBE mostrar el aviso «No hay stock suficiente» con la explicación apenas la cantidad supera el stock y deshabilitar «Registrar»; si el servidor igual rechaza (carrera), muestra el mismo mensaje y deja reintentar.

### Fuera de alcance / no objetivos

- Depósitos, reservas, «Reservado/Disponible», «A pedido»/«Entrante en breve» (MSF-292), lotes e inventario (MSF-131), stock único y alertas avanzadas (MSF-231).
- Del prototipo: tienda/canal del movimiento, selector de depósito Local/Depósito, «Ingreso de mercadería», «Faltantes», «Actualizar por Excel», exportar, y todo el tablero analítico de `StockMovimientos` (ventas por tienda, gráficos, cobertura, inicial/entradas/devoluciones) — son de otras historias; solo se toma la tabla de detalle de movimientos.
- Devoluciones como tipo propio, anulación de movimientos y edición de cantidades (el historial es inmodificable).
- La tarjeta de alertas de Inicio (MSF-156).

## Decisiones (traducción de «A revisar»; ninguna bloquea)

1. **Catálogo sin link**: se declara el bloqueo duro por `dominio.productos` (MSF-456). La migración de F-STK-02 se escribe contra el esquema de esa épica y se aplica cuando esté mergeada; pendiente cargar el *Blocks* en Jira.
2. **Horas**: se mantienen 19 h; ninguna historia queda cubierta por el template (el dominio de stock no existe en él).
3. **Roles**: no se usa `puede_escribir()` (solo administrador/miembro); se usa `nivel_seccion('stock')` (MSF-125). La matriz inicial ya trae la sección `stock`.
4. **Auditoría**: los eventos `stock.*` usan `private.registrar_actividad` de `registro_actividad` (MSF-138).
5. **Paginación**: el template no la trae; F-STK-03 la implementa en servidor (patrón del listado de Clientes). El listado de Stock (F-STK-05) filtra y busca sobre la vista; su paginación queda para MSF-231 si el catálogo lo requiere.
6. **Definición de «Stock bajo»**: cantidad ≤ mínimo con mínimo > 0 (supuesto derivado del prototipo; **confirmado por Nicolás el 2026-10-17**).
7. **Motivos**: ninguna otra historia de la épica ni del componente trae la pantalla de motivos; por indicación de Nicolás (2026-10-17: «si está en otra historia sí, sino hay que agregarla») se agrega a F-STK-02 como FR-019 (`/stock/motivos`, solo Administrador). No se crea una historia nueva.
8. **Verificación de la épica**: E2E (crear producto, entrada 10, salida 4, ajuste a 3 → stock 3 y tres filas; salida de 5 → «No hay stock suficiente») y pgTAP (aislamiento entre dos organizaciones y rechazo de escritura directa).

## Success Criteria

- **SC-001**: flujo E2E de la épica: producto → entrada 10 → salida 4 → ajuste a 3 → stock 3 y tres filas en el historial; salida de 5 → «No hay stock suficiente» (Playwright si MSF-499 existe; si no, Vitest + pgTAP con desvío trazado).
- **SC-002**: pgTAP: aislamiento entre dos organizaciones y rechazo de escritura directa sobre `existencias`, `movimientos_stock` y `motivos_movimiento` (salvo Administrador en motivos); `anon` sin acceso.
- **SC-003**: pgTAP: ningún `update`/`delete` sobre `movimientos_stock` prospera con ningún rol.
- **SC-004**: pgTAP + Vitest: los tres estados se calculan bien en los bordes (0, igual al mínimo, mínimo 0).
- **SC-005**: pgTAP + Vitest: una salida mayor al stock se rechaza sin rastro; dos salidas simultáneas no pasan juntas.
- **SC-006**: Consulta ve Stock e historial sin poder registrar, definir mínimo ni escribir directo (Vitest + pgTAP).

## Matriz de trazabilidad Jira ↔ US ↔ FR/SC ↔ tareas

| Jira | Historia | FR / SC | Tareas |
|------|----------|---------|--------|
| F-STK-02 | US1 Registrar un movimiento | FR-001…009, FR-019, SC-002, SC-006 | T001–T006, T025–T026 |
| F-STK-03 | US2 Historial de movimientos | FR-010…012, SC-003 | T007–T010 |
| F-STK-05 | US3 Stock mínimo y estados | FR-013…015, SC-004 | T011–T015 |
| F-STK-06 | US4 Prevención de stock negativo | FR-016…018, SC-005 | T016–T019 |
| Tarea de cierre (label `cierre`) | Integración, docs, seguridad y roadmap | SC-001 | T020–T024 |
