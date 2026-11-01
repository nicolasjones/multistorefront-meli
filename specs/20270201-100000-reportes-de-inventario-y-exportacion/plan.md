# Implementation Plan: Inicio, rentabilidad y reportes · Reportes de inventario y exportación

**Spec**: [spec.md](./spec.md) · **Épica**: MSF-140 · **Rama**: `epic/MSF-140-inicio-rentabilidad-y-reportes-reportes-`
**Alcance de entrega**: `refine` + `supabase` + `superset`. Sin `kestra` ni `workers`.

## Resumen

Dos tableros de Superset embebidos («Productos y stock», «Reposición») sobre vistas nuevas del esquema `analitica`, agrupados en un menú «Reportes» del panel, más la configuración de la descarga CSV nativa de Superset (UTF-8, `;`, coma decimal). Sin tablas nuevas.

## Contexto técnico

- **Frontend**: `apps/web/src/pages/reportes/` (nuevo) y `apps/web/src/lib/reportes-inventario.ts`; reutiliza `ReporteEmbebido`, `AccesoRestringido`, `EncabezadoPagina` y los estados compartidos.
- **Base**: dos vistas en `analitica`, `select` solo a `superset_analitica`; estado Sin stock/Bajo/Normal con la misma regla que `public.stock_estados`; costos en pesos con `analitica.a_pesos` (cotización vigente).
- **Superset**: YAML en `infra/superset/dashboards/inventario/` + `reportes.json` (`seccion: stock`) + importador existente; `CSV_EXPORT` en `superset_config.py`.
- **Sin Edge Function ni RPC nuevas**: no hay `contracts` de RPC; el contrato de lectura de las vistas está en `contracts/analitica-inventario.md`.

## Revisión de la Constitución

| Principio | Cumplimiento |
|---|---|
| I Aislamiento | Vistas con `organizacion_id`; token con cláusula `rls` por organización; pgTAP con dos organizaciones. |
| II Spec primero | Esta spec; cada tarea cita FR/SC. |
| III Idempotencia | Importación de tableros idempotente; lecturas sin escritura. |
| IV Despliegues independientes | Superset conserva su Compose y su rol de lectura. |
| V Simplicidad | Sin workers ni Kestra; la exportación es la nativa de Superset. |
| VI Panel operable | Menú «Reportes» con ícono propio, ruta canónica, estados compartidos, teclado/lector, 320/768/1440 px, SDK diferido en `ReporteEmbebido`. |
| VII Esquemas | Solo vistas en `analitica`; datos de `reportes` en `public` (plataforma); re-verificado en cada fase y PR. |
| VIII Empresa activa | No aplica (inventario por organización; ver matriz). |
| VIII Documentación | `docs/reportes-inventario.md`, `docs/operar-superset.md`, roadmap y `pnpm docs:check` (cierre). |

## Reversión (migraciones aditivas)

- `20270201090000`: `drop view analitica.inventario_productos_stock;`
- `20270201090100`: `drop view analitica.inventario_reposicion;`
- Alta en `public.reportes`: desregistrar por `dashboard_slug` (los tableros no guardan datos).
- `CSV_EXPORT`: quitar la clave de `superset_config.py` (vuelve al formato por defecto de Superset).

## Riesgos

- Costos visibles a quien abre el tablero (Decisión abierta 3).
- `CSV_EXPORT` es global: cambia el formato de descarga de los reportes de Ventas y Rentabilidad ya existentes (es lo pedido: «cualquier reporte»).
