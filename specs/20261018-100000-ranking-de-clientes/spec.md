# Feature Specification: Clientes y proveedores · Ranking de clientes

**Feature Branch**: `epic/MSF-126-clientes-y-proveedores-ranking-de-client`

**Jira Epic**: MSF-126 — Clientes y proveedores · Ranking de clientes (spec `ranking-de-clientes`)

**Created**: 2026-10-18

**Status**: Ready for implementation — la especificación viene completa desde Jira. Los puntos de «A revisar» no bloquean: cada uno lleva una decisión provisoria en *Decisiones abiertas*.

**Delivery scope**: `refine` (apps/web) y `supabase` (migraciones + RPC + pgTAP). Sin `kestra`, `superset` ni `workers` (el ranking básico no usa Superset).

**Prioridad / Hito**: P0 · Hito 4 (30 de noviembre al 11 de diciembre de 2026) · 16 h (tallas 16 h; antes 20) · alcance diciembre.

**Dependencias**:
- Bloqueada por: MSF-180 (Clientes alta y búsqueda: tabla y ficha del cliente) — ya en `main` (`public.clientes`, `pages/clientes`, `lib/exportarClientes.ts`, acción `exportar`).
- Bloquea a: MSF-171 (Ranking avanzado de clientes).
- Relacionada, sin bloqueo: MSF-159 (Ventas · Ventas comprobantes) y MSF-177 (Ventas · Ventas listado, estados y anulación) emiten los documentos de venta que lee el ranking. Esta épica se construye contra el contrato de datos acordado abajo, con datos de ejemplo; **solo lee**.
- Dentro de la épica: F-CLI-08 bloquea a F-CLI-09 (el Excel usa la misma función del ranking).

**Input**: Epic MSF-126. Objetivo: «Al terminar, el administrador ve qué clientes facturan más en un rango de fechas, exporta el ranking a Excel y, desde la ficha de cada cliente, revisa sus compras.»

**Regla de fuentes** (literal de la épica):
- Comportamiento y datos: mandan los requisitos y escenarios de esta historia.
- Qué se ve (disposición, textos, estados, popups, flujos): el prototipo validado es la referencia visual y hay que ser lo más fiel posible (no se exige idéntico al pixel; lo que aún no se construye o queda fuera de alcance se anota, no se omite); los flujos (si hay) aclaran estados y acciones.
- Cómo se construye (componentes, estilos y patrones): mandan el template y el sistema de diseño (MSF-117, `docs/sistema-de-diseno.md`). No se copia HTML ni CSS: se reproduce con los componentes del template y los tokens.
- El prototipo muestra más que esta historia: se implementa solo lo que piden los requisitos de F-CLI-08…10.
- Si algo no se puede igualar: lo más cercano, sin inventar, anotando la diferencia en el PR. Si prototipo y requisitos se contradicen: requisitos para el comportamiento, prototipo para lo visual, y la contradicción queda anotada en el PR.
- Prototipos (solo lectura, presentes en el árbol de trabajo; la rama `design/prototipo` no existe en `origin` hoy): `design/pantallas/Clientes.dc.html` (solapa «Ranking por facturación»), `design/pantallas/VentasReportes.dc.html` (tercera tabla), `design/pantallas/ClienteFicha.dc.html` («Resumen comercial» y «Últimos comprobantes»).

## Modelo y supuestos

- **Facturación** = suma del total de las **facturas no anuladas** del cliente en el rango de fechas; los presupuestos no cuentan (a confirmar con Ventas).
- **El criterio de estados que cuentan** (por ejemplo, si «Deuda» cuenta) lo fija Ventas y se parametriza en **un solo lugar**: la función `ranking_clientes` (vía un predicado único, `private.comprobante_cuenta_como_facturado(tipo, estado)`). Ranking, Excel y ficha usan ese mismo predicado; cambiar el criterio es cambiar ese cuerpo.
- **Total sin IVA** por defecto, para ser coherente con el margen, con una **opción de verlo con IVA** (pregunta abierta, ver *Decisiones abiertas* 3).
- **Rango de fechas**: sobre la fecha de emisión del comprobante, extremos inclusivos, en la zona horaria de la organización (`America/Argentina/Buenos_Aires`).
- **Entrada oficial del ranking**: la solapa «Ranking por facturación» de **Clientes** (`/clientes`). El mismo ranking dibujado en Ventas · Reportes no se implementa aquí (ver *Decisiones abiertas* 1).
- **Esta épica solo lee los documentos de venta.** Como todavía no existe tabla de comprobantes en `main`, aquí se acuerda el contrato mínimo (abajo) y se materializa con la estructura mínima necesaria para leer y probar; Ventas (MSF-159/177) la completa con migraciones aditivas y escribe en ella.
- **Sin Superset** ni Kestra: el ranking básico es una consulta del servidor. La exportación a Excel **no existe en el template para rankings**: F-CLI-09 es nueva, pero reutiliza la librería (`write-excel-file`, MIT) y la neutralización de fórmulas que ya trajo MSF-180.

### Contrato de datos de venta (lo que lee esta épica)

`dominio.comprobantes_venta` — un documento de venta por fila.

| Columna | Tipo | Significado |
|---------|------|-------------|
| `id` | uuid | Identidad interna (nunca visible). |
| `organizacion_id` | uuid | Organización dueña (FK a `public.organizaciones`, `on delete cascade`). |
| `cliente_id` | uuid | Cliente comprador. FK compuesta `(cliente_id, organizacion_id)` → `public.clientes`: no puede apuntar a un cliente de otra organización. |
| `tipo` | text | Tipo de documento: `factura` o `presupuesto` (lista cerrada por ahora; Ventas la amplía). |
| `numero` | text | Número visible del comprobante (p. ej. `0003-00001251`). |
| `fecha` | date | Fecha de emisión. |
| `estado` | text | Estado del documento (p. ej. `emitida`, `cobrada`, `deuda`, `anulada`); el catálogo lo fija Ventas. |
| `total_sin_iva` | numeric(14,2) | Total neto sin IVA. |
| `total_con_iva` | numeric(14,2) | Total con IVA incluido. |

### Esquema de datos (Constitución, Principio VII)

| Tabla | Esquema | Justificación | RLS |
|-------|---------|---------------|-----|
| `comprobantes_venta` (**nueva**, F-CLI-08) | **`dominio`** | Documento de venta: entidad de negocio del producto, no plataforma. Vive en `dominio`, nunca en `public`. | **Sí**: `organizacion_id = (select private.organizacion_id())` y `select` con `private.nivel_seccion('ventas')` en `lectura`/`edicion`. Sin grants ni políticas de escritura para `authenticated` en esta épica (escribe Ventas, con su propia migración). `anon` sin acceso. |
| `clientes` (existente, MSF-180) | `public` (excepción ya documentada en la spec de MSF-180) | No se altera en esta épica. | Vigente. |

No se alteran otras tablas. Las funciones nuevas son de lectura. La prueba pgTAP `rls_en_toda_tabla` recorre `public` + `dominio` y debe seguir verde.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ranking de clientes por facturación (F-CLI-08, P0, talla M)

Como administrador, quiero ver qué clientes facturan más en un rango de fechas, para saber quiénes son mis mejores clientes.

**Why this priority**: es el objetivo de la épica; el Excel y la ficha parten de la misma lectura.

**Independent Test**: con facturas de ejemplo de tres clientes en dos meses, elegir «Este mes» devuelve solo los del mes, ordenados de mayor a menor facturado; las anuladas y los presupuestos no suman; el porcentaje de participación suma 100 %.

**Acceptance Scenarios**:

1. **Given** la pantalla Clientes, **Then** muestra dos solapas, «Listado» y «Ranking por facturación»; al abrir la solapa de ranking se ven los campos **Desde** y **Hasta**, el botón **Aplicar** y la tabla con columnas **#**, **Cliente**, **Tipo**, **Comprobantes**, **Facturado** y **Participación**. Por defecto el rango es «Este mes».
2. **Given** un rango válido, **When** se pulsa «Aplicar», **Then** la tabla lista los clientes con al menos un comprobante que cuenta en el rango, ordenados por **Facturado** descendente (desempate por nombre y luego por número de cliente), con la posición #.
3. **Given** el criterio de facturación, **Then** suman solo las facturas no anuladas; los presupuestos y los comprobantes anulados no suman ni cuentan en **Comprobantes**. El criterio exacto de estados vive en un único predicado (`private.comprobante_cuenta_como_facturado`).
4. **Given** el ranking, **Then** **Facturado** es la suma del total sin IVA en pesos con formato de moneda argentino (`$ 1.234.567`), **Comprobantes** es la cantidad de comprobantes que sumaron y **Participación** es el porcentaje del facturado del cliente sobre el total del ranking con los filtros aplicados (una decimal, coma decimal, p. ej. `12,5 %`), con una barra proporcional al primero.
5. **Given** los atajos de período, **Then** hay accesos directos **Este mes**, **Mes anterior**, **Últimos 90 días** y **Año en curso** que completan Desde/Hasta y aplican (el doc manda sobre los atajos del prototipo: Hoy, 7 días, Este mes, Mes anterior).
6. **Given** el filtro **Tipo de cliente** (Todos / Minorista / Mayorista), **Then** limita el ranking a ese tipo y la participación se recalcula sobre el subconjunto.
7. **Given** el interruptor **Consumidor final**, **Then** incluye o excluye al Consumidor final del ranking y de la participación (ver *Decisiones abiertas* 2 por el valor inicial).
8. **Given** la opción **Ver con IVA**, **When** se activa, **Then** Facturado y Participación se calculan sobre `total_con_iva`; apagada (por defecto) usa `total_sin_iva`. El rótulo de la columna indica cuál se está viendo.
9. **Given** Hasta anterior a Desde, o una fecha vacía o inválida, **Then** se indica el error en el campo y no se consulta. El rango máximo aceptado es de 5 años.
10. **Given** más clientes que una página, **Then** se pagina en el servidor (25 por página por defecto), con el total, conservando período y filtros al cambiar de página.
11. **Given** un rango sin facturas, **Then** se muestra el estado vacío compartido «Sin facturación en el período — Probá con otro rango de fechas.»; un error de consulta muestra el estado de error compartido con «Reintentar»; mientras consulta, el estado de carga compartido.
12. **Given** una persona con sección Clientes en `ninguno`, **Then** no ve la solapa ni puede leer el ranking llamando directo a la base; con `lectura` o `edicion` ve el ranking. Un usuario de otra organización no ve filas ajenas.
13. **Given** pantallas de 320, 768 y 1440 px, **Then** la solapa es utilizable (vista adaptable de tarjetas en angosto), con teclado y lector de pantalla (las solapas con `role="tablist"`, errores asociados al campo), sin identificadores técnicos visibles.
14. **Given** el contrato `dominio.comprobantes_venta` sin filas (Ventas todavía no emite), **Then** el ranking muestra el vacío y no falla.

---

### User Story 2 - Exportar el ranking a Excel (F-CLI-09, P0, talla S)

Como administrador, quiero exportar el ranking a Excel, para analizarlo o compartirlo fuera del panel.

**Independent Test**: con un período y filtros aplicados, «Exportar a Excel» descarga un `.xlsx` con **todas** las filas del ranking (no solo la página) igual a lo que muestra la pantalla; un rol sin la acción `exportar` no ve el botón.

**Acceptance Scenarios**:

1. **Given** el ranking aplicado, **When** quien tiene la acción `exportar` sobre Clientes pulsa **Exportar a Excel**, **Then** se descarga un `.xlsx` con todas las filas del ranking que coinciden con el período y los filtros vigentes (de todas las páginas), con las columnas #, Cliente, Tipo, Comprobantes, Facturado y Participación, y con el período y la base (sin/con IVA) indicados en el archivo.
2. **Given** que el Excel usa **la misma función del ranking** (`ranking_clientes`) que la pantalla, **Then** las filas y los totales del archivo coinciden con los de la pantalla para los mismos parámetros.
3. **Given** un rol sin la acción `exportar` (por defecto Mostrador, Depósito y Consulta), **Then** no ve el botón «Exportar a Excel».
4. **Given** la exportación en curso, **Then** el botón queda deshabilitado con indicación de progreso, con opción de cancelar; al terminar se confirma («Exportación lista») y si falla se muestra el error con reintento.
5. **Given** nombres con tildes o caracteres especiales, **Then** el archivo `.xlsx` se abre bien en Excel (una columna por campo, encabezados en la primera fila); las celdas de texto se guardan como texto y los valores que empiezan con `=`, `+`, `-` o `@` se neutralizan para evitar inyección de fórmulas (misma función `neutralizarFormula` que la exportación de clientes). Los importes y el porcentaje se escriben como números con formato.
6. **Given** un volumen grande, **Then** el archivo se arma por lotes sin bloquear la interfaz, con un tope documentado (el de la exportación de clientes: 100.000 filas).
7. **Given** un ranking vacío, **Then** el botón «Exportar a Excel» queda deshabilitado (no se descarga un archivo sin filas).

---

### User Story 3 - Historial de compras en la ficha del cliente (F-CLI-10, P0, talla S)

Como administrador, quiero revisar las compras de un cliente desde su ficha, para ver qué y cuánto compró.

**Independent Test**: abrir la ficha de un cliente con facturas de ejemplo muestra «Compras» con el total facturado del año en curso y el listado de sus comprobantes, el más reciente primero, paginado; un cliente sin compras muestra el vacío y $ 0.

**Acceptance Scenarios**:

1. **Given** la ficha de un cliente (`/clientes/show/:id`), **Then** muestra una sección **Compras** con **Resumen comercial** — el **total facturado del año en curso** (1 de enero al día de hoy, mismo criterio y misma base sin IVA que el ranking) — y **Últimos comprobantes** (el doc manda sobre el «Facturado en 12 meses» del prototipo).
2. **Given** el listado de compras, **Then** muestra por comprobante su número, fecha, estado y total, del más reciente al más antiguo, paginado en el servidor (10 por página por defecto), sin mostrar identificadores internos.
3. **Given** comprobantes anulados o presupuestos del cliente, **Then** se listan con su estado visible pero **no** suman al total facturado del año.
4. **Given** un cliente sin comprobantes, **Then** se muestra el estado vacío «Este cliente todavía no tiene compras.» y el total facturado del año en `$ 0`.
5. **Given** un error al consultar, **Then** se muestra el estado de error compartido con «Reintentar» sin afectar al resto de la ficha; mientras consulta, el estado de carga.
6. **Given** el Consumidor final, **Then** la sección Compras se muestra igual (es un cliente más para este historial).
7. **Given** una persona con sección Clientes en `ninguno` o un cliente de otra organización (id manipulado), **Then** la base no devuelve filas ni total (aislamiento por organización y sección, también llamando directo a la base).
8. **Given** 320, 768 y 1440 px, **Then** la sección es utilizable (tarjetas en angosto), con teclado y lector de pantalla.

---

### Edge Cases

- Cliente archivado: su facturación histórica sigue contando en el ranking y la ficha (el archivado no borra comprobantes).
- Comprobantes con `fecha` fuera del rango no suman; los extremos Desde y Hasta son inclusivos.
- Doble clic en «Aplicar» o en «Exportar a Excel»: el botón se deshabilita mientras consulta/exporta; las lecturas son idempotentes.
- Empate de facturado: desempata por nombre (sin distinguir mayúsculas) y luego por número de cliente, para que la paginación sea estable.
- Cambia el total mientras se pagina o se exporta (Ventas emite durante la lectura): la exportación por lotes usa el mismo período y, por ser paginada por posición, puede diferir de la pantalla por comprobantes emitidos en el medio; se documenta, no se bloquea.
- Total sin IVA o con IVA nulo en datos de ejemplo mal formados: la tabla de contrato los exige `not null` y mayores o iguales a 0.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** (F-CLI-08): DEBE existir `dominio.comprobantes_venta` con el contrato de columnas de *Contrato de datos de venta*, con FK compuesta a `public.clientes (id, organizacion_id)`, restricciones (`tipo` y totales válidos), índice `(organizacion_id, cliente_id, fecha desc)` y RLS por organización y sección `ventas` (solo `select`). Migración aditiva con reversión documentada.
- **FR-002** (F-CLI-08): DEBEN existir datos de ejemplo para probar el ranking y la ficha (seed local y fixtures pgTAP) sin depender de que Ventas emita; los datos de ejemplo nunca se cargan en producción.
- **FR-003** (F-CLI-08): DEBE existir `public.ranking_clientes(p_desde date, p_hasta date, p_tipo text default null, p_incluir_consumidor_final boolean default <ver Decisiones 2>, p_con_iva boolean default false, p_pagina integer default 1, p_tamano integer default 25)` que devuelve, por cliente, `posicion`, `cliente_id`, `numero`, `nombre`, `tipo`, `comprobantes`, `facturado`, `participacion` y `total_filas`; ordenado por `facturado` desc, nombre, número; paginado con tope de tamaño (1.000). Lo usan la pantalla y el Excel.
- **FR-004** (F-CLI-08): La función DEBE ser `security definer` con `search_path = ''`, tomar la organización de `private.organizacion_id()` (nunca del llamador) y exigir `private.nivel_seccion('clientes')` en `lectura` o `edicion`; con `ninguno` o sin sesión devuelve error de permiso. `revoke … from public, anon` y `grant execute … to authenticated`.
- **FR-005** (F-CLI-08): El criterio de qué comprobantes suman DEBE vivir en un único predicado (`private.comprobante_cuenta_como_facturado(tipo, estado)`): hoy `tipo = 'factura'` y `estado <> 'anulada'`. Es la **única** pieza que cambia cuando Ventas fije el criterio.
- **FR-006** (F-CLI-08): `participacion` DEBE ser `facturado / total del ranking filtrado` (0 si el total es 0), calculada en el servidor sobre el conjunto completo (no sobre la página).
- **FR-007** (F-CLI-08): La función DEBE validar parámetros en el servidor: `p_desde <= p_hasta`, rango máximo 5 años, `p_tipo` en (`minorista`, `mayorista`) o nulo, página ≥ 1, tamaño entre 1 y 1.000; error claro en caso contrario.
- **FR-008** (F-CLI-08): La pantalla DEBE agregar a `pages/clientes/list.tsx` las solapas «Listado» y «Ranking por facturación», con Desde, Hasta, Aplicar, los atajos (Este mes, Mes anterior, Últimos 90 días, Año en curso), el filtro por tipo de cliente, el interruptor de Consumidor final, la opción «Ver con IVA» y la tabla (#, Cliente, Tipo, Comprobantes, Facturado, Participación) con barra de participación, paginada en el servidor, con los patrones compartidos de carga, vacío, error y éxito.
- **FR-009** (F-CLI-08): La solapa «Ranking por facturación» DEBE ser visible solo con la sección Clientes en `lectura`/`edicion`, y la UI refleja el mismo contrato que la base (`SECCION_POR_RECURSO.clientes`). El nombre del cliente enlaza a su ficha.
- **FR-010** (F-CLI-09): «Exportar a Excel» DEBE generar un `.xlsx` real con **todas** las filas del ranking vigente llamando por lotes a la **misma** `ranking_clientes`, visible solo con `usePuedeAccion('clientes','exportar')`, con progreso y cancelación, hoja «Ranking de clientes», encabezados en la primera fila y el período/la base en el archivo.
- **FR-011** (F-CLI-09): Las celdas de texto del Excel DEBEN neutralizar `=`, `+`, `-`, `@` iniciales (reutiliza `neutralizarFormula`); la librería `write-excel-file` (MIT, ya dependencia de MSF-180) se carga de forma diferida solo al exportar.
- **FR-012** (F-CLI-10): DEBE existir `public.compras_de_cliente(p_cliente_id uuid, p_pagina integer default 1, p_tamano integer default 10)` que devuelve el total facturado del año en curso (`facturado_anio`, mismo predicado de FR-005 y total sin IVA) y los comprobantes del cliente (`numero`, `fecha`, `estado`, `tipo`, `total_sin_iva`, `total_filas`) del más reciente al más antiguo, paginados; `security definer` con `search_path = ''`, organización de `private.organizacion_id()`, sección `clientes` en `lectura`/`edicion`, cliente de otra organización → sin filas; `revoke … from public, anon` y `grant execute … to authenticated`.
- **FR-013** (F-CLI-10): `pages/clientes/show.tsx` DEBE mostrar la sección «Compras» con el resumen comercial (total facturado del año) y «Últimos comprobantes», con estados de carga/vacío/error compartidos, usable en 320/768/1440 px, teclado y lector de pantalla; los números de comprobante son texto (el enlace al comprobante es de Ventas).
- **FR-014** (F-CLI-08): El test pgTAP de ejecutabilidad por `anon` DEBE seguir verde con `ranking_clientes` (y, desde F-CLI-10, con `compras_de_cliente`: cada historia verifica sus propios `revoke … from public, anon` / `grant execute … to authenticated`).
- **FR-015** (F-CLI-08): La interfaz de la solapa de ranking DEBE usar el sistema de diseño (MSF-117) y los patrones compartidos, español de Argentina, sin identificadores técnicos visibles; la navegación (ítem «Clientes», ruta `/clientes`, `/clientes/show/:id`) no cambia: la solapa vive dentro de la pantalla existente y se carga de forma diferida (el peso inicial del listado no crece).
- **FR-016** (Cierre): Las migraciones de la épica DEBEN ser aditivas con reversión documentada en su encabezado y en esta spec; no se destruye nada en el mismo PR que lo crea. Esta épica **no** modifica `public.clientes`.

### Fuera de alcance / no objetivos

Aparece en el prototipo o en el doc pero es de otras historias o épicas y **no** se implementa aquí:
- Ranking avanzado de clientes (MSF-171).
- La copia del ranking en **Ventas · Reportes** (tabla «#, Cliente, Tipo, Comprobantes, Facturado, Participación» con filtro Tienda y desglose por tienda), «Más vendidos» y «Avisos» (Ventas · Reportes): no se implementa en esta épica; queda como seguimiento trazado (ver *Decisiones abiertas* 1).
- Filtro por tienda y desglose por tienda: no lo piden los requisitos.
- Emisión, listado, estados y anulación de comprobantes (MSF-159, MSF-177): aquí solo se lee.
- En la ficha: «Saldo deudor», «Nuevo comprobante», la fecha del «Último» comprobante, el contador de «Comprobantes» y el enlace de cada número al comprobante (Ventas); «Facturado en 12 meses» se reemplaza por el total facturado del año.
- Superset, dashboards y cualquier análisis más allá del ranking básico.
- Cuenta web, correo masivo, etiquetas, importar, expreso preferido y el resto de Clientes (otras épicas).

## Decisiones abiertas (no bloquean; llevan valor provisorio)

1. **Entrada oficial del ranking** — provisoria: la solapa de **Clientes**; la copia de Ventas · Reportes no se construye aquí. Nicolás confirma; si quiere ambas, se traza el seguimiento para mostrar el mismo componente/función en Reportes.
2. **Consumidor final en el ranking** — provisoria: el interruptor «Consumidor final» arranca **desactivado** (excluido), porque agrega ventas anónimas de mostrador y desplazaría a clientes reales; el servidor respeta lo que pida la pantalla.
3. **Total con o sin IVA** — provisoria: **sin IVA** por defecto (coherente con el margen) y la opción «Ver con IVA» disponible. Si se decide una sola base, se elimina la opción sin tocar el resto.
4. **Criterio de estados que cuentan** (p. ej. si «Deuda» cuenta) — lo fija Ventas; provisoria: factura no anulada. Cambia en un solo predicado (FR-005).
5. **Quién ve el ranking** — provisoria: cualquiera con `lectura` o `edicion` en Clientes (la facturación por cliente es dato comercial); exportar exige la acción `exportar` ya existente. Si se quiere restringir más (solo administración), se ajusta el nivel exigido en la función.
6. **Tabla de contrato** — provisoria: esta épica crea el mínimo `dominio.comprobantes_venta` (solo lectura); Ventas la completa con migraciones aditivas. Si Ventas llega antes con la tabla definitiva, esta migración se ajusta (`create table if not exists` + columnas faltantes) o se descarta, sin cambiar las funciones.
7. **Garantía del Excel** — el Excel llama a `ranking_clientes` por lotes; la acción `exportar` se exige en la interfaz porque los datos son exactamente los que ya ve quien tiene `lectura` (no abre información nueva). Si se quiere imponer también en el servidor, se agrega un parámetro en una épica posterior.

## Matriz pantalla↔criterios

Inventario determinista con `pnpm prototipo:inventario` sobre `Clientes.dc.html`, `VentasReportes.dc.html` y `ClienteFicha.dc.html` (`design/pantallas/*.inventory.json`). Cada ítem visible tiene dueño o está fuera de alcance con motivo.

### Clientes · Listado — solapa «Ranking por facturación» (`Clientes.dc.html`)

| Ítem del inventario | Destino | Criterio |
|---------------------|---------|----------|
| Tabla del ranking: columnas `#`, `Cliente`, `Tipo`, `Comprobantes`, `Facturado`, `Participación` | En alcance | F-CLI-08 US1-1/2/4, FR-008 |
| Campo `Desde` | En alcance | US1-1/9, FR-008 |
| Campo `Hasta` | En alcance | US1-1/9, FR-008 |
| Botón `Aplicar` | En alcance | US1-2, FR-008 |
| Botón `Exportar a Excel` | En alcance | F-CLI-09 US2-1/3/4, FR-010 |
| Solapas «Listado» / «Ranking por facturación» (estado `tab` del prototipo; el inventario no las detecta como `tabs`) | En alcance | US1-1, FR-008 |
| Atajos de período (el prototipo no los dibuja en Clientes; el doc pide Este mes, Mes anterior, Últimos 90 días, Año en curso) | En alcance (manda el doc) | US1-5, FR-008 |
| Filtro por tipo de cliente e interruptor Consumidor final (no dibujados; los piden los requisitos) | En alcance (manda el doc) | US1-6/7, FR-008 |
| Opción «Ver con IVA» (supuesto de la épica; no dibujada) | En alcance | US1-8, FR-003, FR-008 |
| Tabla del listado de clientes (columnas ``, `Cliente`, `Tipo`, `Tiendas`, `Contacto`, `Localidad`, `Expreso preferido`, `Cuenta web`, ``) y campo `(buscar: Buscar por nombre, CUIT o número)` | Fuera de alcance: ya entregado por MSF-180 / otras épicas | — |
| Botones `Importar`, `Etiquetas`, `Exportar`, `Nuevo cliente`, `Ver ficha`; diálogos «Enviar correo a seleccionados», alta/edición de cliente, «Eliminar cliente», «Importar clientes» y sus campos (`Asunto`, `Mensaje`, `Número`, `DNI / CUIT`, `Nombre o razón social`, `Tipo de cliente`, `Correo`, `Teléfono`, `Celular`, `Dirección`, `CP`, `Localidad`, `Provincia`, `Expreso preferido`, `Habilitado en`, `Cuenta web`) y botones `Cancelar`, `Enviar correo`, `Configurar tipos de cliente →`, `Enviar invitación por correo al crear la cuenta`, `Incluir en el correo masivo`, `Guardar cliente`, `Eliminar cliente`, `Descargar plantilla CSV`, `Importar 54 clientes` | Fuera de alcance: son de MSF-180, MSF-237, MSF-155, MSF-142 y MSF-445, no del ranking | — |

### Ventas · Reportes (`VentasReportes.dc.html`)

| Ítem del inventario | Destino | Criterio |
|---------------------|---------|----------|
| Tercera tabla (`#`, `Cliente`, `Tipo`, `Comprobantes`, `Facturado`, `Participación`) con campos `Desde`/`Hasta` y botón `Exportar a Excel` | Fuera de alcance en esta pantalla: la entrada oficial es Clientes; el mismo ranking dibujado en Reportes se traza como seguimiento (Decisiones 1) | — |
| Filtro `Tienda` y desglose por tienda | Fuera de alcance: no lo piden los requisitos de F-CLI-08…10 | — |
| Tablas «Más vendidos» (`#`, `Producto`, `Unidades`, `Facturado`, `Stock hoy`) y «Avisos» (`Producto`, `Pedidos de aviso`, `Última solicitud`, `Stock hoy`), botón `Avisar` | Fuera de alcance: son de Ventas · Reportes | — |

### Clientes · Ficha (`ClienteFicha.dc.html`)

| Ítem del inventario | Destino | Criterio |
|---------------------|---------|----------|
| «Resumen comercial» → «Facturado en 12 meses» | En alcance, ajustado: total facturado **del año** (manda el doc) | F-CLI-10 US3-1, FR-012/013 |
| «Últimos comprobantes» (lista con número, estado y total por comprobante) | En alcance | US3-2/3, FR-012/013 |
| Botones con el número del comprobante (`0003-00001251`, `0003-00001230`, `0003-00001204`, `0003-00001177`) | En alcance como **texto** (fecha, estado y total junto al número); el enlace al comprobante es de Ventas | US3-2, FR-013 |
| «Saldo deudor», «Comprobantes» (contador), «Último» y botón `Nuevo comprobante` | Fuera de alcance: de Ventas / no pedidos | — |
| Campos de datos (`Número`, `DNI / CUIT`, `Nombre o razón social`, `Correo`, `Teléfono`, `Celular`, `Dirección`, `CP`, `Localidad`, `Provincia`, `Expreso preferido`) y botones `Clientes`, `Etiqueta`, `Guardar cambios`, `Configurar tipos de cliente →`, `Incluir en el correo masivo`, `Imprimir etiqueta de envío`; `Correo de acceso` (cuenta web) | Fuera de alcance: ficha y edición ya entregadas por MSF-180; cuenta web es de MSF-237 | — |

## Success Criteria

- **SC-001**: con facturas de ejemplo, `ranking_clientes` devuelve solo los clientes del período, ordenados por facturado, sin sumar anuladas ni presupuestos, y la participación suma 100 % (pgTAP + Vitest).
- **SC-002**: los filtros (tipo, Consumidor final, con/sin IVA) y los atajos de período cambian el resultado como se espera, y los extremos son inclusivos (pgTAP + Vitest).
- **SC-003**: aislamiento: otra organización y la sección Clientes en `ninguno` no leen ranking ni compras, llamando directo a la base; `anon` sin acceso; `dominio.comprobantes_venta` tiene RLS (`rls_en_toda_tabla` verde) (pgTAP).
- **SC-004**: el `.xlsx` exportado se reabre con las mismas filas y totales que la pantalla, neutraliza fórmulas, se oculta sin la acción `exportar` y trabaja por lotes (Vitest).
- **SC-005**: la ficha muestra el total facturado del año y los comprobantes del cliente, con vacío para un cliente sin compras y sin sumar anuladas/presupuestos (pgTAP + Vitest).
- **SC-006**: `pnpm lint && pnpm build && pnpm test && pnpm docs:check && pnpm matriz:check` sin errores.

## Matriz de trazabilidad Jira ↔ US ↔ FR ↔ tareas

| Jira | Historia | FR / SC | Tareas |
|------|----------|---------|--------|
| F-CLI-08 | US1 Ranking de clientes por facturación | FR-001…009, FR-014, FR-015, SC-001…003 | T001–T008 |
| F-CLI-09 | US2 Exportar el ranking a Excel | FR-010, FR-011, SC-004 | T009–T011 |
| F-CLI-10 | US3 Historial de compras en la ficha | FR-012, FR-013, SC-005 | T012–T016 |
| Tarea de cierre (label `cierre`) | Docs, seguridad, seguimiento y roadmap | FR-016, SC-006, Principio VIII | T017–T020 |
