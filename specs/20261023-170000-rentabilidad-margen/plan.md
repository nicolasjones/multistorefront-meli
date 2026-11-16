# Implementation Plan: Inicio, rentabilidad y reportes · Rentabilidad margen

**Spec**: [spec.md](./spec.md) · **Épica**: MSF-120 · **Rama**: `epic/MSF-120-inicio-rentabilidad-y-reportes-rentabili`
**Alcance de entrega**: `refine` + `supabase` + `superset`. Sin `kestra` ni `workers`.

## Resumen

El margen se **calcula al leer** en vistas del esquema `analitica` (neto de la tienda − costo − comisión 0), con un umbral de margen bajo por organización. Superset sirve dos tableros embebidos («Resumen» y «Por producto») filtrados por organización con el guest token; Refine pone la pantalla `/rentabilidad` (pestañas, aviso con navegación, diálogo del umbral, acceso restringido, error con reintento). Tres historias, cada una con **su propia migración aditiva** y sus pruebas.

## Contexto técnico

- **Frontend**: `apps/web/src/pages/rentabilidad/` (nuevo) y `apps/web/src/lib/rentabilidad.ts`; reutiliza `ReporteEmbebido`, `AccesoRestringido`, `EncabezadoPagina`, estados compartidos y la entrada de menú junto a Analítica (`App.tsx`).
- **Base**: tabla en `dominio`, RPC en `public`, vistas en `analitica` (esquema nuevo, solo vistas), rol de solo lectura para Superset. RPC `security invoker`, `set search_path = ''`, `revoke … from public, anon`, `grant execute … to authenticated`.
- **Superset**: YAML versionado en `infra/superset/dashboards/rentabilidad/` (database, datasets, charts, dashboards) + empaquetado y `infra/superset/importar-dashboards.mjs`; registro idempotente en `reportes` con `seccion = 'rentabilidad'`.
- **Edge Function**: `supabase/functions/emitir-acceso-reporte` se extiende con la restricción por sección (el token ya fuerza `organizacion_id`).
- **Estado actual verificado** (repo): existen `dominio.productos`, `dominio.producto_costos`, `public.precios_empresa_neto`, `private.a_pesos`, `private.nivel_seccion`, `private.insertar_actividad`, `permisos_rol` (`rentabilidad`: Administrador=E, Administración=L), tablas `reportes*` y `resolver_organizacion_reporte`, `ReporteEmbebido`, `importar-dashboards.mjs`. **No existen**: esquema `analitica`, `rentabilidad_config`, `reportes.seccion`, conexión de Superset a la base de la app, dashboards YAML, pantalla Rentabilidad. Todo lo nuevo se crea por migración o archivo; nada se asume.

## Revisión de la Constitución

| Principio | Cumplimiento |
|---|---|
| I Aislamiento | `rentabilidad_config` con RLS por organización; vistas con `organizacion_id` y token con cláusula `rls`; pgTAP con dos organizaciones (SC-003). |
| II Spec primero | Esta spec; cada tarea cita FR/SC. |
| III Idempotencia/auditoría | RPC idempotente con evento `rentabilidad.umbral_actualizado`; importación de tableros idempotente. |
| IV Despliegues independientes | Superset conserva su Compose; el rol de lectura se declara en `.env.example`. |
| V Simplicidad | Sin workers ni Kestra; reutiliza el embebido de la spec 007. |
| VI Panel operable | Entrada «Rentabilidad» en el menú Análisis (ícono propio), solo con sección; estados compartidos; teclado/lector; 320/768/1440 px; el SDK de Superset ya se carga bajo demanda en `ReporteEmbebido`. |
| VII Esquemas | `rentabilidad_config` en `dominio`; `analitica` solo vistas; `reportes.seccion` en `public` (plataforma). Se re-verifica en cada fase y en el PR. |
| VIII Empresa activa | No aplica con motivo (compara todas las empresas); test en SC-004. |
| VIII Documentación | `docs/rentabilidad.md`, `docs/operar-superset.md`, roadmap y `pnpm docs:check` (cierre). |

## Cálculo (contrato único)

`neto` (`public.precios_empresa_neto`) → `costo` en pesos (`private.a_pesos`) → `margen = neto − costo − 0` → `margen_pct = margen / neto` → estado contra el umbral → agregados (consolidado = Σ márgenes ÷ Σ netos). Una sola vista base (`analitica.margen_producto_canal`); resumen y consolidado se derivan de ella. Contratos en [contracts/analitica-margen.md](./contracts/analitica-margen.md).

## Riesgos y reversión

- **Filtro inicial desde el resumen**: pasar el estado a un filtro nativo de Superset requiere `urlParams`/filtros nativos del SDK embebido; se valida en T027. Fallback: `Desvío:` documentado y apertura en «Todos» ordenada por menor margen.
- **Conexión de Superset a la base de la app**: hoy Superset solo tiene su propia base; hace falta red y rol de lectura (FR-008). Si el entorno no lo permite, se traza como `Desvío:` con Tarea `seguimiento`.
- **Dos organizaciones con Superset**: lo verifica SC-003; si falla, se bloquea el merge.
- **Reversión** (migraciones aditivas; el camino va en el encabezado de cada una y se aplica en una migración posterior, nunca en el PR que crea): quitar las tres vistas y el esquema `analitica`, las tres RPC, la tabla `dominio.rentabilidad_config` y la columna `public.reportes.seccion`, y restaurar `resolver_organizacion_reporte` de la spec 007.

## Estructura

```text
supabase/migrations/20261130100000_rentabilidad_umbral.sql                # F-REN-01
supabase/migrations/20261130100100_rentabilidad_umbral_actividad.sql
supabase/migrations/20261130100200_analitica_margen_producto_canal.sql
supabase/migrations/20261130100300_analitica_rol_superset.sql
supabase/migrations/20261130100400_reportes_seccion.sql
supabase/migrations/20261130110000_analitica_rentabilidad_resumen.sql     # F-REN-02
supabase/migrations/20261130110100_rentabilidad_conteo_margen.sql
supabase/tests/database/rentabilidad_*.test.sql
infra/superset/dashboards/rentabilidad/
apps/web/src/pages/rentabilidad/ · apps/web/src/lib/rentabilidad.ts
docs/rentabilidad.md
```
