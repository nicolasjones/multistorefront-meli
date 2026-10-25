# Exportar stock y movimientos (F-STK-08, MSF-388)

Botón **Exportar** en `/stock` (Stock actual) y `/stock/movimientos` (Movimientos). Descarga un CSV con lo que la pantalla muestra. Spec: `specs/20261024-130000-stock-carga-exportacion-y-avisos/` (FR-101…FR-108, SC-101, SC-102).

## Qué respeta la exportación

- **Filtros activos**: en Stock actual, búsqueda por nombre o SKU, estado («Ver solo alertas» incluido) y el depósito elegido (las cifras salen del depósito, como en la tabla); en Movimientos, el filtro por producto. Se exportan **todas las filas del filtro**, no solo la página visible.
- **Columnas visibles**: las mismas columnas de datos, con sus encabezados y orden, sin la columna de acciones. Cada pantalla declara sus columnas en un solo arreglo que usan la tabla y el CSV (`COLUMNAS` en `movimientos.tsx`, `columnasStock` en `list.tsx`), así no se desfasan.
- **Valores como se ven**: estado en palabras, fechas legibles, cantidades como números. La celda «Producto» trae `Nombre · SKU` y «Motivo / nota» trae ambos separados por « · ». En Movimientos la «Diferencia» de un ajuste no es columna propia (la tabla la muestra como texto secundario de «Cantidad»), por lo que el CSV trae solo la cantidad.
- **Permisos**: lo ve y lo usa quien tenga `lectura` o `edicion` en Stock (exportar no escribe). La exportación lee la **misma fuente y RLS** que la pantalla: `stock_estados` y `listar_movimientos_stock`. No hay RPC ni permisos nuevos.

## Formato

UTF-8 con BOM (Excel lo abre bien con acentos), separador `;`, fin de línea CRLF, comillas dobles escapadas duplicándolas. Los textos que empiezan con `=`, `+`, `-`, `@`, tab o retorno se neutralizan con `neutralizarFormula` (apóstrofo inicial), la misma función de las otras exportaciones.

Nombre: `stock-actual-AAAA-MM-DD.csv` y `movimientos-stock-AAAA-MM-DD.csv`; la fecha es la de hoy en la zona de la organización (`ZONA_ORGANIZACION`).

## Lotes, tope y errores

- Pide por lotes (`useExportarCsv`): 200 filas en Stock actual (cada lote arma un `in (…)` con sus ids para las cifras por depósito) y 100 en Movimientos (tope de `listar_movimientos_stock`).
- **Tope de 100.000 filas**: si hay más, se exportan las primeras 100.000 y se avisa que se afinen los filtros.
- Mientras corre, el botón dice «Exportando…» y queda deshabilitado (no hay doble exportación).
- Si algo falla, **no se descarga nada** (nunca un archivo parcial) y aparece un aviso «No pudimos exportar…» con «Reintentar».
- Sin filas: se descarga el CSV con solo los encabezados y un aviso «No hay filas para exportar».

## Reversión

No hay SQL: no se agregan migraciones, tablas ni funciones. Revertir es sacar el botón (revertir el merge de la historia con `git revert -m 1`).

## Pruebas

`apps/web/src/lib/exportarCsv.test.ts` (formato, neutralización, nombre), y los bloques «Exportar» de `pages/stock/list.test.tsx` y `pages/stock/movimientos.test.tsx` (filtros, lotes, columnas = pantalla, error sin archivo, sin filas, tope, rol `lectura`).
