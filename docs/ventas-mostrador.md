# Venta de mostrador con lector de código de barras (F-VTA-31, MSF-329)

Spec: `specs/20261027-100000-ventas-mejoras/` (FR-001…FR-005, SC-001). Épica MSF-193.

## Qué hace

Pantalla `/ventas/mostrador` (menú Ventas → «Venta de mostrador», sección `ventas`): un campo de escaneo
(lector USB que «tipea» el código y envía Enter, o teclado) agrega líneas a una factura de mostrador y
«Cobrar» la confirma y registra el cobro.

- **Acceso** (FR-005): hace falta `ventas` en **edición** en la empresa activa; con solo lectura la ruta
  muestra «Acceso restringido» (la RPC también rechaza con `42501`). La sección `ventas` en lectura alcanza
  para el resto de las pantallas de Ventas.
- **Escaneo**: `public.buscar_producto_por_codigo_barras(p_codigo_barras text)` resuelve el producto
  **activo** de la organización por su EAN-13 (índice `productos_org_codigo_barras_uidx`). Sin coincidencia
  no devuelve filas y la pantalla muestra «Producto no encontrado» (CA-VTA-31-1). Un código que no tiene
  13 dígitos se rechaza (`22023`, `hint = 'codigo_barras'`). Exige `ventas` en `edicion` en la empresa activa.
  `revoke … from public, anon` + `grant execute … to authenticated`.
- **Venta en curso**: al primer escaneo se crea la factura `borrador` con `crear_comprobante` (canal
  Mostrador, cliente «Consumidor final», empresa activa). Cada escaneo llama a `guardar_lineas_comprobante`
  (cantidad 1; si el producto ya estaba, **incrementa** la línea). El precio, la escala y el total los calcula
  la base. No se crea un borrador al abrir la pantalla, solo al escanear.
  - La base guarda el depósito de salida de cada línea (si la línea llega sin depósito, usa el principal de la
    tienda), así que la línea nueva usa el depósito que ya usa la venta: si no, el segundo escaneo del mismo
    producto no encontraría la línea guardada y la **duplicaría** en vez de incrementarla.
  - El lector USB manda el siguiente código mientras el anterior todavía se resuelve: los códigos se **encolan**
    y se procesan en orden (cada uno con la tienda en la que se leyó). No se pierde ninguno.
- **Cobrar**: `confirmar_comprobante` (MSF-159) + `registrar_cobro` (MSF-195) por el total, con la forma de
  pago (y la cuenta de cobro si la forma la exige) elegida en pantalla. Si el cobro falla después de
  confirmar, el reintento no vuelve a confirmar y no se pueden agregar más productos.
- **Totales**: la línea muestra el precio **sin** IVA y el subtotal sin IVA; abajo, «Subtotal sin IVA», «IVA» y
  «Total», como en la pantalla de comprobante.
- **Empresa activa** (Principio VIII): la venta es de una sola tienda; con «Todas mis empresas» la pantalla
  pide elegir una. Al cambiar de empresa la venta en curso se descarta con aviso (el borrador ya creado
  queda en Comprobantes como `borrador`, no se cobra ni se guarda bajo la otra empresa). Si la tienda cambia
  mientras un escaneo está en vuelo, el borrador se descarta **con aviso** y no se muestra bajo la nueva.

## Firmas reutilizadas de MSF-195

Salen de `supabase/migrations/20270114100300_registrar_cobro.sql` (rama `dokploy`):
`public.registrar_cobro(p_comprobante_id uuid, p_importe numeric, p_forma_pago_id uuid, p_cuenta_cobro_id uuid, p_actualizado_en timestamptz)`
y `dominio.cobros_comprobante` (`20270114100000_cobros_comprobante.sql`). No se stubean ni se redefinen.

## Datos y reversión

Migración `20270121130000_mostrador_buscar_producto.sql`: aditiva, sin tablas nuevas (esquema `public`
para la RPC de plataforma; lee `dominio.productos`). Reversión: `drop function public.buscar_producto_por_codigo_barras(text);`

## Pruebas

- pgTAP `supabase/tests/database/ventas_mostrador.test.sql`.
- Vitest `apps/web/src/lib/ventasMostrador.test.ts` y `apps/web/src/pages/ventas/mostrador.test.tsx`
  (incremento de la línea con el depósito real, cola de escaneos, descarte al cambiar de tienda, error al
  cargar las formas de pago y totales con el IVA aparte).
- E2E `apps/web/e2e/ventas-mostrador.e2e.ts` (`[MSF-329:T007] [F-VTA-31#1]`).
