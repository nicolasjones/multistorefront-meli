# Implementation Plan: Ventas y despacho · Ventas mejoras

**Branch**: `epic/MSF-193-ventas-mejoras` | **Spec**: [spec.md](./spec.md) | **Contratos**: [contracts/ventas-mejoras.md](./contracts/ventas-mejoras.md)

## Summary

Tres mejoras independientes sobre lo ya construido de Ventas: **F-VTA-31** (pantalla de venta de mostrador con lector de código de barras, reutilizando comprobante y cobros), **F-VTA-32** (descuento porcentual por cliente aplicado sobre la escala en el cálculo de la línea) y **F-VTA-33** (cierre de caja diario por empresa que resume cobros por forma de pago y cuenta y bloquea su edición). Todo el comportamiento vive en RPC `security definer` (nuevas o alteradas) y en un trigger de bloqueo; la web (Refine + MUI) orquesta. No hay pantallas dibujadas: se construye con el template y el sistema de diseño, sin inventar más allá de los requisitos.

## Technical Context

- **Stack**: Refine + MUI en `apps/web`, Supabase self-hosted (migraciones + RPC + pgTAP). Sin Kestra, Superset ni workers. Verificación E2E (Playwright) por historia, como declara la épica, más pgTAP de aislamiento.
- **Base verificada (rama `main`)**: `dominio.productos.codigo_barras` (EAN-13, `productos_org_codigo_barras_uidx`), `public.v_productos_listado` (con `codigo_barras`), `private.precio_para` + `private.escala_para_linea` + `public.guardar_lineas_comprobante` (MSF-159), `public.crear_comprobante`/`confirmar_comprobante` (MSF-159), `public.clientes` (`tipo`, `es_consumidor_final`), `dominio.formas_pago`/`cuentas_cobro` (MSF-139), roles `mostrador`/`deposito`/`administracion`.
- **Llega con MSF-195** (aún sin mergear a `main`; verificar firmas al implementar): `dominio.cobros_comprobante` (columnas: `organizacion_id`, `empresa_id`, `comprobante_id`, `importe`, `forma_pago_id`, `cuenta_cobro_id`, `origen`, `registrado_por`, `registrado_en`, `aprobado_por`, `aprobado_en`) y `public.registrar_cobro`. F-VTA-31 (cobrar) y F-VTA-33 (cierre) los usan; si no está mergeada, la historia espera.
- **Pruebas**: pgTAP (`pnpm test:db`), Vitest (`pnpm test:web`), E2E Playwright (`pnpm test:e2e`), `pnpm lint`, `pnpm build`.

## Constitution Check

| Principio | Cumplimiento |
|---|---|
| I Aislamiento | RLS por organización/empresa en las tablas nuevas; RPC `security definer` con organización de la sesión; `anon` sin acceso; pgTAP con dos organizaciones (SC-001/002/003). |
| II Spec primero | Spec con FR/SC y matriz de trazabilidad. |
| III Idempotencia/auditoría | `cerrar_caja` idempotente (un cierre por empresa/fecha); eventos `caja.cerrada`/`caja.reabierta`/`cliente.descuento_editado`. |
| IV Despliegues | Solo `refine` y `supabase`. |
| V Simplicidad | Sin infraestructura nueva; dos tablas para el cierre; sin job de vencimiento. |
| VI Panel operable | Rutas, menú, icono, audiencia, estados del kit, 320/768/1440 px (FR-005, FR-025). |
| VII Esquemas | `dominio`: `cierres_caja`, `cierres_caja_detalle`; `public`: RPC `buscar_producto_por_codigo_barras`, columna `clientes.descuento` (histórica). Re-verificar en tareas, implementación y PR. |
| VIII Empresa activa | FR-005 y FR-024; fila en la matriz; test de cambio de empresa (SC-001, SC-003). |
| VIII Documentación | `docs/ventas-mejoras.md`, roadmap y `pnpm docs:check` (cierre). |

## Project Structure

```text
supabase/migrations/        # 2026… (F-VTA-31 buscar producto) · (F-VTA-32 descuento + líneas) · (F-VTA-33 cierres + trigger)
supabase/tests/database/    # ventas_mostrador.test.sql · ventas_precios_especiales.test.sql · ventas_cierre_caja.test.sql
apps/web/src/lib/           # ventasMostrador.ts · preciosEspeciales.ts · cierreCaja.ts
apps/web/src/pages/ventas/  # mostrador.tsx · cierre-caja.tsx
apps/web/src/components/    # ventas/{LectorCodigoBarras,EscanearProducto}.tsx · ventas/{CerrarCajaDialog}.tsx
apps/web/src/components/navegacion/destinosPanel.ts  # entradas «Venta de mostrador» y «Cierre de caja»
docs/ventas-mejoras.md
```

## Diseño por historia

### F-VTA-31 · Venta de mostrador con lector (M)
Migración aditiva con la RPC `buscar_producto_por_codigo_barras` (resolve EAN-13, gate `ventas`/`edicion`). Pantalla `/ventas/mostrador` con campo de escaneo (lector/teclado), lista de líneas, total y «Cobrar»; reutiliza `crear_comprobante` (Consumidor final + canal Mostrador), `guardar_lineas_comprobante` (agregar línea por escaneo) y `confirmar_comprobante` + `registrar_cobro` (cobrar). E2E del escaneo y de «Producto no encontrado».

### F-VTA-32 · Precios especiales por cliente (M)
Migración aditiva: columna `public.clientes.descuento` (porcentaje, Administrador) y `create or replace` de `public.guardar_lineas_comprobante` para aplicar el descuento del cliente sobre el neto de escala (sin tocar precio manual). Campo «Descuento» en la ficha del cliente; visualización del descuento y precio resultante en la línea. E2E de CA-VTA-32-1.

### F-VTA-33 · Cierre de caja diario (M)
Migración aditiva: tablas `dominio.cierres_caja` y `cierres_caja_detalle`, RPC `cerrar_caja`/`reabrir_caja`, helper `private.caja_cerrada` y un trigger `before insert or update` sobre `dominio.cobros_comprobante` que bloquea cobros de fecha cerrada. Pantalla `/ventas/cierre-caja` con resumen por forma de pago y cuenta y acciones Cerrar/Reabrir. E2E de CA-VTA-33-1.

## Riesgos y mitigaciones

- **MSF-195 sin mergear** (`cobros_comprobante`, `registrar_cobro`): verificar al empezar F-VTA-31/F-VTA-33; si falta, la historia espera (no se simula con tablas propias). Los nombres se toman de la spec de MSF-195 y se confirman contra `main`.
- **Bloqueo del cierre vs. cobros de MSF-195**: el trigger es la única vía de bloqueo (no modifica el RPC ajeno); se prueba que el propio `registrar_cobro` queda bloqueado.
- **Precio manipulado desde el cliente**: el descuento se lee de `public.clientes` en el servidor; el cliente nunca lo manda.
- **Descuento y precio manual**: el descuento no pisa el manual; cubierto por FR-011 y un test.
- **Fechas de migración**: timestamps placeholder (posteriores a `main`); el implementador los fija y los hace aditivos con reversión en el encabezado.

## Reversión

Migraciones aditivas; reversión en cada encabezado: `drop function public.buscar_producto_por_codigo_barras`; `alter table public.clientes drop column descuento` y restaurar `public.guardar_lineas_comprobante` anterior (exportar antes si hay precios con descuento); `drop trigger` sobre `cobros_comprobante`, `drop function private.caja_cerrada` y `public.cerrar_caja`/`reabrir_caja`, y `drop table cierres_caja_detalle`/`cierres_caja` (exportar antes si hay cierres). El PR se revierte entero con `git revert -m 1`.
