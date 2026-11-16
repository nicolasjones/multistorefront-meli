---
owner: tecnico
sources:
  - specs/20261027-100000-ventas-mejoras
  - supabase/migrations/20270114100000_cobros_comprobante.sql
  - supabase/migrations/20270114100300_registrar_cobro.sql
  - supabase/migrations/20270202200400_mostrador_buscar_producto.sql
---

# Venta de mostrador con lector de código de barras (F-VTA-31, MSF-329)

> **Guía de referencia de ingeniería.** Existe una versión reorganizada: [versión técnica](tecnico/ventas-mostrador.md) · [guía de uso](producto/ventas-mostrador.md). Esta página conserva el detalle de contratos, RPC, migraciones y decisiones que las otras versiones pueden no repetir; ante una diferencia, verificá contra el código y la spec.

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
- **Precio promocional** (MSF-816, F-2; con la bandera `promociones_precio` encendida): si el producto tiene una promoción
  vigente de la tienda y es más barata que el precio normal, la fila muestra el precio cobrado, el **precio anterior
  tachado** y la leyenda «Promoción» (para el lector de pantalla se anuncian «Precio anterior» y «Precio promocional»;
  el rótulo de escala pasa a «promoción»). El servidor calcula todo (`precio_referencia` por línea); el navegador no
  decide nada. Cada escaneo reprecia todas las líneas: si entre dos escaneos una promoción venció o empezó y el precio de
  una línea ya cargada cambió (también si una promoción vigente cambia de monto, incluso en el producto recién escaneado;
  un cambio de escala por cantidad sin promoción no avisa), aparece el aviso informativo «Los precios cambiaron: revisá el
  total.» en una región viva (`role="status"`) que ya estaba en el DOM, sin robar el foco (no bloquea el escaneo). Si al cobrar el servidor rechaza con `40001` y `hint = 'precios_cambiaron'` (guarda de F-3), la pantalla
  re-guarda las mismas líneas, muestra «Los precios cambiaron: revisá el total y cobrá de nuevo» con el total nuevo y
  **no** cobra sola. Si el re-guardado falla muestra «No pudimos actualizar los precios. Probá de nuevo.». Con la bandera apagada la pantalla es idéntica a la anterior. Un **precio manual** manda y no lleva referencia ni «Promoción». Comportamiento conocido y seguimientos (una baja del precio normal bajo la promoción mostrada no se rechaza al cobrar, S7 = MSF-938; PDF sin precio de lista, S4 = MSF-935; bandera con ventas abiertas, S6 = MSF-937): ver [`ventas-comprobantes.md`](./ventas-comprobantes.md#comportamiento-conocido-y-seguimientos-msf-816-f-4).
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

Migración `20270202200400_mostrador_buscar_producto.sql`: aditiva, sin tablas nuevas (esquema `public`
para la RPC de plataforma; lee `dominio.productos`). Reversión: `drop function public.buscar_producto_por_codigo_barras(text);`

## Pruebas

- pgTAP `supabase/tests/database/ventas_mostrador.test.sql`.
- Vitest `apps/web/src/lib/ventasMostrador.test.ts` y `apps/web/src/pages/ventas/mostrador.test.tsx`
  (incremento de la línea con el depósito real, cola de escaneos, descarte al cambiar de tienda, error al
  cargar las formas de pago y totales con el IVA aparte).
- E2E `apps/web/e2e/ventas-mostrador.e2e.ts` (`[MSF-329:T007] [F-VTA-31#1]`) y `apps/web/e2e/ventas-mostrador-promocion.e2e.ts`
  (`[MSF-816:T012]`: tachado y «Promoción», cobro al precio promocional con total del comprobante = total del cobro, bandera
  apagada idéntica y aviso por promoción vencida entre escaneos; fija y restaura la bandera; correr con `--workers=1`).
