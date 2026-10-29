# Bug Assessment: Varios proveedores por producto (seguimiento MSF-205)

- **Slug**: msf-530
- **Created**: 2026-10-19
- **Source**: pasted text (Jira MSF-530, sin URL)
- **Verdict**: valid (brecha funcional trazada, no regresión)
- **Severity**: medium

## Report (verbatim or summarized)

"[Seguimiento MSF-205] Varios proveedores por producto (Jira MSF-530)". Tarea `seguimiento` abierta por FR-020 / T029 de la spec `20261018-190000-proveedores-y-productos`: la épica MSF-205 no pide varios proveedores por producto, se difirió con decisión provisoria.

## Symptom

Un producto solo puede tener un proveedor (más un código de proveedor). No se puede cargar más de un proveedor por producto ni un código por proveedor. Esperado por el seguimiento: poder asociar varios proveedores a un mismo producto, cada uno con su código.

## Reproduction

1. Abrir Productos → Nuevo/Editar producto.
2. El formulario ofrece un único selector «Proveedor» y un único «Código del proveedor».
3. Asociar un segundo proveedor al mismo producto no es posible: guardar otro proveedor reemplaza al anterior y limpia su código.

[NEEDS CLARIFICATION: criterio de aceptación de negocio de MSF-530 (¿hay proveedor principal? ¿costo por proveedor? ¿el prototipo `ProductoAlta`/`ProductoEditar` dibuja varios?). La spec dice que el prototipo dibuja uno solo.]

## Suspected Code Paths

- `supabase/migrations/20261021162000_productos_proveedor.sql` — `dominio.productos.proveedor_id` + `codigo_proveedor` (1:N producto→proveedor), FK compuesta `(proveedor_id, organizacion_id)`, CHECK `productos_codigo_requiere_proveedor`, trigger `private.validar_proveedor_producto` (valida activo, limpia código al quitar proveedor).
- `supabase/migrations/20261021162200_productos_proveedor_rpc.sql` — firmas de `public.crear_producto` (9 args) y `public.actualizar_producto` (12 args) con `p_proveedor_id`/`p_codigo_proveedor` escalares.
- `supabase/migrations/20261021162300_productos_de_proveedor.sql` — `public.productos_de_proveedor(uuid,int,int)` lee `productos.proveedor_id` (ficha del proveedor).
- `apps/web/src/lib/productos.ts` — `FormularioProducto` con `proveedor_id`/`codigo_proveedor` escalares y validación.
- `apps/web/src/components/productos/FormularioProducto.tsx` — selector único de proveedor (`opcionesProveedor`, `elegirProveedor`).
- `apps/web/src/components/proveedores/ProductosDelProveedor.tsx`, `apps/web/src/hooks/useProductosDeProveedor.ts` — sección de productos en la ficha del proveedor.
- `specs/20261018-190000-proveedores-y-productos/spec.md` — «Proveedor principal» (L37), Decisión abierta 5 (L183: «si hace falta más de uno, se agrega una tabla de relación en una épica posterior (aditivo)»), FR-020.

## Root Cause Hypothesis

Limitación de modelo por decisión de alcance, no defecto: la relación es una columna escalar en `dominio.productos`, por lo que el esquema, las RPC y el formulario solo admiten un proveedor. La spec ya prevé la salida: tabla de relación aditiva. Confianza: alta.

## Proposed Remediation

**Preferred**: nueva spec (Spec Kit, castellano; alcance `supabase` + `refine`) que agregue `dominio.productos_proveedores` (`producto_id`, `proveedor_id`, `organizacion_id`, `codigo_proveedor`, `principal boolean`, `unique (producto_id, proveedor_id)`, índice único parcial `principal` por producto, FKs compuestas por organización, RLS por organización y sección, grants por columna, `anon` sin privilegios, sin delete salvo decisión explícita). Backfill aditivo desde `productos.proveedor_id/codigo_proveedor` (la fila existente pasa a `principal`). Mantener `productos.proveedor_id` como «proveedor principal» sincronizado (trigger o RPC) para no romper reportes, `productos_de_proveedor` ni las firmas de `crear_producto`/`actualizar_producto`; añadir RPC `asignar_proveedor_producto`/`quitar_proveedor_producto` en vez de cambiar firmas. UI: lista editable de proveedores en el formulario de producto y `productos_de_proveedor` leyendo la tabla nueva. Reversión documentada en la migración; no se destruyen las columnas viejas en el mismo PR.

**Alternatives**:
- Array `proveedores jsonb` en `productos`: simple pero sin integridad referencial ni RLS por fila; descartado.
- Reemplazar columnas por la tabla en un solo paso: rompe firmas y viola la regla de migraciones aditivas.

**Files likely to change**:
- `supabase/migrations/<nueva>_productos_proveedores.sql` (+ RPC)
- `apps/web/src/lib/productos.ts`
- `apps/web/src/components/productos/FormularioProducto.tsx`
- `apps/web/src/hooks/useProductosDeProveedor.ts`, `apps/web/src/components/proveedores/ProductosDelProveedor.tsx`
- `design/pantallas/ProductoAlta.dc.html` / `ProductoEditar.dc.html` + `.inventory.json` (el prototipo manda la UI) y `## Matriz pantalla↔criterios`
- `specs/<nueva>/spec.md`, `docs/catalogo.md`, `docs/roadmap-template.md`

**Tests to add or update**:
- pgTAP: unicidad producto+proveedor, un solo principal, aislamiento por organización, proveedor desactivado no se asigna nuevo, grants (`anon` sin ejecución).
- Vitest: `lib/productos.test.ts` y formulario con varios proveedores.
- Backfill: productos existentes conservan su proveedor como principal.

## Risks & Considerations

- Requiere decisión de producto y cambio de prototipo antes de implementar UI (regla «el prototipo manda»); sin spec no se implementa.
- Compatibilidad: reportes de reposición usan «proveedor principal»; debe seguir válido.
- Migración con backfill: aditiva, con camino de reversión explícito; RLS y `revoke ... from public, anon` en toda RPC nueva.
- Esquema (Principio VII): tabla de dominio → `dominio`.

## Open Questions

- [NEEDS CLARIFICATION: ¿se requiere proveedor principal obligatorio o solo uno marcado?]
- [NEEDS CLARIFICATION: ¿atributos por relación (costo, código, plazo) o solo el código?]
- [NEEDS CLARIFICATION: ¿el prototipo se rediseña o se declara fuera de alcance de la matriz?]
