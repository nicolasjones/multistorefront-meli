# Implementation Plan: Service técnico · Service cobro y avisos

**Branch**: `epic/MSF-232-service-tecnico-service-cobro-y-avisos` | **Date**: 2026-10-28 | **Spec**: [spec.md](./spec.md) | **Épica**: MSF-232

## Summary

Tres piezas apoyadas en lo ya entregado por MSF-182, MSF-199 y MSF-159: (1) una RPC que genera el comprobante de Ventas de una reparación (columnas de origen en `comprobantes_venta` y una marca `sin_stock` en las líneas), (2) un aviso por correo al cliente con historial en `dominio.reparacion_avisos`, despachado por la outbox de ejecuciones y un flow de Kestra que sigue el patrón de `comprobantes-correo`, y (3) una RPC de lectura y una pestaña «Reparaciones» en la ficha del cliente.

## Technical Context

- **Stack**: TypeScript + React + Refine + MUI (`apps/web`), Supabase self-hosted (Postgres, RPC, pgTAP), Kestra (un flow). Sin worker nuevo ni Superset (Constitución IV, V).
- **Pruebas**: pgTAP (`pnpm test:db`), Vitest (`pnpm test:web`), prueba del flow (`infra/kestra/flows/*.test.mjs`, `pnpm test:kestra:copias`), E2E Playwright en `apps/web/e2e/*.e2e.ts` (se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`; ver `docs/e2e-app.md`).
- **Validación**: `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm docs:check`, `pnpm matriz:check`, `pnpm prototipo:check`.
- **Restricciones**: migraciones aditivas con reversión en el encabezado; `anon` sin privilegios; `revoke … from public, anon` + `grant execute … to authenticated` en cada RPC; las funciones del flow en `private` solo para `kestra_orquestacion`; sin service-role en el navegador; sin secretos nuevos (se reusa `KESTRA_SMTP_*`).
- **Verificado en el árbol (no inventado)**: `dominio.reparaciones` (`20261020110100`, con `cliente_id` hacia `public.clientes`), `reparacion_items` y totales (`20261022100100…100500`), `cambiar_estado_reparacion(p_id, p_estado_id)` (`20261020120100`), `dominio.comprobantes_venta` y `comprobantes_venta_lineas` (`producto_id`, `deposito_id` y `escala` hoy `not null`; `a_pedido` es otra marca), `crear_comprobante`, `guardar_lineas_comprobante`, `confirmar_comprobante` (`20261204140000`, recorre líneas por producto y depósito), estado de cobro (`20261212100800`), `comprobante_envios_correo` y `enviar_presupuesto_correo` (`20261212100200/100300`), `infra/kestra/flows/comprobantes-correo.yml`, `private.reclamar_despachos_capacidad`, `pages/service-tecnico/reparacion.tsx`, `pages/clientes/show.tsx` (hoy sin pestañas). **No existen**: `origen_tipo`/`origen_id`, el modo de línea sin stock, una tabla de avisos de reparación ni pestaña en la ficha.
- **A confirmar al implementar**: la función de alícuota general de Precios e IVA (*Decisiones abiertas* 1); los nombres exactos de la devolución de stock de notas de crédito (`20261212120300`); el nombre del permiso de lectura de `ventas` por empresa (`private.nivel_ventas_en_empresa`).

## Constitution Check

| Principio | Cumplimiento |
|-----------|--------------|
| I Aislamiento | RLS por `organizacion_id` + nivel `service_tecnico` + tienda en `reparacion_avisos`; FK compuestas; pgTAP de aislamiento entre dos organizaciones (SC-001, SC-004, SC-007). |
| II Especificar primero | Esta spec; cada tarea referencia FR/SC. |
| III Idempotencia/auditoría | Comprobante: `for update` + índice único parcial. Aviso: índice único parcial y cierre idempotente; actividad `reparacion.comprobante_generado`, `reparacion.aviso_*` en la misma transacción. Entrega al menos una vez, documentada. |
| IV Despliegues independientes | `refine`, `supabase` y `kestra` (un flow); sin Compose nuevo. |
| V Simplicidad | Se reusa la outbox, el SMTP y el patrón de `comprobantes-correo`; sin cola nueva, sin worker, sin proveedor de correo nuevo. |
| VI Panel operable | Sin menús nuevos: acciones en el detalle existente (`/service-tecnico/reparaciones/:id`) y una pestaña en `/clientes/:id`. Estados vacío/error/carga/éxito del kit; teclado y 320/768/1440 px; nunca UUID visibles (`R-0238`, números de comprobante, nombres). Peso: la pestaña de la ficha se carga diferida. |
| VII Esquemas | **Re-verificado en spec, plan y tareas**: `reparacion_avisos` → **`dominio`**; columnas nuevas de `comprobantes_venta`/`comprobantes_venta_lineas` → **`dominio`** (sin cambio de esquema); la outbox (`public`) solo recibe inserts por RPC. Ninguna tabla nueva en `public`. |
| VIII Contexto de empresa | Pestaña de la ficha: empresa activa obligatoria (FR-043). Detalle: la tienda es la de la reparación; cambio de empresa recarga y cierra diálogos (tests SC-003, SC-006, SC-008). |
| Documentación | `docs/service-cobro.md`, `docs/service-avisos.md`, `docs/service-cliente-reparaciones.md` (uno por historia, para no pisarse), `docs/actividad.md`, `docs/clientes.md` y el índice en `docs/service-tecnico.md` (cierre). |

Supabase self-hosted: nada se asume de Supabase Cloud.

## Decisiones de diseño

- **Comprobante como foto.** `generar_comprobante_reparacion` crea el comprobante con el mismo camino interno que `crear_comprobante` + `guardar_lineas_comprobante` (reutiliza numeración y cálculo de IVA de Ventas, no los duplica) y copia los ítems; no queda vínculo vivo con los ítems.
- **Líneas sin stock.** Se agrega `sin_stock` en lugar de reutilizar `a_pedido` (que **reserva**). `confirmar_comprobante` y la devolución de stock saltean `sin_stock`; el check relaja `producto_id`/`deposito_id`/`escala` solo con la marca. Las líneas de catálogo existentes no cambian.
- **Aviso fuera de la transacción del estado.** `cambiar_estado_reparacion` no se toca (sin BREAKING); la pantalla lo llama primero y luego a `avisar_cliente_reparacion`. Así el aviso nunca bloquea el estado (FR-025). `avisar_cliente_reparacion` toma por defecto el estado actual; «Reenviar» pasa el `estado_id` del aviso original.
- **Despacho.** Igual que `enviar_presupuesto_correo`: una ejecución `manual` auditable y su orden en la outbox, en la misma transacción que el aviso; el flow reclama solo `enviar-aviso-reparacion-*`.
- **Correo del cliente.** Se toma de `public.clientes.correo` al pedir el aviso y se guarda como foto en `destinatario`.
- **Pestaña de la ficha.** `reparaciones_de_cliente` es `security definer` con las validaciones manuales de `listar_reparaciones` (organización, nivel y `empresas_accesibles()`), apoyada en `reparaciones_cliente_idx`; la pestaña se carga diferida y se oculta con `service_tecnico` en `ninguno`.
- **Migraciones por historia**, con timestamps propios (`20270113100x00` cobro, `20270113110x00` avisos, `20270113120100` ficha), sin encadenarse entre sí.
