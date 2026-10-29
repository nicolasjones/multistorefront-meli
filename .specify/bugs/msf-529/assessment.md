# Bug Assessment: Código de barras (EAN-13) del producto no existe

- **Slug**: msf-529
- **Created**: 2026-10-19
- **Source**: pasted text — "[Seguimiento MSF-205] Código de barras del producto (Jira MSF-529)"; no URL (nada que fetchear)
- **Verdict**: valid (brecha funcional trazada, no regresión)
- **Severity**: medium

## Report (verbatim or summarized)

Tarea `seguimiento` abierta por el cierre de la épica MSF-205 (spec `20261018-190000-proveedores-y-productos`, Decisiones abiertas #6, T029, FR-020). `docs/catalogo.md` asignaba el código de barras a MSF-205, pero la épica no lo incluye; quedó fuera de alcance con seguimiento trazado.

## Symptom

El prototipo (`ProductoAlta`/`ProductoEditar`: «Proveedor y código de barras», campo «Código de barras (EAN-13)»; `Productos` listado: columna «Código de barras») muestra el dato; la app no lo tiene: ni columna en BD, ni campo en el alta/edición, ni columna en el listado.

## Reproduction

1. Abrir Catálogo → Nuevo producto: no hay campo «Código de barras (EAN-13)».
2. Abrir un producto existente (edición): tampoco.
3. Listado de productos: sin columna «Código de barras».

## Suspected Code Paths

- `supabase/migrations/20261017120100_catalogo_productos_y_costos.sql:17` — `dominio.productos` sin columna de código de barras.
- `supabase/migrations/20261021162200_productos_proveedor_rpc.sql:24,87` — `public.crear_producto` / `public.actualizar_producto` no reciben ni persisten el código; también los triggers `conservar_updated_at_producto` (l.187) y `registrar_actividad_producto_editado` (l.209) comparan listas de columnas explícitas.
- `apps/web/src/lib/productos.ts` — `FormularioProducto`, validación, `aParametrosCrear`, parámetros de actualizar, `Producto`.
- `apps/web/src/pages/productos/create.tsx`, `edit.tsx` (const `COLUMNAS`, l.21), `list.tsx` — formulario y listado.
- `design/pantallas/ProductoAlta.dc.html`, `ProductoEditar.dc.html`, `Productos.dc.html` (+ `.inventory.json`) — fuente de verdad visual.
- `docs/catalogo.md:10,62`, `specs/20261018-190000-proveedores-y-productos/spec.md:184,239` — documentan la exclusión.

## Root Cause Hypothesis

Omisión de alcance deliberada: la épica MSF-205 no pedía código de barras y se difirió (spec Decisiones #6). No hay defecto de código; hay que implementar la capacidad. Confianza: alta.

## Proposed Remediation

**Preferred**: migración aditiva que agregue `dominio.productos.codigo_barras text` (nullable; check de 13 dígitos numéricos con dígito verificador EAN-13 opcional; índice único parcial `(organizacion_id, codigo_barras) where codigo_barras is not null`). Nueva migración que reemplaza `crear_producto`/`actualizar_producto` con el parámetro `p_codigo_barras text default null` (mantener `grant execute ... to authenticated` y `revoke ... from public, anon`; ver regla de `anon`), y actualizar los triggers de updated_at/actividad para incluir la columna. En web: campo «Código de barras (EAN-13)» en alta/edición (sección «Proveedor y código de barras» según prototipo), columna en el listado, validación espejo en `lib/productos.ts`. Esquema: `dominio` (dominio del producto).

**Alternatives**:
- Sin unicidad: más simple, pero permite duplicados que rompen la búsqueda por escáner.
- Alcance de variantes (código de barras por variante): pertenece a otra épica de Catálogo (fuera de alcance).

**Files likely to change**:
- `supabase/migrations/<nueva>_productos_codigo_barras.sql` (+ reversión documentada)
- `apps/web/src/lib/productos.ts`, `pages/productos/{create,edit,list}.tsx` y sus tests
- `supabase/tests/` (pgTAP de crear/actualizar producto con código de barras)
- `docs/catalogo.md`, spec nueva con `## Matriz pantalla↔criterios` (flujo Spec Kit; alcance `refine`, `supabase`)

**Tests to add or update**:
- pgTAP: guarda y actualiza el código; rechaza formato inválido y duplicado en la misma organización; permite el mismo en otra.
- Vitest: validación del formulario y mapeo a parámetros; edit/create renderizan el campo.

## Risks & Considerations

- Cambiar firma de RPC: reemplazar la versión anterior para no dejar sobrecargas ambiguas ni funciones ejecutables por `anon`.
- Unicidad con datos existentes: la columna nace vacía, sin conflicto; la importación masiva queda aparte.
- Es funcionalidad nueva: la regla del proyecto pide spec (Spec Kit) antes de implementar, no un parche directo.
- Reversión: `drop column` en migración posterior, no en el mismo PR.

## Open Questions

- [NEEDS CLARIFICATION: ¿unicidad por organización o solo formato?]
- [NEEDS CLARIFICATION: ¿se valida dígito verificador EAN-13 o solo 13 dígitos? El prototipo dice «13 dígitos, o escanea».]
- [NEEDS CLARIFICATION: ¿incluye código de barras por variante o solo por producto?]
