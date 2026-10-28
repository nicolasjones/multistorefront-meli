# Implementation Plan: Service técnico · Service seguimiento y reportes

**Branch**: `epic/MSF-124-service-tecnico-service-seguimiento-y-re` | **Date**: 2026-10-28 | **Spec**: [spec.md](./spec.md) | **Épica**: MSF-124

## Summary

Cuatro historias independientes en datos y acopladas solo por archivos compartidos: (1) adjuntos de fotos con tabla de dominio y bucket privado; (2) reingreso por garantía como reparación nueva vinculada (`reparacion_origen_id`); (3) enlace de consulta sin cuenta, con token, Edge Function pública, límite de tasa por IP y página fuera del panel; (4) exportación del listado filtrado y reportes de Superset por organización (vistas `analitica.service_*` + tablero YAML + pestaña «Reportes»). No se cambia ninguna firma existente.

## Technical Context

- **Lenguaje/Stack**: TypeScript + React + Refine + MUI (`apps/web`), Supabase self-hosted (Postgres, RPC, Storage, Edge Functions, pgTAP), Superset embebido. Sin Kestra ni workers (Constitución IV, V).
- **Pruebas**: pgTAP (`pnpm test:db`), Vitest (`pnpm test:web`), tests de Edge Function (Deno, como `solicitar-acceso/handler.test.ts`), E2E Playwright (`apps/web/e2e/*.e2e.ts`, se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`; ver `docs/e2e-app.md`).
- **Validación**: `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm infra:config`, `pnpm docs:check`, `pnpm matriz:check`, `pnpm prototipo:check`.
- **Restricciones**: migraciones aditivas con reversión en el encabezado; `anon` sin privilegios ni ejecución; `revoke … from public, anon` + `grant execute … to authenticated` en cada RPC; service-role solo en el servidor (Edge Function); costos internos nunca en reportes, exportación, enlace ni documentos.
- **Verificado en el árbol (no inventado)**: `dominio.reparaciones`, `reparacion_historial`, `reparacion_items`, `obtener_reparacion`, `listar_reparaciones`, `tecnicos_de_service`, `private.siguiente_numero_reparacion` y `private.registrar_actividad` (MSF-182/MSF-199); `public.reportes`, `resolver_organizacion_reporte`, `reportes.seccion` (`20261130100400`), rol `superset_analitica` (`20261130100300`), esquema `analitica` con `margen_producto_canal` como patrón de vista; `emitir-acceso-reporte`, `ReporteEmbebido`; buckets `historial-importaciones` (`20261020100010`) y `productos-imagenes` como patrón de políticas de Storage; `useExportarCsv` y `neutralizarFormula` (`docs/stock-exportacion.md`); la acción `exportar` por sección (`lib/permisos.ts`, `usePuedeAccion`); `extensions.gen_random_bytes` (usado en `20261003232000`).
- **No existe** (se construye): bucket y tabla de adjuntos de Service, tabla de enlaces, endpoint público con límite de tasa por IP, vistas `analitica.service_*`, tablero de Service y exportación del listado.

## Constitution Check

| Principio | Cumplimiento |
|-----------|--------------|
| I. Aislamiento multi-tenant | Tres tablas nuevas con RLS (`reparacion_adjuntos` por organización/nivel/tienda; `reparacion_enlaces_consulta` y `consultas_publicas_intentos` con RLS sin políticas ni grants); bucket privado por prefijo de organización; guest token con `rls` por `organizacion_id`; pgTAP de aislamiento entre dos organizaciones. |
| II. Especificar antes de implementar | Esta spec, con FR/SC y dueño único por tarea. |
| III. Idempotencia y auditoría | `obtener_enlace_consulta` idempotente (`unique` + `on conflict`); adjuntos, garantía y enlace registran actividad en la misma transacción; el contador de tasa es un `upsert` atómico. |
| IV. Despliegues independientes | Refine, Supabase (migraciones + función) y Superset (YAML) conservan su ciclo; sin Compose raíz. |
| V. Simplicidad | Sin infraestructura nueva: Storage, Edge Functions y Superset ya existen; exportación CSV sin dependencia nueva. |
| VI. Panel operable | Sección y diálogos en el detalle existente; pestaña «Reportes» en el módulo (ubicación provisoria, *Decisiones abiertas* 1); estados de carga/vacío/error/éxito compartidos; teclado y 320/768/1440 px; carga diferida de diálogos, página pública y reportes. |
| VII. Esquemas | Declarado por objeto en la spec: `dominio` (adjuntos, enlaces, columna de garantía), `public` (contador de tasa, fila de `reportes`), `analitica` (vistas). **Se re-verifica en tareas, implementación y revisión del PR.** |
| VIII. Empresa activa | Exportación: respeta y congela la empresa activa. Detalle y diálogos: heredan la tienda de la reparación; el diálogo de reingreso se cierra al cambiar de empresa. Reportes y página pública: «no aplica» con motivo (matriz). |
| Documentación | `docs/service-adjuntos.md`, `service-garantia.md`, `service-seguimiento.md`, `service-reportes.md`, `actividad.md`, `service-tecnico.md`, `roadmap-template.md`. |

## Decisiones técnicas

- **RPC aparte en vez de reemplazar `obtener_reparacion`**: adjuntos y vínculos de garantía se leen con `listar_adjuntos_reparacion` y `obtener_vinculos_garantia`. Evita que cuatro historias (y las épicas MSF-217 y MSF-232, en paralelo) reescriban la misma función y choquen al integrar.
- **Storage**: la subida va directo del navegador al bucket con la sesión (política de `insert` por prefijo) y luego se **registra** por RPC, que verifica que el objeto exista. Quitar = RPC borra la fila y devuelve la ruta; el cliente borra el objeto (borrar desde SQL sobre `storage.objects` deja el archivo en disco). Los huérfanos son inofensivos y su limpieza masiva queda fuera.
- **Garantía**: el alta reutiliza `private.siguiente_numero_reparacion` y el primer estado activo, como `crear_reparacion`, y escribe un evento `alta` con nota (no se altera el `check` de `tipo` del historial). No se parametriza `crear_reparacion` para no cambiar su firma.
- **Enlace público**: el token vive solo en una tabla sin grants; la Edge Function es el **único** camino público y llama a funciones ejecutables solo por `service_role`. Por eso no hay RPC `anon` (regla del repo). El límite por IP vive en la función porque es la única que ve la IP; el contador es atómico en la base. La sal del hash es una variable de servidor.
- **IP detrás del proxy**: el compose self-hosted y la imagen de Edge Runtime se revisan en T031 para confirmar qué cabecera es confiable; si no se puede confiar en ninguna, el contador queda global (más estricto) y se documenta.
- **Reportes**: mismas piezas que Rentabilidad (`reportes.seccion`, `resolver_organizacion_reporte`, `ReporteEmbebido`, `importar-dashboards.mjs`); las vistas solo exponen totales de cara al cliente. El riesgo de tiendas restringidas se hereda y se documenta (*Decisiones abiertas* 6).
- **Exportación**: reutiliza `listar_reparaciones` por lotes de 200 (máximo de la RPC), con un único arreglo `COLUMNAS` para tabla y CSV.

## Project Structure

```text
specs/20261028-100000-service-seguimiento-y-reportes/
├── spec.md · plan.md · tasks.md
└── contracts/service-seguimiento.md
supabase/migrations/20261028{10,11,12,13}*.sql   # una tanda por historia
supabase/functions/consultar-estado-reparacion/  # handler.ts, index.ts, handler.test.ts
supabase/tests/database/service_{adjuntos,garantia,enlace_consulta,analitica}.test.sql
apps/web/src/lib/{reparacionAdjuntos,reparacionGarantia,seguimientoPublico,enlaceConsulta,exportarReparaciones}.ts
apps/web/src/components/service/{AdjuntosReparacion,VisorAdjuntoDialog,VinculosGarantia,ReingresoGarantiaDialog,EnlaceSeguimientoDialog}.tsx
apps/web/src/pages/seguimiento/index.tsx
apps/web/src/pages/service-tecnico/{reparacion,reparaciones,reportes}.tsx
infra/superset/dashboards/service/
docs/service-{adjuntos,garantia,seguimiento,reportes}.md
```

## Riesgos

- **Enlace sin revocación ni vencimiento** (decisión provisoria): un enlace filtrado sigue válido. Mitigaciones: 128 bits, lista blanca mínima, sin PII, límite por IP, `no-store`/`noindex`.
- **Reportes sin filtro por tienda accesible** (heredado de Rentabilidad): ver *Decisiones abiertas* 6.
- **Archivos compartidos entre historias** (`reparacion.tsx`, `App.tsx`, `actividad.md`): por eso el *Plan de ejecución* las serializa donde comparten archivo.
- **Tablero y página pública sin pantalla dibujada**: se construyen con el sistema de diseño y se anota la diferencia en el PR.
