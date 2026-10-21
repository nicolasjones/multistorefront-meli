# Implementation Plan: Clientes y proveedores · Ingreso de mercadería por proveedor

**Branch**: `epic/MSF-219-ingreso-de-mercaderia-por-proveedor` | **Date**: 2026-10-21 | **Spec**: [spec.md](./spec.md)

## Summary

Se agrega el ingreso de mercadería por proveedor sobre el stock único de
MSF-136: dos tablas nuevas en `dominio` (`ingresos_mercaderia` y sus líneas),
un motivo de anulación y RPC atómicas para registrar, listar y anular. Cada
línea llama a `public.registrar_movimiento_stock` con tipo `entrada`; si se
marca la opción, se actualiza el costo del producto en `dominio.producto_costos`.
En `apps/web` se suma la pestaña «Ingreso de mercadería» dentro de Stock, con
formulario, historial filtrable y anulación con motivo.

## Technical Context

**Language/Version**: TypeScript / React (Vite) en `apps/web`; SQL (Postgres 15) en `supabase/migrations` y pgTAP en `supabase/tests/database/`.

**Primary Dependencies**: Refine, MUI y `@supabase/supabase-js` — ya presentes; no se agregan dependencias. Depende de MSF-205 (`dominio.proveedores`, `productos.proveedor_id`) y MSF-136 (`public.registrar_movimiento_stock`), ambos presentes en la base `dokploy` de esta rama.

**Storage**: Postgres self-hosted (Supabase). Tablas nuevas en `dominio`; RPC en `public`.

**Testing**: pgTAP (permisos, atomicidad, aislamiento, anulación, concurrencia); Vitest + Testing Library (formulario, historial, anulación, roles); Playwright en el cierre de la épica.

**Target Platform**: web (navegador), panel Refine; Supabase self-hosted en Docker.

**Project Type**: web app (frontend + base de datos).

**Performance Goals**: listado paginado en servidor (25 por página, tope 100) y registro de hasta 100 líneas por ingreso en una transacción; el historial no bloquea la carga del formulario (carga diferida de la pestaña).

**Constraints**: migraciones aditivas con reversión documentada; nada de service-role en el navegador; `anon` sin privilegios; stock único por organización (sin depósitos hasta MSF-292); no copiar HTML/CSS del prototipo; una migración por historia con timestamp propio.

**Scale/Scope**: 3 historias (L + M + S, 28 h), 2 tablas nuevas, 1 motivo nuevo, 2 RPC de escritura + 2 de lectura, 1 pantalla (`/stock/ingresos`) con formulario, historial y diálogo de anulación.

## Constitution Check

- **I / VII · Esquema**: `ingresos_mercaderia` y `ingresos_mercaderia_lineas` son entidades del negocio → `dominio`; `public` solo publica RPC. Se re-verifica contra las migraciones reales en el cierre (T026). ✔
- **II · Requisitos y permisos**: la spec define roles (`stock` lectura/edición, `rentabilidad` para costo), fallos, auditoría y datos. ✔
- **III · Atomicidad y consistencia**: la RPC de registro y la de anulación son transaccionales; el stock se mueve solo por la RPC de MSF-136, que bloquea la fila de existencias. La anulación de varias líneas ordena por producto para evitar deadlocks. ✔
- **VI · Navegación y accesibilidad**: pestaña dentro de Stock, ruta `/stock/ingresos`, estados compartidos, teclado, lector de pantalla y 320/768/1440 px. ✔
- **VII · Aislamiento**: todas las tablas con RLS por `organizacion_id` y `nivel_seccion('stock')`; las RPC de escritura validan sesión, organización y permisos; `anon` revocado. ✔
- **VIII · Documentación**: `docs/ingreso-de-mercaderia.md` nuevo, y actualización de `docs/stock.md`, `docs/permisos-por-rol.md`, `docs/aislamiento-por-organizacion.md` y `mkdocs.yml`; roadmap al cerrar. ✔
- **Complexity Tracking**: sin excepciones. La única dependencia de base es MSF-205, ya integrada en `dokploy`.

## Diseño de datos

Migraciones aditivas, con reversión en el encabezado de cada archivo.
Timestamps posteriores al último de `dokploy` (`20261020150000`).

### M1 · F-PRV-04 · `20261021180000_ingresos_mercaderia_tablas.sql`

- `dominio.ingresos_mercaderia`:
  `id uuid pk`, `organizacion_id uuid not null default private.organizacion_id()`,
  `empresa_id uuid not null`, `proveedor_id uuid not null`,
  `fecha date not null`, `comprobante text check (length <= 100)`,
  `estado text not null default 'registrado' check (estado in ('registrado','anulado'))`,
  `motivo_anulacion text check (length between 3 and 500)`,
  `anulado_por uuid`, `anulado_en timestamptz`, `actor_id uuid`,
  `actor_nombre text`, `creado_en timestamptz not null default now()`,
  `clave_idempotencia uuid not null`.
  - FK compuesta `(proveedor_id, organizacion_id) → dominio.proveedores (id, organizacion_id)`.
  - FK compuesta `(empresa_id, organizacion_id) → dominio.empresas (id, organizacion_id)`.
  - `check` de coherencia: `estado = 'anulado'` exige `motivo_anulacion`, `anulado_por` y `anulado_en`; `estado = 'registrado'` los exige nulos.
  - `unique (organizacion_id, clave_idempotencia)`.
  - Índices `(organizacion_id, creado_en desc, id)`, `(organizacion_id, proveedor_id, fecha desc)`, `(organizacion_id, empresa_id, fecha desc)`.
- `dominio.ingresos_mercaderia_lineas`:
  `id uuid pk`, `ingreso_id uuid not null references ... on delete cascade`,
  `organizacion_id uuid not null`, `producto_id uuid not null`,
  `cantidad integer not null check (cantidad > 0)`,
  `costo_unitario_usd numeric(14,2) not null check (costo_unitario_usd >= 0)`,
  `movimiento_id uuid not null unique`, `movimiento_anulacion_id uuid unique`,
  `creado_en timestamptz not null default now()`.
  - FK compuesta `(producto_id, organizacion_id) → dominio.productos (id, organizacion_id)`.
  - FK `movimiento_id` y `movimiento_anulacion_id` → `dominio.movimientos_stock (id)`.
  - `unique (ingreso_id, producto_id)`.
  - Índice `(organizacion_id, producto_id)`.
- RLS en ambas: `select` para `authenticated` con `organizacion_id = private.organizacion_id()` y `nivel_seccion('stock') in ('lectura','edicion')`; **sin** políticas de insert/update/delete. `revoke all from anon`; grants de `select` a `authenticated`.
- Motivo nuevo: insertar «Anulación de ingreso de mercadería» (`{salida}`) en todas las organizaciones y reemplazar `private.sembrar_motivos_movimiento` para incluirla en las nuevas. Reversión: restaurar la función anterior y borrar el motivo.
- Reversión M1: `drop table dominio.ingresos_mercaderia_lineas, dominio.ingresos_mercaderia` (pierde datos: exportar antes) y restaurar el motivo/función.

### M2 · F-PRV-04 · `20261021180100_ingresos_mercaderia_registrar.sql`

- `public.registrar_ingreso_mercaderia(p_empresa uuid, p_proveedor uuid,
  p_fecha date, p_comprobante text, p_lineas jsonb,
  p_actualizar_costo boolean default false, p_clave_idempotencia uuid default null)`
  *security definer*, `search_path = ''`, `returns dominio.ingresos_mercaderia`.
  - Valida sesión y `nivel_seccion('stock') = 'edicion'`.
  - Valida `p_empresa in (select private.empresas_accesibles())`, empresa activa, proveedor activo de la organización y fecha ≤ hoy.
  - Valida `p_lineas`: array JSON no vacío, hasta 100 elementos, `producto_id` uuid, `cantidad` entero > 0, `costo_unitario_usd` numérico ≥ 0 con ≤ 2 decimales, sin productos repetidos; todos los productos activos y de la organización.
  - Si `p_actualizar_costo`, exige `nivel_seccion('rentabilidad') = 'edicion'` (si no, error claro; la UI oculta la casilla).
  - Idempotencia: si `p_clave_idempotencia` ya existe para la organización, devuelve el ingreso existente sin volver a mover stock.
  - Inserta cabecera y líneas; por línea busca el motivo «Compra a proveedor» (activo) y llama a `public.registrar_movimiento_stock(p_producto, 'entrada', cantidad, motivo, nota, p_fecha)`, guardando `movimiento_id`. La nota incluye el comprobante (máx. 500).
  - Si `p_actualizar_costo`, hace `insert ... on conflict (producto_id) do update` en `dominio.producto_costos` con el costo de la línea.
  - Registra `ingreso.registrado` con proveedor, empresa, comprobante y unidades (sin costos).
  - `revoke … from public, anon`; `grant execute … to authenticated`.
- Reversión: `drop function public.registrar_ingreso_mercaderia(...)`.

### M3 · F-PRV-05 · `20261021180200_ingresos_mercaderia_listar.sql`

- `public.listar_ingresos_mercaderia(p_desde date default null, p_hasta date default null,
  p_proveedor uuid default null, p_empresa uuid default null, p_producto uuid default null,
  p_operador uuid default null, p_pagina integer default 1, p_tamano integer default 25)`
  *security invoker*, `returns table (...)` con una fila por línea (fecha, ingreso_id,
  producto, sku, cantidad, costo_unitario_usd, destino, empresa, proveedor, operador,
  estado, motivo_anulacion, anulado_en, total).
  - RLS de ambas tablas hace el filtro por organización; el tope de `p_tamano` es 100.
- `public.detalle_ingreso_mercaderia(p_ingreso uuid)` *security invoker*: cabecera + líneas + movimientos vinculados; sin filas de otra organización.
- Reversión: `drop function public.detalle_ingreso_mercaderia(uuid), public.listar_ingresos_mercaderia(...)`.

### M4 · F-PRV-06 · `20261021180300_ingresos_mercaderia_anular.sql`

- `public.anular_ingreso_mercaderia(p_ingreso uuid, p_motivo text)`
  *security definer*, `search_path = ''`, `returns dominio.ingresos_mercaderia`.
  - Exige `nivel_seccion('stock') = 'edicion'` y motivo de 3 a 500 caracteres.
  - Bloquea la cabecera `for update`; si no existe, es de otra organización o ya está anulada → error claro.
  - Recorre las líneas ordenadas por `producto_id`; por cada una llama a
    `registrar_movimiento_stock(producto, 'salida', cantidad, motivo_anulacion, nota, current_date)`
    y guarda `movimiento_anulacion_id`. Si falta stock, la RPC de stock lanza y toda la anulación se revierte.
  - Marca la cabecera `anulado`, `motivo_anulacion`, `anulado_por = auth.uid()`, `anulado_en = now()`.
  - Registra `ingreso.anulado` sin costos.
  - `revoke … from public, anon`; `grant execute … to authenticated`.
- Reversión: `drop function public.anular_ingreso_mercaderia(uuid, text)`.

## Diseño de frontend

- `apps/web/src/pages/stock/ingresos.tsx`: pantalla de la pestaña «Ingreso de mercadería»;
  formulario inline (`IngresoMercaderiaForm.tsx`) y, debajo, el historial
  (`HistorialIngresos.tsx`). Carga diferida de la ruta como el resto de Stock.
- `apps/web/src/components/stock/`:
  - `IngresoMercaderiaForm.tsx`: empresa (selector de `useEmpresasAccesibles`), proveedor
    (`useListarProveedores`), fecha, comprobante, líneas (producto con nombre/SKU, cantidad
    con −/+, costo USD, quitar), «Agregar producto», casilla de costo visible solo con
    `rentabilidad` edición, total de unidades y productos, «Limpiar», «Registrar ingreso».
  - `HistorialIngresos.tsx`: tabla paginada con fecha, producto, cantidad, destino,
    empresa, proveedor, operador y estado; filtros por rango de fechas, proveedor,
    empresa, producto y operador; acción «Anular» solo con `stock` edición y estado
    registrado.
  - `AnularIngresoDialog.tsx`: motivo obligatorio (3–500), confirmación y estados de
    envío/error.
- `apps/web/src/hooks/`: `useIngresos`, `useRegistrarIngreso`, `useAnularIngreso`,
  `useDetalleIngreso`; invalidan las queries de stock (`useStock`, `useMovimientos`) y
  del historial al registrar/anular.
- `apps/web/src/lib/ingresos.ts`: normalización de líneas, validación local (cantidad,
  costo, duplicados), generación de `clave_idempotencia` (`crypto.randomUUID()`), y
  mensajes de error.
- `PestanasStock.tsx`: tercera pestaña «Ingreso de mercadería» y `activa: 'stock' |
  'movimientos' | 'ingresos'`; `App.tsx`: ruta lazy `/stock/ingresos` con
  `RequiereAccesoSeccion seccion="stock"`.
- Reutiliza el patrón de tablas, filtros, estados vacío/error/carga y diálogos del
  sistema de diseño. No copia HTML/CSS del prototipo.
- Diferencias con el prototipo a anotar en el PR: sin selector de depósito (MSF-292),
  panel «Stock resultante» sin separar Local/Depósito (stock único), historial completo
  y diálogo de anulación no dibujados (se usan los patrones del sistema de diseño).

## Seguridad y concurrencia

- `security definer` solo en las RPC de escritura, con `search_path = ''`, sin aceptar
  `organizacion_id` ni actor del llamador; validan `auth.uid()`, organización y sección.
- `security invoker` en las RPC de lectura: la RLS es la última barrera.
- Registro: una transacción; si una línea falla, no queda cabecera, línea, movimiento,
  costo ni evento. La RPC de stock bloquea cada producto, así que dos ingresos
  simultáneos se serializan por producto.
- Anulación: bloqueo de la cabecera `for update` + estado; orden por `producto_id` para
  evitar deadlocks entre anulaciones concurrentes. Si falta stock en cualquier línea, no
  se anula nada.
- Idempotencia: `(organizacion_id, clave_idempotencia)` única; el reintento devuelve el
  ingreso ya creado sin mover stock.
- Inmutabilidad: las tablas nuevas no tienen políticas de escritura; `anon` sin grants.
  Los movimientos siguen siendo inmutables por MSF-136.
- Sin service-role en el navegador. Revisión de seguridad en el cierre (`authz-security`,
  `database-reviewer`).

## Pruebas

- pgTAP:
  - `ingresos_mercaderia_registrar.test.sql`: alta con una y varias líneas; stock y
    movimientos; evento; costo actualizado solo con permiso; sin permiso de stock;
    fecha futura; producto/proveedor inactivo o de otra organización; líneas duplicadas;
    idempotencia; atomicidad cuando falla una línea; `anon` sin acceso.
  - `ingresos_mercaderia_historial.test.sql`: listado, orden, paginación, filtros,
    estado anulado, aislamiento entre organizaciones, rol `ninguno`.
  - `ingresos_mercaderia_anular.test.sql`: anulación con stock suficiente; stock
    insuficiente revierte todo; doble anulación; carrera de dos anulaciones; evento.
  - Verdes `rls_en_toda_tabla`, `aislamiento_organizaciones` y ejecutabilidad por `anon`
    con las tablas y RPC nuevas.
- Vitest: formulario (agregar/quitar líneas, validaciones, casilla por permiso, doble
  envío, errores del servidor), historial (filtros, paginación, vacío, estado anulado) y
  anulación (motivo, confirmación, error de stock insuficiente).
- E2E de cierre: proveedor → ingreso de 2 productos con costo → stock sube → historial →
  anular → stock vuelve y el ingreso queda anulado.

## Documentación

`docs/ingreso-de-mercaderia.md` (modelo, RPC, permisos, idempotencia, anulación,
reversión y diferencias con el prototipo), `docs/stock.md` (motivo nuevo y relación con
el libro de movimientos), `docs/permisos-por-rol.md` (stock/rentabilidad),
`docs/aislamiento-por-organizacion.md` (tablas nuevas) y `mkdocs.yml`. Al cerrar, fila en
`docs/roadmap-template.md`. `pnpm docs:check` debe pasar.

## Verificación de esquema (Principio VII) — por tabla

| Tabla | Esquema declarado | Verificación en plan |
|-------|-------------------|----------------------|
| `dominio.ingresos_mercaderia` | `dominio` | ✔ entidad del negocio |
| `dominio.ingresos_mercaderia_lineas` | `dominio` | ✔ entidad del negocio |
| `dominio.movimientos_stock` | `dominio` | ✔ existente, sin cambios de esquema |
| `dominio.motivos_movimiento` | `dominio` | ✔ existente, alta de un motivo |
| `dominio.proveedores` | `dominio` | ✔ existente (MSF-205) |
| `dominio.productos` | `dominio` | ✔ existente (MSF-205) |
| `dominio.producto_costos` | `dominio` | ✔ existente, actualización por RPC |
| `dominio.existencias` | `dominio` | ✔ existente, actualización por RPC de stock |
| `dominio.empresas` | `dominio` | ✔ existente |
| `public.organizaciones` | `public` | ✔ plataforma |
| `public.registro_actividad` | `public` | ✔ plataforma |

Se vuelve a verificar contra las migraciones reales en el cierre (T026).

## Riesgos y decisiones de implementación

- **F-STK-10**: sigue abierta; esta épica no la implementa. No bloquea.
- **Productos de otro proveedor**: se permiten (ver supuesto de la spec); si producto
  decide restringir, cambia solo la consulta del selector y la validación, no el modelo.
- **Costo en USD**: `producto_costos.costo` no guarda moneda; se interpreta en USD en
  este producto. Si se agrega multimoneda, se ajusta en otra épica.
- **Empresa inactiva**: no se ofrece para ingresos nuevos; el historial conserva las
  filas viejas.
- **Depósitos**: cuando llegue MSF-292 se agrega `deposito_id` y el selector; el modelo
  actual no lo incluye para no inventar una FK inexistente.
