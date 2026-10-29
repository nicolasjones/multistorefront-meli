---
owner: producto
sources:
  - specs
  - design/pantallas
---

# Ventas · historial de consulta (MSF-275)

Esta página explica **qué resuelve** la épica MSF-275 (spec `ventas-historial-de-consulta`) para quien opera el
negocio. El detalle de datos, RPC, worker y operación está en
[Ventas · historial de consulta (técnico)](../tecnico/ventas-historial-consulta.md).

## Qué resuelve

Los **comprobantes, los cobros y las cotizaciones del dólar del panel actual** (el sistema anterior) se pueden
**buscar y ver en solo lectura** dentro de la plataforma, **sin haberlos migrado** a las tablas vivas.

- Se **importa una sola vez** la exportación (CSV o Excel) que entrega el panel actual.
- Lo importado queda en tablas de archivo que **ninguna pantalla puede modificar**: no hay editar, ni anular,
  ni borrar.
- El historial **no cuenta** para stock, saldos, estados ni reportes: es un archivo de consulta, no un documento
  vivo.
- Los comprobantes históricos **conservan sus números originales** y se rotulan **«Histórico»**, para que
  nadie los confunda con una venta de la plataforma.

## Para quién

- **Mostrador /.Operation:** responde consultas de clientes sobre ventas anteriores (garantía, repetir un pedido,
  saldo viejo) sin abrir el panel actual.
- **Administración:** consulta saldos viejos y **a cuánto estaba el dólar** en una fecha pasada.
- **Administrador:** sube la planilla del panel actual una sola vez y ve el resultado de la importación.

Sin la sección **Ventas** la pantalla muestra «Acceso restringido» y la entrada de menú no aparece. Con
**lectura** o **edición** en Ventas se consulta el historial. **Importar** es solo de quien administra la
organización.

## Qué se ve

La pantalla **Historial** (menú **Ventas › Historial**, ruta `/historial`) tiene el encabezado «Historial», la
etiqueta «Solo lectura», el subtítulo «Consulta de lo registrado antes de la plataforma. No se puede editar ni
borrar.» y un aviso que aclara que los datos del sistema anterior no afectan el stock actual.

### Pestaña Ventas

Comprobante (con el **número original** y la etiqueta **«Histórico»**), Tienda, Fecha, Cliente, Operador,
**Estado final** y Total. Ordenada por fecha descendente y paginada en el servidor.

### Pestaña Cobros

Fecha, Comprobante (con «Histórico»), Tienda, Cliente, Cuenta de cobro, Aprobado por e Importe.

### Pestaña Cotizaciones del dólar

Fecha, **Dólar comprador**, **Dólar vendedor** y Cargó. Las cotizaciones son **globales de la organización**:
no tienen tienda y no dependen de la empresa activa.

### Filtros, búsqueda y estados

- **Buscar por cliente o número** (Ventas y Cobros): busca por nombre de cliente, número de cliente o número de
  comprobante, sin distinguir mayúsculas ni tildes. **Buscar por fecha** (Cotizaciones): acepta `dd/mm/aaaa`,
  `aaaa-mm-dd` o una parte (`03/2020`).
- **Filtro Tienda**: solo ofrece las empresas asignadas a la persona; «Todas las tiendas» es la opción inicial.
- Indicadores **«Desde: …»**, **«Hasta: …»** (rango de fechas de lo importado), **«N registros mostrados»** y
  **«Página N»**.
- Estados: carga, **error con «Reintentar»**, **«Sin resultados»** y el vacío **«Todavía no hay historial
  importado.»** (o «…las cotizaciones del dólar del sistema anterior…» en esa pestaña).
- En pantalla angosta las tablas pasan a tarjetas; se puede operar con teclado y con lector de pantalla.

## Cómo se importa

La pantalla **Importar historial** (`/historial/importar`, sin entrada de menú: se llega desde
**Ejecuciones**) es una herramienta puntual de migración:

1. Elegí el **tipo de importación**: *Comprobantes de venta*, *Cobros* o *Cotizaciones del dólar*.
2. Elegí la planilla **`.csv` o `.xlsx`** (hasta 50 MB, una fila por registro).
3. Pulsá **Importar**. La planilla se sube a un storage privado y la pantalla sigue la ejecución.
4. El resultado dice **cuántas filas entraron y cuántas ya existían**; si algo falla, la pantalla lista las
   **filas rechazadas** con **fila, columna y motivo** (y el detalle completo queda en **Ejecuciones**).

La importación es **todo o nada**: si hay una sola fila inválida, **no se importa ninguna** y hay que corregir la
planilla. Volver a subir la misma planilla es seguro: no duplica.

## Empresa activa

El filtro **Tienda** parte de la **empresa activa** de la barra superior; los chips lo pueden sobreescribir hasta
que la activa cambie. Al cambiar de empresa (o de organización) la pantalla se **remonta**: vuelve a la primera
página, limpia la búsqueda y recarga todo, sin mostrar filas de la empresa anterior. Las **cotizaciones del
dólar** no dependen de la empresa activa (son globales): esa pestaña solo se remonta al cambiar de organización.

## Límites y decisiones abiertas

- **Una sola vez:** no hay sincronización ni actualización del historial. Es un archivo.
- **No es una tabla viva:** no suma a stock, no altera saldos, no cambia estados y no entra en los reportes
  actuales. Que los reportes de Etapa 2 incluyan el historial es una **decisión abierta**; por ahora **no** lo
  incluyen.
- **La cotización vigente no se toca:** la pestaña de cotizaciones historicales es un archivo aparte del dólar
  que carga la plataforma.
- **La numeración nueva no es de esta épica:** el histórico deja el último número registrado a la vista, pero
  fijar de dónde arranca la numeración nueva queda pendiente.
- **Volumen sin medir:** las 22 h de la épica son un orden de magnitud; el límite de la subida es 50 MB y una
  importación admite hasta 200 000 filas. No hay mediciones reales de tiempos con planillas del panel actual.
- **Nombres de tienda repetidos:** si dos empresas de la organización tienen el mismo nombre, la base toma la más
  antigua: conviene no tener tiendas homónimas antes de importar.

## Fuera de alcance de esta épica

- **Exportar** el historial: el prototipo trae el botón, la épica no lo pide (otra épica puede pedirlo).
- **Editar, anular o borrar** lo importado, y **migrar** el historial a comprobantes, cobros o cotizaciones
  vivas.
- **Un importador genérico:** esta épica construye el suyo. Si MSF-206 generaliza uno, reutilizarlo es un
  refactor posterior, no un bloqueo.
- **La entrega de las exportaciones del panel actual** (CSV o Excel) es un bloqueante **de la importación**: la
  provee la operación del panel; sin ella se puede probar la consulta con archivos de ejemplo.

## Cómo probarlo

### Prerrequisitos

- **Entorno:** stack local con la rama de la épica (`pnpm dev:supabase` + `pnpm dev`, panel en
  `http://localhost:5173`) o el ambiente **DEV** con la épica desplegada. Rutas: `http://localhost:5173/historial`
  y `http://localhost:5173/historial/importar`.
- **Personas y permisos** (en la organización de prueba):
  - **Administrador** de la organización: es el único que puede **importar** el historial.
  - **Mostrador** u **Operación** con **Ventas en lectura** en una empresa asignada: consulta el historial.
  - **Depósito** (sin acceso a Ventas): sirve para ver «Acceso restringido».
  - Un segundo usuario con **otra** empresa asignada: sirve para comprobar el aislamiento por tienda.
- **Datos a sembrar:**
  - Dos **empresas** (tiendas) de la misma organización.
  - Tres **exportaciones** del panel actual, una por tipo: comprobantes de venta, cobros y cotizaciones del
    dólar (`.csv` o `.xlsx`). Si el panel actual todavía no las entrega, sirve con **archivos de ejemplo** con las
    columnas de la sección «Mapeo de columnas» de la página técnica.
  - Para la **importación real** hacen falta la conexión `historial-ventas` de la organización y su servidor con
    el worker desplegado (ver «Puesta en marcha» en la página técnica). Sin eso, la pantalla **rechaza** la
    importación con «Esta organización no tiene habilitada la importación del historial».
  - Para probar **solo la consulta** se pueden sembrar filas en `dominio.historial_comprobantes`,
    `dominio.historial_cobros` y `dominio.historial_cotizaciones_dolar` por SQL.

### Pasos

1. **Importar los comprobantes.** Con la sesión de **Administrador**, entrá a
   `http://localhost:5173/historial/importar`, elegí el tipo **Comprobantes de venta**, elegí la planilla y pulsá
   **Importar**. Se tiene que ver el estado de la importación y, cuando termina, el conteo de filas importadas (y
   cuántas ya existían). El botón **Ver en Ejecuciones** lleva al detalle de la ejecución.
2. **Reimportar la misma planilla** (sin cambiarla). Se tiene que ver que **no se duplica**: el resultado dice
   que las filas ya existían.
3. **Probar el rechazo (todo o nada).** Subí una planilla con una fila inválida (por ejemplo, una fecha
   ilegible o un importe con letras). La importación tiene que quedar **fallida**, **no se importa ninguna fila**
   y la pantalla lista las **filas rechazadas** con fila, columna y motivo.
4. **Consultar las ventas.** Con la sesión de **Mostrador**, entrá a `http://localhost:5173/historial`: se abre
   la pestaña **Ventas** con las columnas Comprobante, Tienda, Fecha, Cliente, Operador, Estado final y Total. Cada
   comprobante tiene que mostrar su **número original** con la etiqueta **«Histórico»**, y no hay ningún botón de
   editar, anular ni borrar.
5. **Buscar.** Escribí parte del nombre del cliente (con o sin tilde) o el número de comprobante en **«Buscar por
   cliente o número»**. La tabla se tiene que filtrar y la paginación vuelve a la primera página.
6. **Filtrar por tienda.** Elegí una de las tiendas en los chips. Solo se listan filas de esa tienda; con el
   usuario que tiene **otra** empresa asignada se ve lo mismo acotado a su tienda.
7. **Ver los cobros.** Pasá a la pestaña **Cobros**: Fecha, Comprobante, Tienda, Cliente, Cuenta de cobro,
   Aprobado por e Importe.
8. **Ver las cotizaciones.** Pasá a la pestaña **Cotizaciones del dólar**: Fecha, Dólar comprador, Dólar vendedor
   y Cargó. Buscá una fecha (por ejemplo `03/2020`) en **«Buscar por fecha»**: se filtra. Esta pestaña **no**
   muestra el filtro de tienda.
9. **Ver los indicadores.** Con filas cargadas se tienen que ver **«N registros mostrados»**, el rango **«Desde:
   …»** / **«Hasta: …»** y la paginación **«Página N»**.
10. **Ver el vacío.** Buscá algo que no exista: se muestra **«Sin resultados»**. Si la organización todavía no
    importó nada, se muestra **«Todavía no hay historial importado.»**
11. **Cambiar de empresa.** Con la pantalla abierta, cambiá la empresa activa en la barra superior: la consulta
    se remonta (página 1, búsqueda limpia) y **no** quedan filas de la empresa anterior.
12. **Ver el acceso restringido.** Entrá con la sesión de **Depósito** (sin Ventas): se muestra «Acceso
    restringido» y la entrada de menú **Historial** no aparece.
13. **Comprobar que no toca lo vivo.** Con el historial importado, revisá el stock, un comprobante de la
    plataforma y un reporte: **no** cambian. Y probá a editar o borrar una fila del historial desde la base: la
    base lo rechaza.

### Resultado esperado

- **Given** una planilla válida, **When** el Administrador la importa, **Then** las filas quedan en el historial
  con su número original y el rótulo «Histórico», y la ejecución termina **exitosa** con el conteo de importadas
  y de ya existentes.
- **Given** una planilla con una fila inválida, **When** se importa, **Then** **no** se importa ninguna fila, la
  ejecución queda **fallida** y se informa **qué fila, qué columna y por qué**.
- **Given** la misma planilla importada dos veces, **When** se reimporta, **Then** no hay filas duplicadas.
- **Given** un usuario con acceso a Ventas y una empresa asignada, **When** busca o filtra por tienda, **Then**
  ve solo filas de sus empresas, en solo lectura, y nunca filas de otra organización.
- **Given** un usuario sin acceso a Ventas, **When** entra a Historial, **Then** ve «Acceso restringido» y la
  entrada de menú no aparece.
- **Given** el historial importado, **When** se consulta stock, saldos, estados o reportes, **Then** no incluyen
  el historial.

### Cómo automatizarlo

**Hoy no hay ningún E2E de esta épica**: el cierre validó con pgTAP y Vitest, y el rótulo de cobertura por
historia (`[EPICA:TASK]`) todavía no tiene ningún test de MSF-275. Queda pendiente de automatizar, con estos
rótulos:

| Recorrido | Test E2E propuesto | Rótulo |
|---|---|---|
| Importación: subida, estado de la ejecución y filas rechazadas | `apps/web/e2e/ventas-historial-importar.e2e.ts` | `[MSF-275:T011]` |
| Consulta de ventas y cobros: pestañas, columnas, «Histórico», búsqueda, filtro de tienda y cambio de empresa | `apps/web/e2e/ventas-historial.e2e.ts` | `[MSF-275:T017]` |
| Tablas de ventas y cobros con rótulo «Histórico», paginación e indicadores | `apps/web/e2e/ventas-historial.e2e.ts` | `[MSF-275:T018]` |
| Cotizaciones del dólar: columnas, búsqueda por fecha y ausencia de filtro de tienda | `apps/web/e2e/ventas-historial.e2e.ts` | `[MSF-275:T022]` |

Las tareas son de `specs/20261020-100000-ventas-historial-de-consulta/tasks.md`: **T011** (pantalla de
importación), **T017** (estructura de la pantalla), **T018** (tablas, rótulo «Histórico» y filtro de tienda) y
**T022** (pestaña de cotizaciones). El rótulo lo usa `pnpm cobertura:e2e` para atar cada test a su historia.

## Pendientes

| Qué falta | Por qué | Dueño |
|---|---|---|
| **E2E de la épica** (importación, consulta de ventas y cobros, cotizaciones) | La épica validó con pgTAP y Vitest; el rótulo `[EPICA:TASK]` de esta épica todavía no tiene ningún test. Rótulos previstos: `[MSF-275:T011]`, `[MSF-275:T017]`, `[MSF-275:T018]`, `[MSF-275:T022]` | responsable de plataforma (cierre de MSF-275) |
| **Exports del panel actual** (CSV o Excel) con formato y volumen acordados | Es el bloqueante duro de la importación (F-VTA-37): sin los archivos reales la importación se prueba con ejemplos | Operación del panel actual |
| **Medir el volumen real** (años y filas) | Las 22 h son un orden de magnitud; el límite de tamaño y el de filas se fijan con el volumen real | Producto / Operación |
| **Fijar la numeración nueva** de comprobantes | La épica deja el último número histórico disponible; la numeración nueva arranca en un número posterior y esa decisión es de Ventas | Ventas (MSF-159) |
| **Importador genérico** | Esta épica construyó el suyo; si MSF-206 generaliza uno, reutilizarlo es un refactor posterior | Plataforma (MSF-206) |
| **Reportes de Etapa 2 con el historial** | Hoy los reportes usan solo datos vivos; incluir el archivo es una decisión abierta | Producto / Reportes |
| **Qué pasa con el panel actual** al 31/12 | Decisión pendiente del cliente; no bloquea esta épica | Producto / cliente |

## Estado

Implementado en la rama de la épica con sus tres historias (F-VTA-37/MSF-293, F-VTA-38/MSF-309 y
F-VTA-39/MSF-322) y el cierre, **pendiente de merge a `main`**. La fuente funcional es
`specs/20261020-100000-ventas-historial-de-consulta/spec.md`; las pruebas están en
`supabase/tests/database/historial_importacion.test.sql`, `historial_listar_ventas_cobros.test.sql` y
`historial_listar_cotizaciones.test.sql`, y en `apps/web/src/pages/historial/*.test.tsx` y
`workers/historial-importador/test/`.

## Para seguir

- **[Ventas · historial de consulta (técnico)](../tecnico/ventas-historial-consulta.md)** — tablas, RPC, worker,
  flow de Kestra, permisos y reversión.
- **[Precios y dólar](precios-dolar.md)** — la cotización **vigente** de la plataforma (no es el historial).
- **[Migración inicial de datos](migracion-inicial-de-datos.md)** — la otra importación del panel anterior (Stock).
- **[Permisos por rol](../permisos-por-rol.md)** — secciones, niveles y reglas por empresa.
- **[Empresa activa](../empresa-activa.md)** — cómo se comporta el cambio de empresa en las pantallas.
