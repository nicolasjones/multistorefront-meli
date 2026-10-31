# Service técnico · Reportes y exportación (F-SVC-23, MSF-168)

Dos piezas de la épica MSF-124: el botón **Exportar** del listado de reparaciones y el tablero **Service técnico** de Superset, embebido en la pestaña **Reportes**. Spec: `specs/20261028-100000-service-seguimiento-y-reportes/` (FR-060…FR-066, SC-009, SC-010).

## Exportar el listado (FR-060, FR-061)

- Botón «Exportar» en `/service-tecnico/reparaciones`, visible con la acción `exportar` en `service_tecnico` (`usePuedeAccion`). El nivel de lectura por sí solo no alcanza: es una acción propia de la matriz de permisos.
- Descarga `reparaciones-AAAA-MM-DD.csv` con el formato de las demás exportaciones (`docs/stock-exportacion.md`): UTF-8 con BOM, `;`, CRLF y `neutralizarFormula`.
- **Nueve columnas, como se ven en la tabla**: Reparación, Tienda, Cliente, Equipo (equipo y modelo), N.º de serie, Estado, Técnico, Entrega, Total. Se declaran en un solo arreglo, `COLUMNAS` de `apps/web/src/lib/exportarReparaciones.ts`.
- **Todas las filas del filtro vigente** (período, N.º de serie, técnico y empresa activa), no solo la página. Pide `listar_reparaciones` por lotes de 200 (el máximo de la RPC) con `useExportarCsv`; tope de 100.000 filas con aviso.
- **Contexto congelado**: al pulsar se guardan los filtros y la empresa activa; si cambian mientras corre, el archivo sigue siendo el de la consulta que se pidió.
- Si algo falla no se descarga nada y el aviso ofrece «Reintentar». Sin filas, se descarga solo el encabezado con el aviso «No hay filas para exportar».
- **Sin costos internos ni ganancia y sin RPC nueva**: usa `listar_reparaciones`, con su RLS y su límite por tienda accesible. El «Total» es el importe de cara al cliente.

## Vistas de analítica (FR-062)

Esquema `analitica` (solo vistas, ver `docs/rentabilidad.md`): migraciones `20261028130100_analitica_service_reparaciones.sql` y `20261028130200_analitica_service_reparacion_items.sql`.

| Vista | Una fila por | Columnas |
|---|---|---|
| `analitica.service_reparaciones` | reparación | `organizacion_id`, `empresa_id`, `empresa_nombre`, `reparacion_id`, `codigo`, `ingreso_en`, `entrega_prevista`, `entrega_real`, `estado_id`, `estado_nombre`, `estado_cierra`, `tecnico_id`, `tecnico_nombre`, `equipo`, `modelo`, `anulada`, `total_mano_obra`, `total_repuestos`, `total_cliente` |
| `analitica.service_reparacion_items` | ítem | `organizacion_id`, `empresa_id`, `empresa_nombre`, `reparacion_id`, `item_id`, `tipo`, `cantidad`, `subtotal`, `ingreso_en` |

- Sin tablas ni RLS propias: el aislamiento lo hace la cláusula `rls` del guest token (`organizacion_id = '<org>'`). Las vistas no son legibles por `anon` ni `authenticated`; solo `select` para `superset_analitica`.
- Nunca exponen `costo_mano_obra`, `costo_repuestos`, ganancia ni correos. El técnico sale con su nombre visible.
- Reversión (migración posterior; nada guarda datos): `drop view analitica.service_reparacion_items; drop view analitica.service_reparaciones;`.

## Tablero y reporte (FR-063, FR-065)

- YAML versionado en `infra/superset/dashboards/service/` (dashboard `service-tecnico`, cuatro gráficos y dos datasets). Se importa con `pnpm superset:importar-dashboards -- --directorio infra/superset/dashboards/service --entorno <staging|production>`; el workflow `deploy-infraestructura-vps.yml` lo importa junto con Rentabilidad. La conexión es la misma de Rentabilidad (mismo `uuid`, contraseña enmascarada).
- **Indicadores** (provisorios, *Decisiones abiertas* 6 de la spec): reparaciones por estado, reparaciones por técnico, reparaciones ingresadas por mes y tienda, importe al cliente por mes y tienda (mano de obra y repuestos). Las reparaciones anuladas no cuentan. Filtros nativos de Superset: tienda y período de ingreso.
- **Registro del reporte**: la fila de `public.reportes` (`seccion = 'service_tecnico'`) no sale de una migración sino de `infra/superset/dashboards/service/reportes.json`: el importador la registra de forma idempotente junto con el UUID de embebido que genera Superset, igual que Rentabilidad. La asignación a cada organización la hace el superadmin.
- **Acceso**: `resolver_organizacion_reporte` (sin cambios) devuelve la organización solo con `lectura` o `edicion` en `service_tecnico` y el reporte asignado; si no, `emitir-acceso-reporte` responde 403 sin emitir token. Pruebas: `supabase/tests/database/service_reportes_acceso.test.sql` y `supabase/functions/emitir-acceso-reporte/handler.test.ts` (cláusula `rls` por `organizacion_id`).
- **Riesgo heredado de Rentabilidad**: el token filtra por organización, no por las tiendas accesibles de la persona. Quien tiene `lectura` restringida a algunas tiendas vería cifras agregadas de todas. Pendiente de decisión de producto (¿solo dirección?).

## Pestaña «Reportes» (FR-064)

`/service-tecnico/reportes` (carga diferida, `ServicioReportes`), última pestaña del módulo. Muestra `ReporteEmbebido`; sin `lectura` en `service_tecnico` o ante un 403 muestra «Acceso restringido» y **no pide token**; carga y error con «Reintentar». El tablero compara todas las tiendas, así que **no depende de la empresa activa** de la barra superior (Principio VIII: no aplica; cambiar de empresa no lo recarga).

## Datos de prueba y revisión (FR-066)

`supabase/verificacion/service_datos_prueba.sql` crea una organización de prueba con 12 reparaciones en dos tiendas, varios estados, técnicos e ítems, y es idempotente (una segunda corrida no repite nada). Solo contra la base local:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/verificacion/service_datos_prueba.sql
```

Los conteos esperados están en el encabezado del script y las consultas del final los verifican como `superset_analitica`.

## Pruebas

- `pnpm test:db`: `service_analitica.test.sql` (columnas, sin costos, aislamiento, solo `superset_analitica`) y `service_reportes_acceso.test.sql`.
- `pnpm test:web -- exportarReparaciones reparaciones reportes tableroService`.
- `pnpm infra:config` y `pnpm test:superset:importar-dashboards`.

## Reversión

Sin datos que perder: revertir el merge de la historia (`git revert -m 1`), y `drop view analitica.service_reparacion_items; drop view analitica.service_reparaciones;` si ya se aplicaron las migraciones. En Superset, borrar el dashboard `service-tecnico` y el reporte desde la administración de reportes.
