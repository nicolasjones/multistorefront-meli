# Implementation Plan: Ventas y despacho · Ventas historial de consulta

**Branch**: `epic/MSF-275-ventas-y-despacho-ventas-historial-de-co` | **Date**: 2026-10-20 | **Spec**: [spec.md](./spec.md) | **Tasks**: [tasks.md](./tasks.md)

## Summary

Se importan una sola vez las exportaciones (CSV/Excel) del panel actual a tres tablas de archivo `dominio.historial_*` (F-VTA-37) y se consultan en solo lectura desde una pantalla `Historial` con pestañas Ventas, Cobros (F-VTA-38) y Cotizaciones del dólar (F-VTA-39). El historial no toca stock, saldos, estados ni reportes. La importación es un worker nuevo sobre el contrato de workers y el ciclo de ejecuciones del template, despachado por un flow de Kestra; la lectura se hace por RPC con búsqueda, filtro de tienda y paginación en servidor. Lo que el prototipo muestra y la épica no pide (`Exportar`) queda fuera (ver matriz de `spec.md`). Sin Superset.

## Technical Context

**Language/Version**: TypeScript / React (Vite) en `apps/web`; TypeScript en `workers/historial-importador`; SQL en `supabase/migrations`; YAML de Kestra en `infra/kestra`.
**Primary Dependencies**: Refine + Material UI (componentes y tokens del sistema de diseño); Supabase self-hosted (sin Cloud). Dependencia nueva acotada al worker: un lector de `.xlsx` y un parser de CSV (librería mantenida con licencia permisiva; revisión con `supply-chain-security`).
**Storage**: Postgres (`dominio.historial_comprobantes`, `dominio.historial_cobros`, `dominio.historial_cotizaciones_dolar`) y bucket privado `historial-importaciones`.
**Testing**: pgTAP (`pnpm test:db`), Vitest (`pnpm test:web` y tests del worker), `pnpm lint`, `pnpm build`, `pnpm infra:config`, `pnpm docs:check`, `pnpm matriz:check`, `pnpm prototipo:check`.
**Target Platform**: panel web de Refine, Supabase, Kestra y un contenedor de worker `amd64`.
**Constraints**: RLS en toda tabla expuesta; **sin escritura desde el panel** en `historial_*` (solo el worker con rol de servicio); la base es la autoridad del aislamiento por organización y empresa; migraciones aditivas con reversión; RPC de `public` con `revoke … from public, anon` y `grant execute … to authenticated`; secretos fuera de Git.
**Scale/Scope**: volumen por definir con el panel actual (años de comprobantes); paginación en servidor y carga por lotes en el worker.

## Constitution Check

| Principio | Cumplimiento |
|-----------|--------------|
| I. Aislamiento multi-tenant | RLS por `private.organizacion_id()`, `private.empresas_accesibles()` y nivel de `ventas`; el bucket aísla por prefijo de organización; pgTAP recorre `public` + `dominio`. |
| II. Especificar antes de implementar | Spec con flujos, matriz pantalla↔criterios, trazabilidad y decisiones abiertas. |
| III. Idempotencia y auditoría | Inserción idempotente por clave natural, ejecución auditable (`ejecuciones_worker`) con actor, estado, timestamps y error útil; una importación simultánea por tipo. |
| IV. Despliegues independientes | Worker propio en `workers/`, flow en `infra/kestra`, UI en `apps/web`, migraciones en `supabase`; sin Compose raíz. |
| V. Simplicidad | Sin infraestructura nueva: reutiliza ciclo de ejecuciones, outbox y Kestra; importador acotado, no genérico. |
| VI. Panel operable | Ruta `/historial`, entrada de menú en el grupo Ventas con icono, estados compartidos, 320/768/1440 px, teclado y lector; carga diferida de la pantalla de consulta y de la de importación. |
| VII. Esquemas | Las tres tablas son dominio del producto → `dominio`; declaradas en `spec.md`; se re-verifican en plan, tareas, implementación y PR. |
| VIII. Documentación | `docs/historial-ventas.md` y actualización de `docs/roadmap-template.md` en el cierre. |

## Project Structure

```text
specs/20261020-100000-ventas-historial-de-consulta/{spec,plan,tasks}.md
supabase/migrations/2026…_historial_*.sql      # tablas, bucket, RPC (cada historia con la suya)
supabase/tests/database/historial_*.test.sql
workers/historial-importador/{package.json,src/,test/}
infra/kestra/flows/historial-importador.yaml
apps/web/src/pages/historial/{list.tsx,importar.tsx}
apps/web/src/hooks/useHistorial*.ts
apps/web/src/lib/historial.ts
docs/historial-ventas.md
```

## Diseño por historia

### F-VTA-37 — importación
- Tablas con clave natural única `(organizacion_id, empresa_id, numero)` en comprobantes y cobros (si el número del cobro no es único, se completa con fecha e importe según la muestra real, *Decisiones abiertas* 8) y `(organizacion_id, fecha)` en cotizaciones. Columnas de texto para nombre de cliente, número de cliente, operador, estado, cuenta de cobro y aprobador; importes `numeric(14,2)`. Sin FKs a tablas vivas salvo `organizacion_id` y `empresa_id`.
- RPC `solicitar_importacion_historial` valida tipo y archivo en el bucket, bloquea simultáneas por `(organización, tipo)` y llama a `iniciar_ejecucion_worker`. `historial_ultimo_numero` expone el mayor número histórico.
- Worker: descarga el archivo, detecta formato, normaliza, valida **todo antes de escribir** (todo o nada), inserta por lotes con `on conflict do nothing`, cierra la ejecución con conteos o con `78` y el detalle.
- Pantalla `importar.tsx`: tipo + archivo + estado de la ejecución (consulta a `ejecuciones_worker`) con enlace a `pages/ejecuciones`.

### F-VTA-38 — consulta de ventas y cobros
- Migración propia con `listar_historial_ventas`/`listar_historial_cobros` (búsqueda normalizada sin tildes, filtro de empresa dentro de `empresas_accesibles()`, orden estable, tope 200, `total_filas`, rango Desde/Hasta).
- `pages/historial/list.tsx`: encabezado, etiqueta «Solo lectura», pestañas, buscador, chips de Tienda, tablas/tarjetas, «Histórico», estados y paginación; entrada de menú y ruta protegidas por nivel de `ventas`.

### F-VTA-39 — cotizaciones
- Migración propia con `listar_historial_cotizaciones` y la pestaña en la misma pantalla, como componente propio para mantener el diff acotado.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|-----------|
| Formato real de las exportaciones distinto del supuesto | Mapeo de columnas documentado y configurable por tipo; muestra real al implementar (*Decisiones abiertas* 8). |
| Volumen alto de filas | Lotes, índices de búsqueda y paginación en servidor; límite de archivo configurable. |
| Fuga entre empresas u organizaciones | RLS por organización y empresa + pgTAP con usuarios de empresas distintas. |
| Escritura accidental sobre el archivo | Sin grants de escritura para `authenticated`/`anon`; pgTAP lo prueba. |
| Doble importación concurrente | Bloqueo por `(organización, tipo)` en la RPC + clave natural única. |
| Dependencia de lectura de Excel | Revisión de supply chain y versión fijada. |

## Reversión

Ver `spec.md` → *Reversión*: migraciones aditivas; el retiro de tablas, funciones y bucket va en una migración posterior, nunca en el mismo PR que las crea. El flow de Kestra y el worker se retiran sin efecto sobre el resto.
