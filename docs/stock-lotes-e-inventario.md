---
owner: producto
sources:
  - specs
---

# Stock · Lotes e inventario (épica MSF-131)

Spec: `specs/20261024-120000-stock-lotes-e-inventario/`. Reúne las dos historias de la épica; el detalle técnico
de cada una vive en su guía.

| Historia | Qué resuelve | Guía |
|----------|--------------|------|
| F-STK-10 (MSF-407) | Cargar un remito de varios productos bajo un mismo número de lote, todo o nada | [`stock-lotes.md`](./stock-lotes.md) |
| F-STK-11 (MSF-415) | Contar una categoría y corregir las diferencias con ajustes | [`stock-toma-inventario.md`](./stock-toma-inventario.md) |

## Lotes

- `dominio.lotes_stock` (esquema `dominio`, Principio VII): cabecera con número correlativo por organización,
  proveedor (texto libre ≤ 120), fecha, motivo, actor y clave de idempotencia. Solo de agregado; RLS de solo lectura.
- `dominio.movimientos_stock.lote_id` vincula cada entrada con su lote.
- RPC `registrar_lote_stock`, `listar_lotes_stock` y `listar_movimientos_lote`; `registrar_movimiento_stock` gana
  `p_lote` al final (cambio de contrato aditivo, ver la guía de lotes).
- Pantalla: pestaña «Carga en lote» (`/stock/lote`).

## Toma de inventario

- Sin tablas nuevas: cada diferencia se convierte en un movimiento `ajuste` con el motivo de sistema
  «Toma de inventario» (aplica a `ajuste`), por la única vía de escritura de stock.
- RPC `confirmar_toma_inventario`: un ajuste por producto con diferencia; repetir la confirmación no crea nada.
- Pantalla: pestaña «Toma de inventario» (`/stock/toma-inventario`).

## Permisos

| Acción | Nivel en la sección Stock |
|--------|---------------------------|
| Ver historial de lotes y sus movimientos | `lectura` o `edicion` |
| Registrar un lote, confirmar una toma | `edicion` (si no, `42501`) |
| Ejecutar cualquiera de estas RPC sin sesión | `anon` no tiene `execute` |

Las dos pantallas no consultan por empresa: el stock es único por organización (Principio VIII: no aplica).

## Reversión

Todo es aditivo. Para volver atrás, siga el orden de las secciones «Reversión» de cada guía: primero las funciones
(`registrar_lote_stock`, `listar_lotes_stock`, `listar_movimientos_lote`, `confirmar_toma_inventario`), después
restaurar `registrar_movimiento_stock` a 7 parámetros y el motivo de sistema, y recién en una migración posterior
(exportando antes los datos) quitar `lote_id` y `lotes_stock`. Nada se destruye en el mismo PR que lo crea.

## Verificación

`pnpm test:db` (`stock_lotes`, `stock_lotes_concurrencia`, `stock_toma_inventario`, `rls_en_toda_tabla`,
ejecutabilidad por `anon`), Vitest de `lote` y `toma-inventario`, y `pnpm docs:check`.
