# Implementation Plan: Inicio, rentabilidad y reportes · Rentabilidad comparativos e historia

**Spec**: [spec.md](./spec.md) · **Épica**: MSF-127 · **Rama**: `epic/MSF-127-inicio-rentabilidad-y-reportes-rentabili`
**Alcance de entrega**: `refine` + `supabase` + `superset`. Sin `kestra` ni `workers`.
**Estado de cola**: `espera-fase` (decisión del CTO, AGE-1102, 24/10): sin bloqueo técnico; se despacha por cupo, primero F-REN-06 (MSF-261) y luego F-REN-07 (MSF-280). Sin rama nueva ni re-especificación.

## Resumen

Dos tableros nuevos de Superset, embebidos como pestañas de `/rentabilidad` (MSF-120), alimentados por vistas del esquema `analitica`: el **comparativo** (mismo producto entre empresas, solo productos presentes en 2 o más empresas, derivado de `margen_producto_canal`) y la **historia** (producto × empresa × fecha, con el costo vigente de esa fecha y el precio convertido con la cotización más cercana). F-REN-07 guarda una **historia de costos propia** (`dominio.producto_costos_historial`, decisión de Nicolás), alimentada por un disparador sobre `dominio.producto_costos`. Cada historia trae su propia migración aditiva.

## Contexto técnico

- **Frontend**: `apps/web/src/pages/rentabilidad/` (existe por MSF-120): se suman las pestañas `Comparativo` e `Historia` con `ReporteEmbebido`, `AccesoRestringido`, estados compartidos.
- **Base**: vistas/funciones en `analitica`, una tabla nueva en `dominio` (`producto_costos_historial`) y un disparador sobre `dominio.producto_costos`; sin RPC nuevas ni cambio de firmas. Aislamiento por `organizacion_id` + cláusula `rls` del guest token; rol de Superset de MSF-120.
- **Superset**: YAML versionado en `infra/superset/dashboards/rentabilidad/`; registro idempotente en `reportes` (`seccion = 'rentabilidad'`) con `importar-dashboards.mjs`.
- **Estado actual verificado** (repo): existen `analitica.margen_producto_canal`, `rentabilidad_resumen_empresa`, `rentabilidad_consolidado` (migraciones `20261130100200`, `20261130110000`), `dominio.cotizaciones` (append-only, `valor`, `cargada_en`; F-PRE-04), `dominio.producto_costos`, `private.a_pesos`, `private.insertar_actividad`. El costo se registra en Actividad como `producto.precio_actualizado` «Cambió el costo de X» **sin importes** (se mantiene). Escriben `dominio.producto_costos` varios flujos (`actualizar_producto`, RPC de proveedores, ingreso de mercadería): un disparador los cubre a todos. **No existen** `dominio.producto_costos_historial` ni las vistas/pestañas de esta épica.
- **Convención de migraciones**: `20270111100000_analitica_margen_comparativo.sql` y `20270111100100_analitica_margen_comparativo_diferencia.sql` (F-REN-06); `20270111110000_dominio_producto_costos_historial.sql` y `20270111110100_analitica_margen_historico.sql` (F-REN-07). Cada historia con su reversión en el encabezado y sin depender de la otra.

## Revisión de la Constitución

| Principio | Cumplimiento |
|---|---|
| I Aislamiento | Vistas con `organizacion_id` y token con `rls`; tabla de historia con RLS; pgTAP con dos organizaciones (SC-002, SC-005). |
| II Spec primero | Esta spec; cada tarea cita FR/SC. |
| III Idempotencia/auditoría | Importación de tableros idempotente; la historia de costos es append-only y no duplica filas ante el mismo costo. |
| IV Despliegues independientes | Superset conserva su Compose; sin variables nuevas. |
| V Simplicidad | Sin workers/Kestra; reutiliza el embebido y el rol de MSF-120. |
| VI Panel operable | Pestañas en `/rentabilidad` (ya en menú «Análisis»), solo con sección; estados compartidos; teclado/lector; 320/768/1440 px; carga diferida del SDK ya resuelta en `ReporteEmbebido`. |
| VII Esquemas | `dominio.producto_costos_historial` (dato de negocio → `dominio`, RLS por organización y `rentabilidad`, append-only); `analitica` solo vistas/funciones. Re-verificado en T010 y T022. |
| VIII Empresa activa | No aplica con motivo (compara todas las empresas); test en SC-003/SC-006. |
| VIII Documentación | `docs/rentabilidad.md`, `docs/operar-superset.md`, roadmap y `pnpm docs:check` (cierre). |

## Riesgos y reversión

- **Costos previos al lanzamiento (medio)**: la historia empieza al crear la tabla; la siembra deja una fila por costo existente, así que antes de esa fecha no hay margen (FR-012). Se documenta en `docs/rentabilidad.md`.
- **Escritores del costo (bajo)**: el disparador sobre `dominio.producto_costos` cubre todo escritor actual y futuro; pgTAP lo prueba con el RPC de catálogo.
- **Filtro de producto en «Historia»**: usa filtro nativo de Superset; si el SDK embebido no lo permite, `Desvío:` documentado.
- **Reversión** (migración posterior, nunca en el PR que crea): `drop view analitica.margen_historico_producto_canal; drop view analitica.margen_comparativo_producto; drop function analitica.costo_en_fecha(uuid, uuid, timestamptz); drop function analitica.cotizacion_cercana(uuid, timestamptz);`, quitar el disparador de `dominio.producto_costos`, `drop table dominio.producto_costos_historial;` (tras exportar) y borrar las filas de `reportes`.

## Estructura

```text
supabase/migrations/20270111100000_analitica_margen_comparativo.sql            # F-REN-06
supabase/migrations/20270111100100_analitica_margen_comparativo_diferencia.sql # F-REN-06
supabase/migrations/20270111110000_dominio_producto_costos_historial.sql       # F-REN-07
supabase/migrations/20270111110100_analitica_margen_historico.sql              # F-REN-07
supabase/tests/database/rentabilidad_comparativo*.test.sql · rentabilidad_historia*.test.sql
infra/superset/dashboards/rentabilidad/ (datasets y dashboards Comparativo e Historia)
apps/web/src/pages/rentabilidad/ (pestañas)
docs/rentabilidad.md
```
