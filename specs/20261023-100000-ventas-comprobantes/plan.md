# Implementation Plan: Ventas y despacho · Ventas comprobantes

**Branch**: `epic/MSF-159-ventas-y-despacho-ventas-comprobantes` | **Spec**: [spec.md](./spec.md) | **Contratos**: [contracts/ventas-comprobantes.md](./contracts/ventas-comprobantes.md)

## Summary

Alta de factura y presupuesto internos con cabecera, líneas con precio por escala (vía `private.precio_para`), depósito de salida y stock disponible; confirmación de la factura que descuenta stock por depósito (y reserva «A pedido»); y la pantalla de Presupuestos con aceptar, copiar y modificar. Todo el comportamiento vive en RPC `security definer` sobre `dominio`; la web (Refine + MUI) solo orquesta.

## Technical Context

- **Stack**: Refine + MUI en `apps/web`, Supabase self-hosted (migraciones + RPC + pgTAP). Sin Kestra, Superset ni workers.
- **Base verificada** (rama `e1c1a7d`): `dominio.comprobantes_venta` (contrato F-CLI-08), `dominio.existencias` + `registrar_movimiento_stock` (stock único), `public.buscar_clientes`, `dominio.empresas`, acciones en `permisos_rol_accion` (`eliminar`, `exportar`, `ver_costos`), `private.registrar_actividad`.
- **Llega con las dependencias** (verificar firmas contra `main` al implementar; no inventarlas): `private.precio_para` (MSF-114), depósitos/reservas/existencias por depósito (MSF-292), catálogos de cobro y envío (MSF-139), alta mínima de cliente (MSF-180).
- **Pruebas**: pgTAP (`pnpm test:db`), Vitest (`pnpm test:web`), `pnpm lint`, `pnpm build`.

## Constitution Check

| Principio | Cumplimiento |
|---|---|
| I Aislamiento | RLS por organización en toda tabla nueva; escritura solo por RPC; `anon` sin acceso. |
| II Spec primero | Spec con FR/SC y matriz de trazabilidad. |
| III Idempotencia/auditoría | `confirmar`/`aceptar` idempotentes; eventos con `private.registrar_actividad`. |
| IV Despliegues | Solo `refine` y `supabase`. |
| V Simplicidad | Sin infraestructura nueva; sin job de vencimiento (derivado). |
| VI Panel operable | Rutas, menú, icono, audiencia, estados del kit, 320/768/1440 px (FR-009). |
| VII Esquemas | `dominio`: `comprobantes_venta` (alterada), `comprobantes_venta_lineas`, `comprobantes_venta_numeracion`; `public`: solo datos (`permisos_rol_accion`, cliente Consumidor final). Re-verificar en tareas, implementación y PR. |
| VIII Empresa activa | FR-007 y FR-053; fila en la matriz; test de cambio de empresa (SC-002, SC-007). |

## Project Structure

```text
supabase/migrations/   # 202610241001xx (F-VTA-05) · 202610241002xx (06) · 202610241003xx (07) · 202610241004xx (08)
supabase/tests/database/ventas_comprobantes_*.test.sql
apps/web/src/lib/ventas.ts
apps/web/src/pages/ventas/comprobante.tsx | presupuestos.tsx
apps/web/src/components/ventas/{LineasComprobante,AgregarProductoDialog,DepositoSelect,FaltanteAviso,ConfirmarFacturaDialog}.tsx
docs/ventas-comprobantes.md
```

## Diseño por historia

### F-VTA-05 · Alta (L)
Migraciones aditivas: columnas nuevas en `comprobantes_venta` (empresa, canal, operador, válido hasta, formas de pago y envío, `confirmado_*`, `updated_at`), tabla de numeración, siembra de Consumidor final y RPC `crear_/guardar_/obtener_comprobante`. Pantalla de cabecera con slots de «acciones» y «líneas» que llenan las historias siguientes.

### F-VTA-06 · Líneas (L)
Tabla de líneas, acción `editar_precio`, RPC `guardar_lineas_comprobante` (recálculo en servidor; el precio del cliente solo vale como manual con permiso) y `disponible_para_venta`. UI de tabla, agregar producto, depósito y aviso de faltante.

### F-VTA-07 · Confirmación (L)
RPC `confirmar_comprobante` en una transacción: bloquea el comprobante `for update`, valida estado y, por línea, llama al motor de stock (salida o reserva), todo o nada. Ajuste del predicado de «facturado». Diálogo de confirmación.

### F-VTA-08 · Presupuesto (M)
RPC `aceptar_`/`copiar_`/`listar_presupuestos`; pantalla con búsqueda, filtros, empresa activa y acciones por fila; «Modificar» reutiliza la pantalla del comprobante.

## Riesgos y mitigaciones

- **Dependencias no mergeadas** (`precio_para`, depósitos, reservas): verificar al empezar cada historia; si falta, la historia espera (no se simula con tablas propias).
- **Concurrencia de stock**: bloqueo de fila de existencias/depósito dentro de la transacción; pgTAP con confirmaciones simultáneas.
- **Precio manipulado desde el cliente**: el servidor recalcula; `precio_manual` exige permiso verificado en la RPC.
- **Predicado de facturado** (ranking): ajuste cubierto por FR-036 y un test que verifica que `borrador` no suma.
- **Numeración y escala pendientes del cliente (6/11)**: aisladas (entero + formato; función única de escala) para cambiarlas sin migrar datos.

## Reversión

Migraciones aditivas; reversión en cada encabezado: eliminar las RPC; eliminar `comprobantes_venta_lineas` y `comprobantes_venta_numeracion` (exportar antes si hay datos); las columnas nuevas de `comprobantes_venta` se retiran en una migración posterior (no en el mismo PR que las crea); quitar la acción `editar_precio` y el cliente Consumidor final solo si no tienen referencias; restaurar el predicado `comprobante_cuenta_como_facturado` anterior.
