# Test — MSF-825

- pgTAP: `tienda_categorias_publicas` (sin vacías, raíz suma hijas, listado = conteo), `productos_nombre_importacion`
  (nuevo), y sin regresiones en `tienda_catalogo_publico`, `promociones_precio`, `tienda_busqueda_publica`,
  `tienda_destacados_publicos`.
- Rendimiento local (2.200 productos, 170 categorías, rol `anon`): categorías 4,1 s → 30 ms; catálogo 14,9 s → ~0,3 s (relevancia) y ~1 s (orden o tope de precio).
- Vitest: `tiendaTextos`, `tiendaCategorias`, contacto, tienda-publica.
