# Implementation Plan: Ventas y despacho · Ventas reportes básicos

**Spec**: [spec.md](./spec.md) · **Épica**: MSF-338 · **Rama**: `epic/MSF-338-ventas-y-despacho-ventas-reportes-basico`
**Alcance de entrega**: `refine` + `supabase` + `superset`. Sin `kestra` ni `workers`.

## Resumen

Dos reportes de Ventas («Más vendidos» y «Ranking de clientes») resueltos con **tableros de Superset embebidos**, alimentados por **vistas del esquema `analitica`** sobre `dominio.comprobantes_venta` y sus líneas. El guest token (spec 007) se extiende con un **filtro por empresa** (empresas accesibles del usuario). Refine pone la pantalla «Reportes de ventas» (pestañas, filtros de período y de empresa, `ReporteEmbebido`) y la exportación a Excel del ranking. Dos historias, cada una con **su propia migración aditiva** y sus pruebas.

## Contexto técnico

- **Frontend**: `apps/web/src/pages/ventas-reportes/` (nuevo) y `apps/web/src/lib/ventas-reportes.ts`; reutiliza `ReporteEmbebido`, `FiltroEmpresa`, `AccesoRestringido`, `EncabezadoPagina`, `PestanasPagina` y los estados compartidos.
- **Base**: sin tablas nuevas; vistas en `analitica` (esquema existente, solo vistas) con funciones de apoyo `security definer`; RPC pública de lectura para el Excel. `revoke … from public, anon`, `grant … to authenticated`.
- **Superset**: YAML versionado en `infra/superset/dashboards/ventas-reportes/` (reutiliza la conexión `analitica` de rentabilidad) + `infra/superset/importar-dashboards.mjs`; registro idempotente en `reportes` con `seccion = 'reportes'`.
- **Edge Function**: `supabase/functions/emitir-acceso-reporte` se extiende con el filtro por empresa (el token ya fuerza `organizacion_id`).
- **Estado actual verificado** (repo): existen `dominio.comprobantes_venta` y `dominio.comprobantes_venta_lineas`, `private.comprobante_cuenta_como_facturado`, `private.signo_comprobante`, `public.ranking_clientes`, `dominio.productos` (`sku`, `categoria_id`), `dominio.categorias`, `dominio.depositos`, `public.stock_estados`, el esquema `analitica` con rol `superset_analitica` (default privileges de `select` sobre tablas de `analitica`), `reportes.seccion`, `public.empresas_para_selector()` y `private.empresas_accesibles()`. **No existen**: las dos vistas `analitica.ventas_*`, los tableros YAML de ventas, el filtro por empresa en el token, la pantalla «Reportes de ventas» y la exportación a Excel de esta épica. Todo lo nuevo se crea por migración o archivo; nada se asume.

## Revisión de la Constitución

| Principio | Cumplimiento |
|---|---|
| I Aislamiento | Sin tablas nuevas; vistas `analitica` con `organizacion_id`/`empresa_id` y token con cláusula `rls` por organización + empresa; pgTAP con dos organizaciones/empresas (SC-002). |
| II Spec primero | Esta spec; cada tarea cita FR/SC. |
| III Idempotencia/auditoría | Importación de tableros idempotente; lecturas idempotentes (sin escritura). |
| IV Despliegues independientes | Superset conserva su Compose; se reutiliza el rol de lectura existente. |
| V Simplicidad | Sin workers ni Kestra; reutiliza el embebido y el importador existentes. |
| VI Panel operable | Entrada «Reportes» junto a Ventas (ícono propio), solo con sección `reportes`; estados compartidos; teclado/lector; 320/768/1440 px; el SDK se carga bajo demanda en `ReporteEmbebido`. |
| VII Esquemas | Solo vistas en `analitica`; RPC pública en `public`; re-verificado en cada fase y en el PR. |
| VIII Empresa activa | Aplica: el filtro de empresa se reencuadra con la empresa activa (fila «Empresa activa» de la matriz); test de cambio de empresa. |
| VIII Documentación | `docs/ventas-reportes.md`, `docs/operar-superset.md`, roadmap y `pnpm docs:check` (cierre). |

## Cálculo (contrato único)

`comprobantes del rango` → predicado `private.comprobante_cuenta_como_facturado` → signo `private.signo_comprobante` → agregado por producto (más vendidos) o por cliente (ranking). Una vista por reporte; el Excel lee la **misma** fuente que el tablero. Contratos en [contracts/analitica-ventas-reportes.md](./contracts/analitica-ventas-reportes.md).

## Riesgos y reversión

- **Filtro por empresa en el token**: Superset acepta una sola cláusula `rls`. Se interpola `empresa_id IN (…)` con UUIDs validados server-side. Si no admite la lista dinámica, se acota a la empresa activa y se declara `Desvío:` (Decisión 4).
- **Rol de Superset vs. RLS de `comprobantes_venta`**: la tabla tiene RLS `to authenticated`; el rol `superset_analitica` no es `authenticated`, así que las vistas corren con los privilegios de su dueño (el runner de migraciones) y, como en rentabilidad, envuelven las funciones `security invoker` en helpers `security definer` de `analitica` para que el rol no necesite `private` ni `auth.uid()`.
- **`stock_hoy`/`stock_estado`**: `public.stock_estados` es `security_invoker`; se envuelve en un helper `security definer` de `analitica` (mismo patrón).
- **Exportación a Excel**: el ranking es Superset; el Excel se genera en Refine contra la **misma** vista (RPC de lectura `security definer`/`invoker`), no contra la UI, para que `CA-VTA-23-1` se cumpla. Si la vista no es consultable desde Refine con el filtro de empresa del usuario, se usa una RPC que replique el filtro (`organizacion_id` + empresas accesibles).
- **Reversión** (migraciones aditivas; el camino va en el encabezado de cada una): quitar las dos vistas `analitica.ventas_*` y sus helpers, la RPC de lectura del Excel y, si se agregó, la columna/parametro del token; restaurar `emitir-acceso-reporte`/`resolver` a la versión previa.

## Estructura

```text
supabase/migrations/20270104090000_analitica_ventas_producto_mas_vendido.sql   # F-VTA-22 (vista + helpers)
supabase/migrations/20270104090100_analitica_ventas_ranking_clientes.sql       # F-VTA-23 (vista + helpers)
supabase/migrations/20270104090200_lectura_ranking_excel.sql                   # F-VTA-23 (RPC del Excel)
supabase/tests/database/ventas_reportes_*.test.sql
infra/superset/dashboards/ventas-reportes/
apps/web/src/pages/ventas-reportes/ · apps/web/src/lib/ventas-reportes.ts
supabase/functions/emitir-acceso-reporte/ (extensión por empresa)
docs/ventas-reportes.md
contracts/analitica-ventas-reportes.md
```
