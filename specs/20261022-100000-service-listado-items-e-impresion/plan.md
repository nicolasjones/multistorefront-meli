# Implementation Plan: Service técnico · Service listado, ítems e impresión

**Branch**: `epic/MSF-199-service-tecnico-service-listado-items-e-` | **Date**: 2026-10-22 | **Spec**: [spec.md](./spec.md) | **Épica**: MSF-199

## Summary

Una tabla de dominio nueva (`reparacion_items`) y dos columnas derivadas en `reparaciones` (`total_mano_obra`, `total_repuestos`), RPC que agregan/quitan ítems y recalculan los totales en la misma transacción, una RPC paginada de listado con filtros e índices, y tres piezas de interfaz: el listado de Reparaciones, la sección «Mano de obra y repuestos» del detalle y las vistas A4 de la orden de ingreso y el remito. Todo se apoya en lo ya entregado por MSF-182 (`obtener_reparacion`, `tecnicos_de_service`, estados, entrega, `ver_costos`, RLS por tienda) y en `dominio.productos` de Catálogo.

## Technical Context

- **Lenguaje/Stack**: TypeScript + React + Refine + MUI (`apps/web`), Supabase self-hosted (Postgres, RPC, pgTAP). Sin Kestra, Superset ni workers (Constitución IV, V).
- **Pruebas**: pgTAP (`pnpm test:db`, requiere `pnpm dev:supabase`), Vitest (`pnpm test:web`), E2E Playwright en `apps/web/e2e/*.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`; ver `docs/e2e-app.md`).
- **Validación**: `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm docs:check`, `pnpm matriz:check`, `pnpm prototipo:check`.
- **Restricciones**: migraciones aditivas con reversión en el encabezado; `anon` sin privilegios; `revoke … from public, anon` + `grant execute … to authenticated` en cada RPC; sin service-role en el navegador; costos internos nunca en listado ni en documentos.
- **Verificado en el árbol (no inventado)**: `dominio.reparaciones` y `reparacion_historial` (`20261020110100`, `…110300`), `public.obtener_reparacion` y `tecnicos_de_service` (`20261020110500`), lectura por tienda (`20261020140000`), `dominio.productos` (`20261017120100`), `dominio.empresas.direccion/whatsapp/correo` (`20261013120000`; **sin CUIT**), pantallas `pages/service-tecnico/{reparaciones,reparacion}.tsx`, `components/service/*`, `lib/reparaciones.ts`, `lib/productos.ts`. **A confirmar al implementar F-SVC-06**: la consulta de productos que ya usa `lib/productos.ts` para la búsqueda por Nombre o SKU (si no cubre SKU, se amplía ahí, sin RPC nueva) y el permiso que tiene Service para leer `productos` (rol Técnico: Productos en `lectura`).
- **No existe** mecanismo de impresión reutilizable (MSF-213 no está): vista A4 propia con CSS de impresión.

## Constitution Check

| Principio | Cumplimiento |
|-----------|--------------|
| I Aislamiento | RLS por `organizacion_id` + nivel `service_tecnico` + tienda en `reparacion_items`; FK compuestas `(reparacion_id, organizacion_id)` y `(producto_id, organizacion_id)`; pgTAP de aislamiento entre dos organizaciones (SC-001, SC-004). |
| II Especificar primero | Esta spec; cada tarea referencia FR/SC. |
| III Idempotencia/auditoría | Recalcular totales es una función de los ítems (reintentable, no acumulativa); actividad `reparacion.item_agregado|quitado` en la misma transacción. |
| IV Despliegues independientes | Solo `refine` + `supabase`. |
| V Simplicidad | Sin tabla de totales aparte (columnas en `reparaciones`); sin `pg_trgm` ni extensión nueva (la búsqueda por serie se valida con el volumen de 2.000); sin servicio de PDF (impresión del navegador). |
| VI Panel operable | Rutas canónicas: `/service-tecnico/reparaciones` (listado, ya existente), `/service-tecnico/reparaciones/:id` (detalle), `/service-tecnico/reparaciones/:id/orden` y `/…/remito` (nuevas, sin entrada de menú: se abren desde el detalle); la entrada «Service técnico» y sus pestañas ya existen (MSF-182). Estados vacío/error/carga/éxito del kit; teclado y 320/768/1440 px; el listado nunca muestra UUID (se ve `R-0238`, nombres). Peso: las vistas A4 y los diálogos de ítems se cargan diferidos (`lazy`). |
| VII Esquemas | **Re-verificado en spec, plan y tareas**: `reparacion_items` → **`dominio`**; columnas nuevas de `reparaciones` → **`dominio`** (sin cambio de esquema); `productos`, `empresas` → `dominio` (solo lectura); RPC en `public`; ayudas en `private`. Ninguna tabla nueva en `public`. |
| VIII Documentación | `docs/service-listado.md`, `docs/service-items.md`, `docs/service-impresion.md` (uno por historia, para no pisarse), `docs/actividad.md` y el índice en `docs/service-tecnico.md` (cierre). |

Supabase self-hosted: nada se asume de Supabase Cloud.

## Decisiones de diseño

- **Totales almacenados** (no calculados al leer): lo pide la épica («RPC de ítems que recalculan totales en la misma transacción») y el listado de 2.000 filas no debe sumar ítems por fila. `private.recalcular_totales_reparacion(id)` hace `update … set total_* = (select coalesce(sum(subtotal),0) …)`, siempre bajo el `for update` de la RPC que lo llama.
- **`updated_at`**: el recálculo cambia la fila y por lo tanto su `updated_at`; la pantalla recarga la reparación tras cada operación de ítems para no provocar un falso conflicto (`40001`) en el siguiente «Guardar».
- **Listado**: `listar_reparaciones(p_empresa, p_periodo, p_serie, p_tecnico, p_pagina, p_tamano)` devuelve `{ total_filas, filas[] }` con un `count(*) over ()`; `security invoker` para heredar la RLS por tienda; el nombre del técnico sale con la misma regla de nombre visible que `tecnicos_de_service` (nunca el correo). Índices: `(organizacion_id, empresa_id, entrega_prevista)` y `(organizacion_id, lower(numero_serie))`; el de técnico ya existe.
- **Período** (hoy en zona Argentina): Hoy = `entrega_prevista = hoy`; Semana = `hoy … hoy+6`; Mes = mes calendario en curso **más** las sin `entrega_prevista`; la serie ignora el período (spec *Decisiones abiertas* 1).
- **Impresión sin RPC nueva**: las vistas leen `obtener_reparacion` (que ya trae ítems y totales tras F-SVC-06) y la tienda de `dominio.empresas`. `window.print()` con `@page { size: A4 }` y `@media print` que oculta el marco del panel. Una guarda de prueba asegura que los documentos no leen `costo_*` ni ganancia.

## Project Structure

```text
supabase/migrations/
  20261022100100_reparacion_items.sql              # F-SVC-06 (tabla + RLS)
  20261022100200_reparaciones_totales.sql          # F-SVC-06 (columnas + private.recalcular_totales_reparacion)
  20261022100300_reparacion_item_agregar.sql       # F-SVC-06
  20261022100400_reparacion_item_quitar.sql        # F-SVC-06
  20261022100500_reparaciones_leer_items.sql       # F-SVC-06 (obtener_reparacion con ítems, totales, ganancia)
  20261022100600_reparacion_items_actividad.sql    # F-SVC-06
  20261022110100_reparaciones_listado_indices.sql  # F-SVC-04
  20261022110200_reparaciones_listar.sql           # F-SVC-04
supabase/tests/database/
  service_items.test.sql  service_listado.test.sql  service_listado_volumen.test.sql
apps/web/src/
  lib/reparacionItems.ts  lib/reparacionesListado.ts  lib/documentosReparacion.ts
  components/service/ItemsReparacion.tsx  AgregarManoObraDialog.tsx  AgregarRepuestoDialog.tsx
  components/service/FiltrosReparaciones.tsx  DocumentoA4.tsx
  pages/service-tecnico/reparaciones.tsx (listado)  reparacion.tsx (sección de ítems y botones)
  pages/service-tecnico/orden-ingreso.tsx  remito-entrega.tsx
  App.tsx (rutas /:id/orden y /:id/remito)
docs/ service-listado.md  service-items.md  service-impresion.md  actividad.md  service-tecnico.md (índice)
apps/web/e2e/service-recorrido.e2e.ts
```

Las tres historias no comparten archivos de migración ni de documentación; F-SVC-04 y F-SVC-07 dependen de F-SVC-06 (totales e ítems) pero no entre sí.

## Riesgos

- **Dos historias tocan el detalle** (`reparacion.tsx`): F-SVC-06 agrega la sección de ítems y F-SVC-07 los botones de impresión. Por eso F-SVC-07 va después de F-SVC-06 (Plan de ejecución).
- **Búsqueda parcial por serie** sin `pg_trgm`: a 2.000 filas por organización alcanza con el índice de organización/tienda; SC-002 lo mide. Si no cumple, se evalúa el índice trigram en una migración aditiva.
- **Texto de condiciones y datos fiscales** sin confirmar (*Decisiones abiertas* 3): se implementa con valores provisorios aislados en una constante.
