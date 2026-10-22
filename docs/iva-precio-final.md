# IVA por categoría y precio final (F-PRE-12 · MSF-200)

- **Esquema** (Principio VII): `dominio.alicuotas_iva` y las columnas `alicuota_iva_id` de `dominio.categorias` y `dominio.productos` viven en `dominio`; las RPC y la vista `public.precios_empresa_final`, en `public`. Migraciones aditivas `20261022140000`…`140200`; reversión documentada en el encabezado de cada una.
- **Herencia**: la alícuota del producto es la propia o, si no tiene, la de su categoría (`private.alicuota_producto`). Las categorías nacen en 21 %.
- **Precio final** = neto × (1 + alícuota) al peso entero; Exento ⇒ final = neto. La fórmula vive en la base (`private.aplicar_iva`); `calcularFinal` (`apps/web/src/lib/iva.ts`) la espeja solo para el texto de ejemplo del formulario de producto.
- **Alícuota inactiva**: la RPC responde `23514` y un disparador (`private.exigir_alicuota_activa`) lo repite en un `UPDATE` directo de la columna, que el rol `authenticated` necesita porque las RPC son `security invoker`.
- **Rendimiento**: `private.alicuota_producto` es `security definer` y se evalúa por fila a propósito (un rol sin la sección `categorias` no leería la categoría por RLS); `previsualizar_precios_empresa` recorta la muestra antes de resolver el IVA.
- **Empresa activa** (Principio VIII): Categorías es de la organización (la empresa activa solo filtra la vista); la pestaña «Precios y moneda» recarga todo al cambiar de empresa (`pages/empresas/precios.test.tsx`).
