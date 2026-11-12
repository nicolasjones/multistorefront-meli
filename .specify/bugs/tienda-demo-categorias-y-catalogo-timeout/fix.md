# Fix — MSF-825

- `supabase/migrations/20270228100000_tienda_publica_rendimiento_y_categorias.sql`: conteo materializado,
  solo categorías con productos, conteo con subcategorías, precio directo en el listado, filtro por subárbol.
- `supabase/migrations/20270228100100_productos_nombre_sin_prefijo_de_importacion.sql`: el disparador de productos
  quita el prefijo de importación; limpieza de lo ya cargado.
- Front (`apps/web/src/`): `lib/tiendaCategorias.ts` (principales y panel en árbol), `lib/tiendaTextos.ts`,
  menú/home/pie/menú móvil, ficha (descripción igual al nombre), contacto («Retiro y envíos», «24 h»).
