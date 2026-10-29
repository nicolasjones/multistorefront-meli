---
owner: producto
sources:
  - specs
  - design/pantallas
---

# Ventas · reportes básicos (MSF-338)

**Épica:** MSF-338 · **Historias:** F-VTA-22 «Productos más vendidos» (MSF-347) y F-VTA-23 «Ranking de
clientes con exportación» (MSF-358). **Spec:** `specs/20270104-100000-ventas-reportes-basicos/` · **Rama:**
`epic/MSF-338-ventas-y-despacho-ventas-reportes-basico`, pendiente de merge a `main`. Detalle técnico:
[Ventas · reportes básicos (técnico)](../tecnico/ventas-reportes.md).

Esta página explica **qué resuelve** la épica: ver los productos más vendidos y quiénes más compraron,
en un rango de fechas y por tienda, y bajar el ranking a Excel. Lo que se vendió se carga en
[Ventas · comprobantes (MSF-159)](ventas-comprobantes.md) y se lista en
[Ventas · listado, estados y anulación (MSF-177)](ventas-listado-estados-y-anulacion.md).

## Qué resuelve

- **Los productos más vendidos** de un período: unidades, facturado y cuánto stock queda hoy. Sirve para
  decidir qué reponer y qué dejar de comprar.
- **El ranking de clientes por facturación**: quién compró más, cuántas compras hizo y cuándo compró por
  última vez. Sirve para atender mejor a los clientes clave.
- **Los dos reportes con los mismos filtros** (período y tienda) y **el ranking exportable a Excel**, con
  las mismas filas y los mismos totales que se ven en pantalla.
- **Sin planillas a mano**: hasta ahora estos dos reportes se armaban con el listado exportado a CSV
  ([Ventas · listado, estados y anulación](ventas-listado-estados-y-anulacion.md)).

## Para quién

| Persona | Qué hace con esta entrega |
|---|---|
| **Administración** | Abre **Ventas · Reportes**, ve «Más vendidos» y «Ranking de clientes» y exporta el ranking a Excel. |
| **Administrador** | Lo mismo que Administración. |
| **Operador** | No ve la pantalla: sin la sección **Reportes** aparece «No tenés acceso a esta sección». |
| **Consulta** | Igual que Operador: sin la sección **Reportes** no entra. |
| **Mostrador** / **Depósito** / **Miembro** | Sin la sección **Reportes** no entran. |

La sección **Reportes** es **por empresa**: el nivel sale de la empresa activa, como el resto de las
secciones por empresa. La matriz inicial deja **edición** a Administración y Administrador y **ninguno**
a los demás roles (ver [Permisos por rol](../permisos-por-rol.md)).

## La pantalla «Reportes de ventas»

La pantalla está en **Ventas · Reportes** (`/ventas/reportes`), en el menú junto a Ventas, con ícono
propio. Muestra:

- **Título** «Reportes de ventas» y el subtítulo «Más vendidos, avisos de «avisame cuando vuelva» y ranking
  de clientes por facturación.» (texto del prototipo; la parte de avisos no es de esta épica).
- **Pestañas** «Más vendidos» y «Ranking de clientes». Cada una muestra su propio tablero.
- **Filtro de tienda**: las píldoras «Todas las tiendas» y una por tienda accesible, con la ayuda «Por
  defecto se ven todas; si elegís una empresa en la barra superior, se filtra por esa tienda.»
- **Filtros de período**: «Desde» y «Hasta» con los atajos **Hoy**, **7 días**, **Este mes** y **Mes
  anterior**. Abre en **Este mes**; un rango inválido se avisa en el campo y no se aplica.
- **Botón «Exportar a Excel»** en el encabezado, solo en la pestaña «Ranking de clientes» (ver
  [Exportar a Excel](#exportar-a-excel)).

Los estados de la pantalla son los compartidos por todas las pantallas del panel:

| Estado | Qué se ve |
|---|---|
| Carga | El estado de carga compartido mientras se resuelve el conteo y el tablero. |
| Vacío | «No hay ventas en ese período» con la ayuda «Probá con otro período o con otra tienda.» |
| Error | «No pudimos cargar el tablero de «…».» con **Reintentar**. |
| Tablero no disponible | «El tablero de «…» todavía no está disponible para tu organización.» (el tablero no está importado en ese ambiente). |
| Acceso restringido | «No tenés acceso a esta sección» (sin la sección Reportes). Sin pedir token. |

El vacío se decide con el **conteo de comprobantes que cuentan como venta** del período (no con las filas
del tablero): por eso un período con ventas solo al «Consumidor final» muestra el tablero vacío de Superset
en la pestaña «Ranking de clientes», en lugar del aviso de la exportación.

## «Más vendidos»

La tabla del tablero muestra, por producto:

| Columna | Qué es |
|---|---|
| **Producto** | Nombre del producto (con su SKU en columna propia). |
| **Unidades** | Unidades vendidas en el período, con las notas de crédito restando. |
| **Facturado** | Facturación neta del período **con IVA** (el mismo número que muestra el listado de comprobantes). |
| **Stock hoy** | Stock vigente del producto y su estado (sin stock / stock bajo / disponible). |

El tablero además tiene **filtros nativos** de rango de fechas, empresa, categoría y ubicación de stock: los
dos primeros los maneja la pantalla y los otros dos quedan en el propio tablero de Superset.

## «Ranking de clientes»

La tabla del tablero muestra, por cliente:

| Columna | Qué es |
|---|---|
| **Cliente** | Nombre del cliente (con su Nº y su Tipo en columnas propias). |
| **Comprobantes** | Cantidad de facturas que cuentan (las notas de crédito restan del importe, pero no suman un comprobante). |
| **Facturado** | Facturación neta del período **con IVA**. |
| **Participación** | Porcentaje del cliente sobre el total del alcance, con barra proporcional. |
| **Último comprador** | Fecha del último comprobante que cuenta del cliente en el alcance filtrado. |

- El interruptor **«Consumidor final»** incluye o excluye al cliente «Consumidor final» de la
  organización. **Viene excluido**: es el valor inicial de la pantalla y del tablero.
- El **«Último comprador»** es una **fecha** (la del comprobante más reciente que cuenta), no un nombre de
  persona: es una decisión provisional de la épica, a confirmar con el cliente.

## Exportar a Excel

El botón **«Exportar a Excel»** está en el encabezado de la pantalla y aparece **solo en la pestaña
«Ranking de clientes»**: el archivo tiene que coincidir con lo que se ve, y en «Más vendidos» no hay un
archivo equivalente.

- Genera un `.xlsx` real (`ranking-clientes-ventas-<desde>_<hasta>.xlsx`) con **todas** las filas del
  ranking, no solo las de la pantalla.
- Las columnas son las del tablero: **Cliente**, **Nº**, **Tipo**, **#**, **Comprobantes**, **Facturado**,
  **Participación** y **Último comprador**; abajo van el contexto (período, si el «Consumidor final» está
  incluido o excluido), la cantidad de clientes y el total facturado.
- Respeta los **filtros vigentes**: período, tienda y el interruptor de «Consumidor final».
- La descarga va **por lotes** (1.000 clientes por pedido) y muestra el progreso; se puede **cancelar** a
  mitad de camino.
- Con más de **100.000 clientes** en el alcance no se exporta: la pantalla avisa que hay que acotar el
  período o los filtros (no baja un archivo a medias).
- Si el ranking queda vacío, no baja ningún archivo: avisa «No hay clientes en el ranking con esos filtros.
  Probá con otro período o activá el «Consumidor final».»
- Quien no tiene la sección **Reportes** no ve el botón, y **el servidor también rechaza** la exportación
  (no alcanza con ocultar el botón).

## Qué cuenta como venta

Los dos reportes se calculan sobre lo mismo, con **un solo criterio**:

- Cuentan las **facturas** y las **notas de crédito**; los **presupuestos**, los **borradores** y las
  comprobantes **anuladas** no cuentan.
- Las **notas de crédito restan** (unidades e importe).
- El importe es el **total con IVA**, el mismo que muestra el listado y la exportación de comprobantes.
- Un cliente que en el período solo tiene notas de crédito aparece con **facturación negativa** (la neta,
  sin piso en cero).
- Un comprobante **sin tienda** no aparece en ningún reporte.

!!! note "Una decisión pendiente de confirmar"
    La regla de «facturación negativa» para el cliente que solo tiene notas de crédito es **provisional**
    (decisión 3 de la spec): si el cliente quiere piso en cero, cambia solo la vista y el cálculo, no la
    pantalla.

## Empresa activa

El filtro **Tienda** sigue a la **empresa activa** de la barra superior (Principio VIII):

- Por defecto se ven **todas las tiendas accesibles**; al elegir una en la barra, el filtro queda en esa.
- Al **cambiar de empresa** se invalidan y recargan todas las consultas de la pantalla: el conteo, el
  tablero de la pestaña activa y la exportación en curso (si la había) se reinician, y no queda ninguna fila
  de la empresa anterior.
- La exportación a Excel usa el mismo valor: el archivo sale con los filtros de la tienda vigente.

## Matriz pantalla↔criterios

| Ítem visible | Dueño |
|---|---|
| Título «Reportes de ventas» y subtítulo | FR-005 |
| Pestañas «Más vendidos» / «Ranking de clientes» | FR-005, FR-008 |
| Filtro de tienda (píldoras) y su texto de ayuda | FR-004, FR-005 |
| Campos «Desde» / «Hasta» y atajos (Hoy, 7 días, Este mes, Mes anterior) | FR-005 |
| Tabla «Más vendidos»: Producto, SKU, #, Unidades, Facturado, Stock hoy | FR-001, FR-003, FR-005 |
| Filtros de categoría y ubicación de stock (no están en el prototipo) | FR-001, FR-003 (manda el requisito) |
| Tabla «Ranking de clientes»: Cliente, Nº, Tipo, #, Comprobantes, Facturado, Participación | FR-006, FR-007, FR-008 |
| «Último comprador» (no está en el prototipo) | FR-006 (manda el requisito) |
| Interruptor «Consumidor final» (no está en el prototipo) | FR-008 (manda el requisito) |
| Botón «Exportar a Excel» (solo en «Ranking de clientes») | FR-009, SC-004 |
| Estados: carga, «No hay ventas en ese período», error con «Reintentar», acceso restringido | FR-005, SC-002, SC-003 |
| Pestaña «Avisos «avisame cuando vuelva»», su tabla y el botón «Avisar» | **FUERA DE ALCANCE** — la épica lo declara: los avisos no son de esta épica |
| Tarjetas de desglose por tienda del prototipo | **FUERA DE ALCANCE** — el filtro por tienda sí se pidió, el desglose no |
| **Empresa activa** | FR-004, FR-005, SC-002 |

## Permisos

| Acción | Sección | Quién |
|---|---|---|
| Ver la pantalla y los tableros | `reportes` ≥ lectura | Administración y Administrador (matriz inicial) |
| Exportar el ranking a Excel | `reportes` ≥ lectura (el servidor lo vuelve a comprobar) | Administración y Administrador |
| Consultar el conteo del período | `reportes` ≥ lectura | Administración y Administrador |

Detalle de la matriz: [Permisos por rol](../permisos-por-rol.md).

## Cómo probarlo

### Prerrequisitos

- **Entorno:** un stack local con la rama de la épica (`pnpm dev:supabase` + `pnpm dev`, panel en
  `http://localhost:5173`) **con un Superset real** (el tablero no se simula: sin él la pantalla muestra
  «El tablero de «…» todavía no está disponible para tu organización»), o el ambiente **DEV** con la épica
  desplegada y los tableros importados.
- **Personas y permisos** (en la organización de prueba):
  - **Administración** (o **Administrador**) con la sección **Reportes** en la empresa: ve la pantalla y
    exporta.
  - **Operador** o **Consulta** sin la sección **Reportes**: ven «No tenés acceso a esta sección».
- **Datos a sembrar:**
  - Dos **empresas** (tiendas) de la misma organización y **dos o tres productos** con y sin stock.
  - Dos **clientes** (uno minorista y otro minorista más) y el **«Consumidor final»** de la organización.
  - Una **factura confirmada** en la tienda A, otra en la tienda B, y dentro del mismo período: una
    **nota de crédito** (que tiene que restar) y un **presupuesto** (que no tiene que contar).
- **Tableros importados:** `pnpm superset:importar-dashboards -- --directorio
  infra/superset/dashboards/ventas-reportes --entorno staging` (o `production`), con el `SUPABASE_URL` y la
  `SUPABASE_SERVICE_ROLE_KEY` del stack.

### Pasos

1. **Entrar sin permiso.** Con la sesión de **Operador**, abrí `http://localhost:5173/ventas/reportes`: se
   tiene que ver «No tenés acceso a esta sección» y **ningún** botón «Exportar a Excel».
2. **Entrar con permiso.** Con la sesión de **Administración**, abrí la misma ruta: se tiene que ver el
   título «Reportes de ventas», el subtítulo, la pestaña «Más vendidos», el filtro de tienda con sus
   píldoras y los campos «Desde» / «Hasta».
3. **Ver el período por defecto.** La pantalla abre en **Este mes**: los campos «Desde» y «Hasta» vienen
   con ese rango. Probá los atajos **Hoy**, **7 días** y **Mes anterior**: el rango cambia y el tablero se
   recarga. Con un «Hasta» anterior al «Desde» el campo avisa «Hasta no puede ser anterior a Desde.» y el
   rango **no** se aplica.
4. **Ver «Más vendidos».** En la pestaña «Más vendidos» se tiene que ver el tablero con la tabla (Producto,
   SKU, #, Unidades, Facturado, Stock hoy), ordenada por unidades de mayor a menor. Los productos que solo
   están en un **presupuesto** **no** aparecen; el producto con **nota de crédito** aparece con unidades (e
   importe) **en negativo** o reducido, nunca sumando de más.
5. **Filtrar por tienda.** Elegí la píldora de la **tienda B**: el tablero se recarga y quedan solo las
   filas de esa tienda (no las de la A). Volvé a «Todas las tiendas» y comprobá que vuelven las dos.
6. **Ver el vacío.** Poné un rango sin ventas (por ejemplo, «Hoy» en una tienda sin comprobantes): se tiene
   que ver «No hay ventas en ese período» con la ayuda «Probá con otro período o con otra tienda.» y ningún
   error.
7. **Ver «Ranking de clientes».** Pasá a la pestaña «Ranking de clientes»: aparece la tabla con Cliente, Nº,
   Tipo, #, Comprobantes, Facturado, Participación (con barra) y Último comprador, ordenada por
   facturación descendente. El **«Consumidor final»** está **excluido** (interruptor apagado).
8. **Incluir el «Consumidor final».** Encendé el interruptor: el tablero se recarga y el «Consumidor
   final» aparece en el ranking. Volvé a apagarlo y desaparece.
9. **Exportar.** Con la pestaña «Ranking de clientes» abierta, pulsá **«Exportar a Excel»**: se tiene que ver
   el progreso y, al terminar, el aviso «Exportación lista: el archivo se descargó.». El archivo baja como
   `ranking-clientes-ventas-<desde>_<hasta>.xlsx` con las **mismas filas y los mismos totales** que la
   tabla (columnas Cliente, Nº, Tipo, #, Comprobantes, Facturado, Participación, Último comprador, y al
   final el período, si el Consumidor final está incluido o excluido, la cantidad de clientes y el total
   facturado). Con el rango vacío no baja ningún archivo: avisa «No hay clientes en el ranking con esos
   filtros. Probá con otro período o activá el «Consumidor final».»
10. **Cambiar de empresa.** En la barra superior cambiá la empresa activa: el filtro de tienda se reencuadra
    (queda pulsada la tienda nueva), el tablero se recarga y **no** quedan filas de la tienda anterior. Si
    había una exportación en curso, se cancela.
11. **Sin permiso en el servidor.** Con la sesión de **Operador**, pedí la exportación por la API
    (`POST /rest/v1/rpc/leer_ranking_ventas` con su token): tiene que responder **42501** aunque el
    botón esté oculto en la pantalla.

### Resultado esperado

- **Given** un período con facturas, presupuestos, anuladas y notas de crédito, **When** se abre «Más
  vendidos», **Then** el ranking suma solo las facturas confirmadas no anuladas y las notas de crédito
  restan.
- **Given** un filtro de tienda, **When** se aplica, **Then** el ranking suma solo las ventas de esa tienda
  y coincide con el listado exportado de comprobantes.
- **Given** un rango sin ventas, **When** se consulta, **Then** la pantalla dice «No hay ventas en ese
  período» y no es un error.
- **Given** un rango con ventas, **When** se exporta el ranking, **Then** el archivo tiene las mismas filas
  y los mismos totales que la pantalla y respeta los filtros vigentes.
- **Given** una persona sin la sección **Reportes**, **When** pide la exportación, **Then** el servidor la
  rechaza (42501) aunque la pantalla no muestre el botón.
- **Given** dos empresas activas distintas, **When** se cambia de empresa, **Then** el tablero y el filtro
  se reencuadran y no quedan filas de la empresa anterior.

### Cómo automatizarlo

**Hoy hay un E2E de la épica**: `apps/web/e2e/ventas-reportes.e2e.ts` (cierre **MSF-568**, tarea **T015** de
MSF-338, rótulo previsto `[MSF-338:T015]`). Recorre el acceso restringido de Operador y Consulta (y que el
servidor rechaza la lectura con `42501`), que Administración y Administrador ven la pantalla, el **cambio
de empresa** que reencuadra el filtro de tienda y la **exportación** del ranking a `.xlsx` desde la pestaña
«Ranking de clientes». Se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (no corre en el CI público) y
**no monta el tablero de Superset**: valida el marco, el filtro, el botón y el acceso contra la base.

Lo que **no** está automatizado (queda pendiente de automatizar):

| Recorrido | Test E2E propuesto | Rótulo |
|---|---|---|
| «Más vendidos» con facturas, nota de crédito y presupuesto del período (lo que cuenta y lo que no) | `e2e/ventas-reportes-datos.e2e.ts` (pendiente: necesita el tablero de Superset montado o una RPC de lectura equivalente) | `[MSF-338:T001]` |
| Estado vacío «No hay ventas en ese período» y error con «Reintentar» | `e2e/ventas-reportes-estados.e2e.ts` (pendiente) | `[MSF-338:T005]` |
| Paridad entre el `.xlsx` exportado y las filas de la tabla | cubierto hoy por Vitest (`apps/web/src/pages/ventas-reportes/rankingClientes.contrato.test.ts`) y pgTAP; el E2E de navegador queda pendiente | `[MSF-338:T012]` |

Los rótulos siguen el formato `[MSF-xxx:T0yy]` de la suite (`docs/e2e-app.md`) y apuntan a tareas reales de
`specs/20270104-100000-ventas-reportes-basicos/tasks.md` (**T001** vista «Más vendidos», **T005** pantalla,
**T012** exportación, **T015** E2E del cierre).

!!! warning "El rótulo todavía no cierra el vínculo con la épica"
    `pnpm cobertura:e2e` ata cada test a su épica con el rótulo `[EPICA:TASK]` **y** la línea
    `**Jira Epic**: MSF-338` del `spec.md`. La spec de esta épica **no la declara** (dice `**Épica**:`), así
    que el E2E queda como «épica desconocida» en el manifiesto de cobertura. También falta el rótulo en el
    título del test. Las dos correcciones son del **cierre de la épica** (dueño: responsable de plataforma).

## Límites y decisiones abiertas

- **El ranking de clientes se solapa con el de Clientes** (MSF-126, F-CLI-08/F-CLI-09): son dos pantallas
  distintas con la misma información. Provisionalmente **cada reporte se queda con su dueño** —esta épica
  entrega el de Ventas con exportación a Excel— y hay que confirmar si uno sobra.
- **La exportación a Excel es propia**, no la nativa de Superset: se genera en el panel para garantizar que
  el archivo tenga las mismas filas y totales que la pantalla y que el servidor rechace a quien no tiene
  permiso.
- **«Último comprador» es una fecha** (la del último comprobante que cuenta), no una persona.
- **La facturación de un cliente con solo notas de crédito es negativa** (sin piso en cero).
- **El tablero se monta sobre Superset**: sin un Superset real en el ambiente, la pantalla muestra el
  aviso de que el tablero no está disponible. Los filtros nativos del tablero (categoría, ubicación de
  stock) y la barra de participación **están verificados contra los YAML, no contra un Superset real**.
- **El ranking se recalcula en cada pedido** de la exportación: con volúmenes grandes conviene acotar el
  período.
- El **estado vacío de la pestaña «Ranking de clientes»** se decide con el conteo de comprobantes del
  período: un período con ventas solo al «Consumidor final» muestra el tablero vacío de Superset en vez del
  aviso de la exportación.
- La épica es **P1 y de Etapa 2** (enero de 2027); hasta entonces estos reportes se pueden armar a mano
  con el listado exportado a CSV.

## Fuera de alcance de esta épica

- Los **avisos «avisame cuando vuelva»** (la tercera pestaña del prototipo) y el botón «Avisar».
- El **desglose por tienda** que dibuja el prototipo (el filtro por tienda sí está).
- La **exportación de «Más vendidos»** a Excel: el archivo tiene que coincidir con lo que se ve, y en esa
  pestaña no hay archivo.
- El **desglose por empresa** del reporte de ventas de MSF-192 y el **reporte de ventas por período y
  canal** (F-REP-05, MSF-248): hay que decidir a quién pertenece cada reporte.
- **Mercado Libre** y el resto de los canales en los reportes (Etapa 2).
- La **edición de la matriz de permisos desde la pantalla** (Etapa 2).

## Pendientes

| Qué falta | Por qué | Dueño |
|---|---|---|
| **Merge de la épica a `main`** | La pantalla, las vistas, las RPC y los tableros están en la rama de la épica; en `main` todavía no hay nada de MSF-338 | responsable de plataforma (cierre de MSF-338) |
| **Rótulo del E2E y `**Jira Epic**:` en la spec** | `pnpm cobertura:e2e` ata cada test a su épica con `[EPICA:TASK]` y la línea `**Jira Epic**: MSF-338` del `spec.md`; hoy el E2E no tiene rótulo y la spec no la declara | responsable de plataforma (cierre de MSF-338) |
| **Verificación en un Superset real** | Que los filtros nativos preseleccionados lleguen al tablero y que se pinte la barra de participación: hoy está verificado contra los YAML, no contra un Superset | plataforma / Superset |
| **E2E de los datos de «Más vendidos» y de los estados** | El E2E actual no monta el tablero: no cubre qué comprobantes cuentan, ni el vacío ni el error | responsable de plataforma |
| **Confirmar las decisiones provisionales** (duplicado con el ranking de Clientes, exportación propia, facturación negativa, «último comprador» como fecha, horas y prioridad) | Son decisiones de la spec que el cliente tiene que confirmar | Producto (cliente) |
| **Vacío del ranking cuando solo hay ventas al «Consumidor final»** | El estado vacío usa el conteo de comprobantes, que no distingue el «Consumidor final»; la RPC ya podría distinguirlo (`total_filas`) | Producto / Ventas |

## Estado

Implementado en la rama de la épica con sus dos historias y el cierre (F-VTA-22/MSF-347, F-VTA-23/MSF-358 y
el cierre MSF-568), **pendiente de merge a `main`**. La fuente funcional es
`specs/20270104-100000-ventas-reportes-basicos/spec.md`; las pruebas están en
`supabase/tests/database/ventas_reportes_*.test.sql`, en `apps/web/src/pages/ventas-reportes/*.test.tsx`
y en `apps/web/e2e/ventas-reportes.e2e.ts`.

## Para seguir

- **[Ventas · reportes básicos (técnico)](../tecnico/ventas-reportes.md)** — vistas `analitica`, RPC,
  tableros, token y exportación.
- **[Ventas · listado, estados y anulación (producto)](ventas-listado-estados-y-anulacion.md)** — de dónde
  salen los comprobantes que se reportan.
- **[Permisos por rol](../permisos-por-rol.md)** — la sección `reportes` de la matriz.
- **[Operar Superset](../operar-superset.md)** — cómo se importan y se publican los tableros.
