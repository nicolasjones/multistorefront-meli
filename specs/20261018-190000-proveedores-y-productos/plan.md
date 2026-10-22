# Implementation Plan: Clientes y proveedores · Proveedores y productos

**Branch**: `epic/MSF-205-clientes-y-proveedores-proveedores-y-pro` | **Date**: 2026-10-18 | **Spec**: [spec.md](./spec.md) | **Tasks**: [tasks.md](./tasks.md)

## Summary

Se agrega la tabla de proveedores con CUIT y contacto (F-PRV-01), su listado con búsqueda (F-PRV-02) y la relación proveedor↔producto (F-PRV-03): cada producto guarda su proveedor principal y el código con que ese proveedor lo conoce, y la ficha del proveedor lista sus productos. Quien registra ingresos elige proveedor por la vista `proveedores_basico` (solo razón social). Se reutiliza el patrón CRUD de `pages/clientes` y de `pages/productos`; el costo, el ingreso de mercadería y todo lo no pedido por la épica quedan fuera (ver la matriz de `spec.md`). Sin Kestra, Superset ni workers.

## Technical Context

**Language/Version**: TypeScript / React (Vite) en `apps/web`; SQL en `supabase/migrations`.
**Primary Dependencies**: Refine + Material UI (componentes y tokens del sistema de diseño, `docs/sistema-de-diseno.md`); Supabase self-hosted (sin Cloud). Sin dependencias nuevas.
**Storage**: Postgres. `dominio.proveedores` (nueva), `dominio.productos` (2 columnas aditivas), vista `public.proveedores_basico`.
**Testing**: pgTAP (`supabase/tests/database/`, `pnpm test:db`), Vitest (`pnpm test:web`), `pnpm lint`, `pnpm build`, `pnpm docs:check`, `pnpm matriz:check`.
**Target Platform**: panel web de Refine (`apps/web`) y Supabase.
**Constraints**: RLS en toda tabla expuesta; la base es la autoridad (CUIT, unicidad, aislamiento); migraciones aditivas con reversión; RPC de `public` con `revoke … from public, anon` y `grant execute … to authenticated` (regla `anon`, `docs/acceso-ingreso.md`).
**Scale/Scope**: unos 135 proveedores por organización; paginación en servidor de todos modos.

## Constitution Check

| Principio | Cumplimiento |
|-----------|--------------|
| I. Aislamiento multi-tenant | RLS por `private.organizacion_id()` y sección en `dominio.proveedores`; FK compuestas `(…, organizacion_id)` impiden referencias cruzadas; pgTAP recorre `public` + `dominio`. |
| II. Especificar antes de implementar | Spec con matriz pantalla↔criterios, trazabilidad y decisiones abiertas. |
| III. Idempotencia y auditoría | Estado idempotente; eventos `proveedor.*` en `registro_actividad` con actor y fecha. |
| IV. Despliegues independientes | Solo `refine` + `supabase`; no se toca Compose. |
| V. Simplicidad | Una tabla nueva, dos columnas, una vista, RPC mínimas; sin infraestructura nueva. |
| VI. Panel operable | Entrada de menú con icono en Clientes y proveedores, rutas canónicas, estados compartidos, 320/768/1440 px, teclado y lector, sin identificadores técnicos. Carga inicial: la sección de productos de la ficha se consulta aparte (error aislado). |
| VII. Esquemas | `proveedores` → `dominio` (entidad de negocio); `productos` sigue en `dominio`; `proveedores_basico` es una **vista** de superficie en `public` (no tabla). Re-verificar en plan, tareas, implementación y revisión (T028). |
| VIII. Documentación | `docs/proveedores.md`, `permisos-por-rol.md`, `actividad.md`, `catalogo.md` (T027). |

**Excepción**: ninguna. (A diferencia de `clientes`, que vive en `public` por herencia del template, `proveedores` nace en `dominio`.)

## Project Structure

```text
supabase/migrations/
├── 20261018190001_proveedores_tabla.sql              # F-PRV-01: tabla, CUIT, RLS, grants
├── 20261018190100_proveedores_rpc.sql                # F-PRV-01: crear/actualizar/cambiar_estado
├── 20261018190200_proveedores_actividad.sql          # F-PRV-01: eventos proveedor.*
├── 20261018190300_proveedores_listar.sql             # F-PRV-02: listar_proveedores + índices
├── 20261018190400_productos_proveedor.sql            # F-PRV-03: columnas + FK + validación
├── 20261018190500_proveedores_basico.sql             # F-PRV-03: vista
├── 20261018190600_productos_proveedor_rpc.sql        # F-PRV-03: crear/actualizar_producto con proveedor
└── 20261018190700_productos_de_proveedor.sql         # F-PRV-03: productos_de_proveedor
supabase/tests/database/
├── proveedores.test.sql, proveedores_listar.test.sql, proveedores_productos.test.sql
apps/web/src/
├── lib/cuit.ts, lib/proveedores.ts
├── hooks/useListarProveedores.ts, useProveedoresBasico.ts, useProductosDeProveedor.ts
├── components/proveedores/ProveedorFormDialog.tsx, ProductosDelProveedor.tsx
└── pages/proveedores/{list,show}.tsx  (+ tests)   · pages/productos/{create,edit}.tsx (campos nuevos)
docs/proveedores.md (+ permisos-por-rol.md, actividad.md, catalogo.md)
```

## Diseño por historia

### F-PRV-01 — tabla, CUIT, RPC, ficha

- **Tabla** `dominio.proveedores` con `unique (id, organizacion_id)` y `unique (organizacion_id, cuit)`. Disparador `private.normalizar_proveedor()` (patrón de `normalizar_producto`): recorta, normaliza el CUIT a dígitos y valida largo y dígito verificador (pesos 5,4,3,2,7,6,5,4,3,2; resto 11), código `23514`; el duplicado sale del índice único (`23505`). Grants por columna como `productos`.
- **RPC** `security invoker` (rige RLS), `search_path = ''`, patrón de `crear_producto`/`actualizar_producto`: `edicion` en `proveedores`, bloqueo optimista por `updated_at`, error de conflicto con el mismo código que usa Catálogo (reutilizar el mapeo del front). `cambiar_estado_proveedor` es no-op si ya está en ese estado.
- **Actividad**: disparador `security definer` (patrón de `registrar_actividad_producto_editado`) que llama a `private.insertar_actividad`; solo registra si hubo cambio real. Verificar si `opciones_actividad`/filtros de `docs/actividad.md` enumeran tipos y agregar los cuatro.
- **Front**: `ProveedorFormDialog` (patrón de `clientes/create|edit`), `lib/cuit.ts` espeja la validación del servidor (la base manda), `show.tsx` con acciones por nivel de sección. Recurso `proveedores` registrado en la app con la ruta `show`; la entrada de menú llega con el listado (F-PRV-02) para no dejar un ítem que lleve a una ruta inexistente.

### F-PRV-02 — listado

- `listar_proveedores` `security invoker`: normaliza el término (sin tildes con `unaccent` si ya está habilitada en el repo; si no, comparar con `lower` y documentarlo), CUIT por dígitos, índice `gin (… gin_trgm_ops)` sobre razón social; orden `lower(razon_social), id`; `total_filas` con `count(*) over ()`. Tope de tamaño 200.
- `list.tsx` con el patrón de `clientes/list` (búsqueda con debounce, estado en la URL, tarjetas en angosto), filtro Estado y vacío con CTA solo para `edicion`. Entrada de menú e icono; guard de ruta por nivel (patrón `acceso-restringido`).

### F-PRV-03 — relación con productos

- **Migración de columnas** aditiva sobre `dominio.productos`; validación «proveedor nuevo activo» en disparador que solo aplica cuando `proveedor_id` cambia (así un proveedor desactivado no rompe la edición de productos ya asignados). `on delete restrict` (no hay delete igualmente).
- **Cambio de contrato**: `crear_producto`/`actualizar_producto` se reemplazan por firmas con `p_proveedor_id`/`p_codigo_proveedor` (`drop function` de la firma vieja + `create` + `revoke`/`grant`), en migración propia con reversión en el encabezado. **Alto riesgo de contrato (gate humano)**: señalarlo en el PR; actualizar todos los llamadores (`lib/productos*`, tests). Leer las migraciones `20261017120200` y `20261017120400` antes y conservar íntegro su comportamiento.
- **Vista** `proveedores_basico`: `security_invoker = false` a propósito (el Operador no tiene `select` sobre la tabla), con filtro explícito `organizacion_id = (select private.organizacion_id())` y condición de nivel; `revoke … from public, anon`; documentar por qué no es `security invoker`. pgTAP verifica que no hay columna sensible y que otra organización no se ve.
- **`productos_de_proveedor`** `security invoker`: RLS de `productos` + chequeo explícito de `proveedores` y `productos`.
- **Front**: selector de proveedor (Autocomplete sobre `useProveedoresBasico`) y campo de código en `productos/create|edit`; sección `ProductosDelProveedor` en la ficha con su propio hook (error aislado).

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|------------|
| Reemplazar las RPC de producto rompe a un llamador | Firmas nuevas con defaults, tests de ambos caminos (con/sin proveedor), búsqueda de llamadores (`graphify query`, `grep`) y revisión de contrato en el PR. |
| Vista que salta la RLS expone de más | Solo 3 columnas, filtro por organización y nivel, pgTAP de columnas y aislamiento, `anon` sin acceso. |
| CUIT con dígito verificador mal implementado | Casos conocidos válidos/inválidos en pgTAP y Vitest compartiendo vectores. |
| Alta simultánea con mismo CUIT | Índice único + mensaje de `23505`; prueba de duplicado directo en pgTAP. |
| Conflicto F-PRV-01 / F-PRV-03 sobre `show.tsx` | Orden declarado en el plan de ejecución: F-PRV-03 arranca con F-PRV-01 mergeada. |

## Reversión

Migraciones aditivas. Orden inverso, en migraciones posteriores (exportar datos antes): restaurar `crear_producto`/`actualizar_producto` de `20261017120200`/`20261017120400`; `drop function productos_de_proveedor`; `drop view proveedores_basico`; `alter table dominio.productos drop column proveedor_id, drop column codigo_proveedor`; `drop function listar_proveedores`; `drop trigger`/`function` de actividad y RPC; `drop table dominio.proveedores`. Cada archivo lleva su reversión en el encabezado.
