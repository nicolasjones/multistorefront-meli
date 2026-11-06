# Catálogo · Exportar productos a CSV (F-CAT-11)

Spec: `specs/20270125-100000-catalogo-compatibilidad-y-planillas/` (US3, FR-201…FR-209, SC-201, SC-202).

## Qué hace

El **Administrador** ve el botón «Exportar» en el listado de Productos. Abre el diálogo «Exportar productos» (prototipo `design/pantallas/Productos.dc.html`) con tres campos:

- **Qué exportar**: «Lo filtrado (N)» (respeta búsqueda, estado, categoría, disponibilidad y la empresa activa) o «Todos (N)» (todo el catálogo, sin filtros).
- **Formato**: CSV. «Excel (.xlsx)» se muestra deshabilitado (Decisión 5 de la spec: manda el requisito «exportación CSV»).
- **Columnas**: SKU, Nombre, Categoría, Precio, Costo, Stock, Visible en, Estado, Código de barras, Proveedor. Por defecto las ocho primeras. **Costo** y **Proveedor** solo se ofrecen con acceso a Rentabilidad.

Al confirmar se descarga `productos-AAAA-MM-DD.csv` y el listado avisa «Exportación CSV lista: N productos, M columnas». Sin productos el botón del diálogo queda deshabilitado. Si cambia la empresa activa con el diálogo abierto, se cierra con un aviso (Principio VIII).

## Formato del archivo

UTF-8 con BOM, separador `;`, fin de línea CRLF (abre bien en Excel en castellano). Los campos con comillas, `;`, comas o saltos de línea van entre comillas y las comillas se duplican. Toda celda que empieza con `=`, `+`, `-` o `@` se antepone con `'` (neutralización de fórmulas, FR-207). Precio sale como `MONEDA monto`; Stock, con la misma etiqueta del listado.

## Servidor

`public.exportar_productos(p_filtros jsonb, p_columnas text[], p_desde uuid, p_limite integer) returns jsonb` (`{filas, siguiente, total}`), migración `20270121121301_exportar_productos.sql`. Esquema `public` (función de solo lectura sobre `v_productos_listado` y `dominio`); no crea tablas.

- `security definer` (para registrar actividad) con autorización propia: `42501` si no es Administrador de la organización de la sesión; `42501` si pide `costo` o `proveedor` sin Rentabilidad; `22023` por columna desconocida o `p_limite` fuera de 1…1000. Toda lectura va acotada a la organización de la sesión. `anon` y `public` sin ejecución.
- Paginación estable por cursor de `id` (el cliente pide páginas de 500 y las concatena).
- La **primera página** registra la actividad `producto.exportado` (quién, cuántos productos, qué columnas; sin precios ni costos). Una exportación cancelada a mitad igual queda registrada.
- `p_filtros`: `{ busqueda, categoria_id, estado, empresa_id, disponibilidad, compatible: text[], todos }`. `compatible` (F-CAT-09) lo entiende el servidor aunque el listado todavía no lo mande.

## Reversión

Aditiva. `drop function public.exportar_productos(jsonb, text[], uuid, integer);` y quitar el botón del listado. No hay datos que migrar.

## Pruebas

- pgTAP: `supabase/tests/database/catalogo_exportar.test.sql` (aislamiento, Administrador, `42501` por costo sin Rentabilidad, paginación, actividad).
- Vitest: `pnpm --filter @platform/web test -- exportar-productos`.
