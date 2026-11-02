# Fix MSF-722

## Cambios
- `supabase/migrations/20270122100000_busqueda_sin_tildes_columna_calculada.sql` (aditiva, sin tablas nuevas;
  esquemas `public` y `dominio` según la relación): columna calculada `nombre_norm` (`private.normalizar_busqueda`)
  en `v_productos_listado`, `stock_estados` y `dominio.productos`. Reversión: `drop function ... nombre_norm(...)`.
- `lib/busquedaTexto.ts`: normaliza lo tipeado (NFD, minúsculas). `filtroBusquedaProductos` y `filtroBusquedaStock`
  filtran `nombre_norm.ilike` → «camara» encuentra «Cámara».
- `lib/productosListado.ts`: 13 dígitos → `codigo_barras.eq.X,sku.ilike.X` (también por SKU).
- `lib/reparacionItems.ts`: `buscarProductosConAviso` (pide 21, devuelve 20 + `hayMas`); `AgregarProductoDialog`
  muestra «Hay más resultados: afiná la búsqueda para verlos.».
- `ImprimirComprobanteDialog.tsx`: la pestaña se abre en blanco en el clic y recibe la URL al estar listo el PDF;
  se cierra si falla; si el navegador la bloquea (o se cerró) no se registra nada hasta que la persona abre el enlace.
