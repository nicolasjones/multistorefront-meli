# Promociones de precio por empresa (F-PRE-11, MSF-439)

Guía de la historia F-PRE-11 de la épica MSF-363. Requisitos: [`spec.md`](../specs/20261104-103000-precios-masivos-y-promociones/spec.md) (FR-011 a FR-018, SC-004 a SC-006).

## Qué hace

Una promoción fija un **precio promocional** (sin IVA, en pesos) para un producto en **una empresa**, válido entre `desde` (incluido) y `hasta` (excluido). Durante ese rango la tienda de la empresa muestra el precio promocional con el anterior tachado; fuera de él, el precio de siempre. Pantalla: **Productos → Promociones** (`/productos/promociones`, sección `productos`; edición requiere `edicion`).

## Modelo (esquema `dominio`, Principio VII)

Tabla `dominio.promociones_precio` (migración `20270202202001`): FK compuestas a empresa y producto de la misma organización, `precio_promocional > 0`, `hasta > desde`, `anulada_at`, índice `(empresa_id, producto_id, desde, hasta)`, RLS por organización, sin política DELETE, sin privilegios para `anon`. Un disparador impide que dos promociones **no anuladas** del mismo producto y empresa se solapen (`23P01`).

Los estados `programada`, `vigente` y `vencida` **no se guardan**: se derivan por consulta de `desde`/`hasta` y la hora actual (Decisión 1: sin Kestra ni worker, sin ventana de precio vencido por una tarea caída). Solo `anulada` es un dato. La vista `public.promociones_precio_estado` (`security_invoker`) los expone.

## RPC (`public`, migración `20270202202002`)

- `guardar_promocion_precio(...)`: crea o edita (bloqueo optimista con `updated_at`; idempotente; no edita vencidas ni anuladas).
- `anular_promocion_precio(id, actualizado)`: anula; repetirla no falla.
- Ambas validan sesión, sección `productos` = edición y que empresa y producto sean de la organización. Errores: `42501`, `P0002`, `22023`, `23P01`, `40001`, `22003`. Eventos de actividad `promocion_precio.programada|actualizada|anulada`.
- Permisos: `authenticated` ejecuta; `anon` y `public` revocados.

## Cálculo (migración `20270202202003`)

`private.precio_vigente_empresa(producto, empresa, ahora)` parte del neto de la empresa, aplica la promoción vigente, luego la alícuota de IVA según el interruptor «Precios que ve el cliente», y devuelve también el precio anterior. Sin promoción es idéntico a `private.precio_final_publico`.

## Contrato público (migración `20270202202004`)

`publico.catalogo_pagina_por_dominio` y `publico.producto_por_dominio` suman la clave `precio_anterior` (null sin promoción vigente) y `precio` sale del cálculo con promoción. Aditivo, misma lista blanca. El orden y el filtro por precio del catálogo usan el precio vigente. En la web, `PrecioTachado` tacha el anterior solo si es mayor que el vigente y lo dice también al lector de pantalla («Precio anterior», «Precio actual»).

## Decisiones

- **Decisión 6**: carrito, comprobantes, POS y Mercado Libre **no** cobran el promocional; solo se muestra en la tienda. Queda como pregunta para Nicolás.
- **Decisión 7**: se adopta el precio vigente (con `precio_anterior`) en catálogo, ficha, destacados y búsqueda (migraciones `20270202202004` y `20270202202005`). No se tocan el precio por escala ni los precios de cliente por dominio: seguimiento MSF-816.

## Verificación

pgTAP `supabase/tests/database/promociones_precio.test.sql`; Vitest `promociones.test.ts`, `promociones.test.tsx`, `PrecioTachado.test.tsx`; E2E `apps/web/e2e/tienda-promocion.e2e.ts` (ver [`e2e-app.md`](./e2e-app.md)).

## Reversión

Migraciones aditivas. Para volver atrás: migración posterior que restaure las dos funciones públicas de la tienda (`20261023150200`, `20261023150300`), elimine las RPC y la vista, y (solo si se decide perder los datos) la tabla; o `git revert -m 1` del merge de la spec. La clave `precio_anterior` extra no rompe a los clientes.
