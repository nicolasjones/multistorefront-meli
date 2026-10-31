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

Esquema `analitica` (solo vistas, ver `docs/rentabilidad.md`): migraciones `20270122130100_analitica_service_reparaciones.sql` y `20270122130200_analitica_service_reparacion_items.sql`.

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
- **Registro del reporte** (`seccion = 'service_tecnico'`): lo deja la migración `20270122130300_reportes_service.sql`, que agrega la fila en `public.reportes`, sus roles por defecto (`administracion` y `consulta`, los mismos del manifiesto) y los triggers que la asignan a las organizaciones que tienen el módulo `service-tecnico` habilitado. Es idempotente y su reversión está documentada en el encabezado de la migración.
  - El UUID de embebido lo genera Superset al importar el tablero, así que la fila nace con el slug (`service-tecnico`) y el importador (`infra/superset/importar-dashboards.mjs`) la **actualiza por nombre** con el UUID real: el catálogo no puede tener dos filas del mismo tablero.
  - La asignación automática no da datos de otras organizaciones: el token lleva la cláusula `rls` `organizacion_id = '<org>'` y `resolver_organizacion_reporte` exige `lectura` o `edicion` en `service_tecnico`. El superadmin puede desasignarlo como con cualquier otro reporte.
- **Acceso**: `resolver_organizacion_reporte` (sin cambios) devuelve la organización solo con `lectura` o `edicion` en `service_tecnico` y el reporte asignado; si no, `emitir-acceso-reporte` responde 403 sin emitir token. Pruebas: `supabase/tests/database/service_reportes_acceso.test.sql` y `supabase/functions/emitir-acceso-reporte/handler.test.ts` (cláusula `rls` por `organizacion_id`).
- **Riesgo heredado de Rentabilidad**: el token filtra por organización, no por las tiendas accesibles de la persona. Quien tiene `lectura` restringida a algunas tiendas vería cifras agregadas de todas. Pendiente de decisión de producto (¿solo dirección?).

## Pestaña «Reportes» (FR-064)

`/service-tecnico/reportes` (carga diferida, `ServicioReportes`), última pestaña del módulo y también destino del menú «Servicio técnico → Reportes» (sección `service_tecnico` en `lib/permisos.ts`). Muestra `ReporteEmbebido`; sin `lectura` en `service_tecnico` o ante un 403 muestra «Acceso restringido» y **no pide token**; carga y error con «Reintentar». El tablero compara todas las tiendas, así que **no depende de la empresa activa** de la barra superior (Principio VIII: no aplica; cambiar de empresa no lo recarga).

## Datos de prueba y revisión (FR-066)

`supabase/verificacion/service_datos_prueba.sql` crea una organización de prueba con 12 reparaciones en dos tiendas, varios estados, técnicos e ítems, y es idempotente (una segunda corrida no repite nada). Solo contra la base local:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/verificacion/service_datos_prueba.sql
```

Los conteos esperados están en el encabezado del script y las consultas del final los verifican como `superset_analitica`.

### Revisión del tablero (T055)

Procedimiento repeatable, con la base local y Superset local levantados:

```bash
pnpm dev:supabase            # base local
pnpm dev:superset            # Superset local
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/verificacion/service_datos_prueba.sql
pnpm superset:importar-dashboards -- --directorio infra/superset/dashboards/service --entorno staging
```

Qué mirar, en este orden:

1. **Los conteos del script** (últimas cuatro consultas): 12 reparaciones, 6 por tienda (Tienda Norte / Tienda Sur), 3 Recibido + 2 En diagnóstico + 3 En reparación + 2 Listo para entregar + 2 Entregado, 5 de Ana Pérez + 4 de Luis Gómez + 3 sin técnico, 18 ítems (12 de mano de obra + 6 de repuesto). Correr el script dos veces debe dar los mismos números (es idempotente).
2. **Los cuatro indicadores** del tablero importado, contra esos conteos: reparaciones por estado, por técnico, ingresadas por mes y tienda, e importe al cliente por mes y tienda. Las anuladas no cuentan.
3. **El filtro nativo de tienda**: al elegir una sola tienda, los conteos del tablero coinciden con los de esa tienda.
4. **Que no haya costos internos**: ningún gráfico muestra `costo_mano_obra`, `costo_repuestos` ni ganancia.

Lo que se puede verificar sin Superset ni base (lo que corre en el CI): el contrato de los YAML versionados (`tableroService.contrato.test.ts`: cuatro indicadores, datasets sobre `analitica.service_*`, filtros nativos y ausencia de costos) y el empaquetado del tablero (`infra/superset/empaquetar-dashboards.test.mjs`).

## Pruebas

- `pnpm test:db`: `service_analitica.test.sql` (columnas, sin costos, aislamiento, solo `superset_analitica`) y `service_reportes_acceso.test.sql` (sección, aislamiento entre organizaciones y asignación a las organizaciones que habilitaron el módulo).
- `pnpm test:web -- exportarReparaciones reparaciones reportes tableroService`.
- `pnpm test:superset:importar-dashboards` (empaquetado del tablero de Service y registro del reporte sin duplicarlo).
- E2E `apps/web/e2e/service-exportacion.e2e.ts`: el botón «Exportar» descarga el CSV con las nueve columnas y todas las filas del filtro. Se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (ver `docs/e2e-app.md`).

## Reversión

Sin datos que perder: revertir el merge de la historia (`git revert -m 1`) y, si ya se aplicaron las migraciones, `drop view analitica.service_reparacion_items; drop view analitica.service_reparaciones;` más el camino de reversión de `20270122130300_reportes_service.sql` (borrar la fila del reporte y sus asignaciones y roles). En Superset, borrar el dashboard `service-tecnico`.
