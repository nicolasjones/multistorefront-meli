# Implementation Plan: Stock · Stock movimientos

**Branch**: `epic/MSF-136-stock-stock-movimientos` | **Date**: 2026-10-17 | **Spec**: [spec.md](./spec.md)

## Summary

Se crea el dominio de stock en el esquema `dominio` (`existencias`, `movimientos_stock`, `motivos_movimiento`), con escritura únicamente por RPC (`registrar_movimiento_stock`, `definir_minimo_stock`), lectura por RLS con `nivel_seccion('stock')`, historial inmodificable, vista de estados `stock_estados` y la regla de stock no negativo en la base. En `apps/web` se agrega el recurso Stock: listado con mínimo y estados, diálogo «Nuevo movimiento» y pestaña de historial paginado.

## Technical Context

**Language/Version**: TypeScript / React (Vite) en `apps/web`; SQL en `supabase/migrations`

**Dependencies**: Refine, MUI — ya presentes; sin dependencias nuevas.

**Storage**: Postgres self-hosted (Supabase). Tablas nuevas en `dominio`. FK a `dominio.productos` (épica MSF-456, **hoy solo en su rama**).

**Testing**: Vitest + Testing Library; pgTAP en `supabase/tests/database/`. E2E Playwright dependiente de MSF-499; si no existe, SC-001 se cubre con Vitest + pgTAP y la tarea de cierre queda con `Desvío:` y seguimiento trazado.

**Delivery scope**: `refine`, `supabase`

**Constraints**: migraciones aditivas; nunca service-role en el navegador; `anon` sin acceso; sin HTML/CSS del prototipo; Supabase self-hosted (no Cloud); cada historia trae **su propia migración** con timestamp propio y no se encadenan entre sí.

## Constitution Check

- **I / VII**: las tres tablas son dominio → `dominio` (declarado en spec, re-verificado acá y en la tarea de cierre). RLS por `organizacion_id` y `nivel_seccion('stock')` en todas; sin políticas de escritura en `existencias`/`movimientos_stock`; pgTAP de aislamiento recorre `public` + `dominio`. ✔
- **II**: spec con permisos, fallos, auditoría y datos. ✔
- **III**: la RPC es transaccional y serializa por producto (`select … for update` sobre `existencias`); un rechazo no deja rastro. Cada movimiento es un hecho nuevo: la RPC no es idempotente por diseño y el doble clic se evita en la UI. ✔
- **VI**: ítem Stock, rutas `/stock` y `/stock/movimientos`, estados compartidos, accesibilidad, carga diferida. ✔
- **VIII**: `docs/stock.md` y actualización de `docs/permisos-por-rol.md` y `docs/aislamiento-por-organizacion.md`. ✔
- Complexity Tracking: sin excepciones. Única dependencia externa abierta: `dominio.productos` (MSF-456).

## Diseño de datos

Todas aditivas, con reversión documentada en el encabezado de cada migración. Timestamps posteriores a `20261017120300` (Catálogo).

### M1 · F-STK-02 · `20261017140000_stock_existencias_y_movimientos.sql` (+ `20261017140100_stock_registrar_movimiento.sql`)

- `dominio.existencias (producto_id uuid pk, organizacion_id uuid not null, cantidad integer not null default 0, ultimo_movimiento_en timestamptz, updated_at)`; FK compuesta `(producto_id, organizacion_id) → dominio.productos (id, organizacion_id)` (misma técnica que `producto_costos`: no puede apuntar a un producto de otra organización).
- `dominio.movimientos_stock (id, organizacion_id, producto_id, tipo ('entrada'|'salida'|'ajuste'), cantidad integer (≥ 0, lo informado), diferencia integer (con signo), saldo integer, motivo_id, nota (≤ 500), fecha date, actor_id, actor_nombre, creado_en)`; FK compuesta a existencias; índices `(organizacion_id, creado_en desc, id)` y `(organizacion_id, producto_id, creado_en desc, id)`. Sin FK a `auth.users` (el historial sobrevive a la cuenta, igual que `registro_actividad`).
- `dominio.motivos_movimiento (id, organizacion_id, nombre, aplica_a text[], activo, unique (organizacion_id, lower(nombre)))` + siembra por organización (disparador sobre `organizaciones`) y relleno de las existentes.
- Disparador `AFTER INSERT` en `dominio.productos` que crea `existencias` con 0, y relleno de los productos existentes. RLS y grants: `select` para `authenticated` con `nivel_seccion('stock')`; nada de escritura; `anon` sin nada.
- `public.registrar_movimiento_stock(p_producto uuid, p_tipo text, p_cantidad integer, p_motivo uuid, p_nota text default null, p_fecha date default current_date)` — *security definer* con `search_path = ''`: valida sesión, organización activa, `nivel_seccion('stock') = 'edicion'`, tipo, cantidad, fecha ≤ hoy, motivo activo de la organización y que aplique al tipo; bloquea la fila de existencias; calcula diferencia y saldo; actualiza; inserta el movimiento; llama a `private.registrar_actividad('stock.<tipo>', …)`. `revoke … from public, anon`; `grant execute … to authenticated`. Errores en castellano claro.
- Reversión: `drop function public.registrar_movimiento_stock(…)`, `drop trigger`/función de creación de existencias en `productos` y de siembra de motivos, `drop table dominio.movimientos_stock, dominio.motivos_movimiento, dominio.existencias` (pierde datos: exportar antes).

### M2 · F-STK-03 · `20261017150000_stock_historial_inmutable.sql`

- Disparador `BEFORE UPDATE OR DELETE` en `dominio.movimientos_stock` que siempre levanta excepción («Los movimientos de stock no se pueden modificar»); `revoke update, delete, truncate` para los roles de la app.
- `public.listar_movimientos_stock(p_producto uuid default null, p_limite integer default 25, p_desplazamiento integer default 0)` — *security invoker*, une con `productos` (nombre, SKU), devuelve filas y `total`, tope de tamaño 100, `anon` revocado, `authenticated` con grant.
- Reversión: `drop function public.listar_movimientos_stock`, `drop trigger` y su función.

### M3 · F-STK-05 · `20261017160000_stock_minimo_y_estados.sql`

- `alter table dominio.existencias add column minimo integer not null default 0 check (minimo >= 0)`.
- `public.definir_minimo_stock(p_producto uuid, p_minimo integer)` *security definer*: exige `edicion`, entero ≥ 0, actualiza y registra `stock.minimo`; grants como arriba.
- Vista `public.stock_estados` con `security_invoker = true`: `producto_id, nombre, sku, cantidad, minimo, estado, ultimo_movimiento_en`, con `estado = case when cantidad = 0 then 'sin_stock' when minimo > 0 and cantidad <= minimo then 'stock_bajo' else 'disponible' end`. `anon` revocado.
- Reversión: `drop view`, `drop function`, `alter table … drop column minimo` (pierde los mínimos: exportar antes).

### M4 · F-STK-06 · `20261017170000_stock_sin_negativos.sql`

- `alter table dominio.existencias add constraint existencias_cantidad_no_negativa check (cantidad >= 0)`.
- Disparador `BEFORE INSERT OR UPDATE OF cantidad` en `dominio.existencias` que, si `new.cantidad < 0`, levanta «No hay stock suficiente» con detalle «Hay N unidades y la salida es de M…» (SQLSTATE `23514`). Al ser un disparador de tabla protege cualquier camino (RPC, SQL directo, futuras RPC de MSF-292) sin tocar la RPC de F-STK-02.
- Reversión: `drop trigger`, su función y `drop constraint`.

> M3 y M4 modifican la misma tabla pero son independientes entre sí (columna vs. restricción).

## Diseño de frontend

- `apps/web/src/pages/stock/`: `list.tsx` (Stock actual), `movimientos.tsx` (historial paginado), `NuevoMovimientoDialog.tsx` (carga diferida), hooks `useStock`, `useMovimientos`, `useRegistrarMovimiento`, `useDefinirMinimo`. Recurso `stock` en `App.tsx`; permisos en `lib/permisos.ts` (`stock` ya figura como sección).
- F-STK-02 crea `list.tsx` (cantidad y «Nuevo movimiento») y el diálogo base; F-STK-05 agrega columnas, filtros y mínimo a `list.tsx`; F-STK-06 agrega al diálogo el aviso y el bloqueo del botón; F-STK-03 crea `movimientos.tsx`. Cada historia aporta sus propios archivos/migración y su Vitest.
- Textos del prototipo («Nuevo movimiento», «Registrar movimiento de stock», «No hay stock suficiente», «Movimiento registrado»), sin copiar HTML/CSS.

## Seguridad y concurrencia

- *security definer* solo en las dos RPC de escritura, con `search_path = ''`, validación explícita de organización/sección y sin aceptar `organizacion_id` ni actor del llamador.
- Serialización: `select … for update` de la fila de existencias; el disparador de F-STK-06 es la segunda barrera.
- Inmutabilidad: privilegios + disparador (defensa en profundidad).
- Sin service-role en el navegador. Revisión de seguridad en la tarea de cierre (`authz-security`, `database-reviewer`).

## Pruebas

- pgTAP: `stock_movimientos.test.sql` (F-STK-02), `stock_historial.test.sql` (F-STK-03), `stock_minimo_estados.test.sql` (F-STK-05), `stock_sin_negativos.test.sql` (F-STK-06); y verdes `rls_en_toda_tabla`, `aislamiento_organizaciones` y ejecutabilidad por `anon`.
- Vitest: diálogo, listado, historial, mínimo y aviso de negativo, por rol.
- E2E de la épica: tarea de cierre.

## Documentación

`docs/stock.md` (modelo, RPC, permisos, estados, inmutabilidad, reversión), `docs/permisos-por-rol.md`, `docs/aislamiento-por-organizacion.md`, fila de `docs/roadmap-template.md` al cerrar (paso manual). `pnpm docs:check` debe pasar.

## Verificación de esquema (Principio VII) — por tabla

| Tabla | Esquema declarado | Verificación en plan |
|-------|-------------------|----------------------|
| `dominio.existencias` | `dominio` | ✔ dominio del producto |
| `dominio.movimientos_stock` | `dominio` | ✔ dominio del producto |
| `dominio.motivos_movimiento` | `dominio` | ✔ dominio del producto |

Se vuelve a verificar contra las migraciones reales en la tarea de cierre (T020).
