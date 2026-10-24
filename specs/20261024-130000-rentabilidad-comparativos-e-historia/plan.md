# Implementation Plan: Inicio, rentabilidad y reportes · Rentabilidad comparativos e historia

**Spec**: [spec.md](./spec.md) · **Épica**: MSF-127 · **Rama**: `epic/MSF-127-inicio-rentabilidad-y-reportes-rentabili`
**Alcance de entrega**: `refine` + `supabase` + `superset`. Sin `kestra` ni `workers`.

## Resumen

Dos tableros nuevos de Superset, embebidos como pestañas de `/rentabilidad` (MSF-120), alimentados por dos vistas nuevas del esquema `analitica`: el **comparativo** (mismo producto entre empresas, derivado de `margen_producto_canal`) y la **historia** (producto × empresa × cotización de cada fecha, con el costo vigente de esa fecha). Cada historia trae su propia migración aditiva. F-REN-07 tiene una **compuerta** sobre la fuente del costo histórico (hoy Actividad no guarda importes).

## Contexto técnico

- **Frontend**: `apps/web/src/pages/rentabilidad/` (existe por MSF-120): se suman las pestañas `Comparativo` e `Historia` con `ReporteEmbebido`, `AccesoRestringido`, estados compartidos.
- **Base**: solo vistas/funciones en `analitica`; sin tablas ni RPC nuevas. Aislamiento por `organizacion_id` + cláusula `rls` del guest token; rol de Superset de MSF-120.
- **Superset**: YAML versionado en `infra/superset/dashboards/rentabilidad/`; registro idempotente en `reportes` (`seccion = 'rentabilidad'`) con `importar-dashboards.mjs`.
- **Estado actual verificado** (repo): existen `analitica.margen_producto_canal`, `rentabilidad_resumen_empresa`, `rentabilidad_consolidado` (migraciones `20261130100200`, `20261130110000`), `analitica.a_pesos`/`neto_empresa`, `dominio.cotizaciones` (append-only, `valor`, `cargada_en`; F-PRE-04), `private.a_pesos`, `private.insertar_actividad`, `public.registro_actividad` (`detalle` texto ≤ 500). El costo se registra como `producto.precio_actualizado` «Cambió el costo de X» **sin importes**. **No existen**: tipo `producto.costo_modificado`, valores de costo anterior/nuevo en Actividad, historia de costos, ni las vistas/pestañas de esta épica.
- **Convención de migraciones**: `20270111100000_analitica_margen_comparativo.sql` (F-REN-06) y `20270111110000_analitica_margen_historico.sql` (F-REN-07); cada una con su reversión en el encabezado y sin depender de la otra.

## Revisión de la Constitución

| Principio | Cumplimiento |
|---|---|
| I Aislamiento | Vistas con `organizacion_id` y token con `rls`; pgTAP con dos organizaciones (SC-002, SC-005). |
| II Spec primero | Esta spec; cada tarea cita FR/SC. |
| III Idempotencia/auditoría | Importación de tableros idempotente; sin escrituras nuevas. |
| IV Despliegues independientes | Superset conserva su Compose; sin variables nuevas. |
| V Simplicidad | Sin workers/Kestra; reutiliza el embebido y el rol de MSF-120. |
| VI Panel operable | Pestañas en `/rentabilidad` (ya en menú «Análisis»), solo con sección; estados compartidos; teclado/lector; 320/768/1440 px; carga diferida del SDK ya resuelta en `ReporteEmbebido`. |
| VII Esquemas | Sin tablas nuevas (`analitica` solo vistas). Si se elige historia de costos propia: `dominio`, con RLS, y se re-verifica. |
| VIII Empresa activa | No aplica con motivo (compara todas las empresas); test en SC-003/SC-006. |
| VIII Documentación | `docs/rentabilidad.md`, `docs/operar-superset.md`, roadmap y `pnpm docs:check` (cierre). |

## Riesgos y reversión

- **Fuente del costo histórico (alto)**: Actividad no tiene importes; sin decisión de Nicolás F-REN-07 no se construye (FR-009). Si no se resuelve, las tareas bloqueadas se cierran con `Desvío:` y se traza una Historia `[Deuda MSF-127]` con label `deuda`, hija de la épica.
- **Filtro de producto en «Historia»**: usa filtro nativo de Superset; si el SDK embebido no lo permite, `Desvío:` documentado.
- **Reversión** (migración posterior, nunca en el PR que crea): `drop view analitica.margen_comparativo_producto;` `drop view analitica.margen_historico_producto_canal;` `drop function analitica.costo_en_fecha(uuid, uuid, timestamptz);` y quitar las filas de `reportes`.

## Estructura

```text
supabase/migrations/20270111100000_analitica_margen_comparativo.sql   # F-REN-06
supabase/migrations/20270111110000_analitica_margen_historico.sql     # F-REN-07
supabase/tests/database/rentabilidad_comparativo*.test.sql · rentabilidad_historia*.test.sql
infra/superset/dashboards/rentabilidad/ (datasets y dashboards Comparativo e Historia)
apps/web/src/pages/rentabilidad/ (pestañas)
docs/rentabilidad.md
```
