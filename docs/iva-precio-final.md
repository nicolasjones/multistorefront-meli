---
owner: tecnico
sources:
  - apps/web/src/lib/iva.ts
  - supabase/migrations/20270507180200_aplicar_iva_al_centavo.sql
  - supabase/migrations/20261022140200_precios_empresa_iva.sql
---

# IVA por categoría y precio final (F-PRE-12 · MSF-200)

- **Esquema** (Principio VII): `dominio.alicuotas_iva` y las columnas `alicuota_iva_id` de `dominio.categorias` y `dominio.productos` viven en `dominio`; las RPC y la vista `public.precios_empresa_final`, en `public`. Migraciones aditivas `20261022140000`…`140200`; reversión documentada en el encabezado de cada una.
- **Herencia**: la alícuota del producto es la propia o, si no tiene, la de su categoría (`private.alicuota_producto`). Las categorías nacen en 21 %.
- **Precio final** = neto × (1 + alícuota) **al centavo** (desde `20270507180200`; antes al peso entero), igual que el total con IVA del comprobante; Exento ⇒ final = neto. No se recalculan los comprobantes ya emitidos. La cotización del dólar ya admite hasta 4 decimales en SQL (`numeric(14, 4)`). La fórmula vive en la base (`private.aplicar_iva`); `calcularFinal` (`apps/web/src/lib/iva.ts`) la espeja solo para el texto de ejemplo del formulario de producto. El espejo usa aritmética decimal exacta con `BigInt` (neto y alícuota a 10 decimales) y redondea la mitad alejándose del cero, igual que `round(numeric, 2)` de Postgres: sin errores de coma flotante, también con netos de 3 decimales y negativos (`iva.ts`; prueba de la base: `supabase/tests/database/lote32_iva_al_centavo.test.sql`).
- **Alícuota inactiva**: la RPC responde `23514` y un disparador (`private.exigir_alicuota_activa`) lo repite en un `UPDATE` directo de la columna, que el rol `authenticated` necesita porque las RPC son `security invoker`.
- **Rendimiento**: `private.alicuota_producto` es `security definer` y se evalúa por fila a propósito (un rol sin la sección `categorias` no leería la categoría por RLS); `previsualizar_precios_empresa` recorta la muestra antes de resolver el IVA.
- **Empresa activa** (Principio VIII): Categorías es de la organización (la empresa activa solo filtra la vista); la pestaña «Precios y moneda» recarga todo al cambiar de empresa (`pages/empresas/precios.test.tsx`).

## Formulario de producto (T028, FR-021)

- Campo **IVA** (`components/precios/IvaProducto.tsx`): «Heredar de la categoría (21 %)» o una alícuota propia. Se guarda con la RPC `asignar_alicuota_producto` (`asignarAlicuotaProducto`) después de crear/actualizar el producto; si falla, el producto queda guardado y se ofrece «Reintentar IVA» (hereda la de su categoría mientras tanto).
- El texto «Con IVA 21 %: $ … (IVA $ …)» se calcula con `calcularFinal` solo cuando el precio de lista está en pesos; en dólares el final depende de la cotización y lo calcula el servidor (vista `precios_empresa_final`). `calcularFinal` usa aritmética entera exacta (BigInt) sobre los decimales con que se escribió el neto y la alícuota, y redondea la mitad lejos del cero como `round(numeric, 2)`: coincide con `private.aplicar_iva` con cualquier cantidad de cifras (8 enteras y 3 decimales incluidos). Se verifica contra una tabla de 1.298 casos generada en un Postgres descartable (`pnpm iva:tabla` → `apps/web/src/lib/iva.tabla.json`).
- El `UPDATE` directo de `alicuota_iva_id` (grant de columna para que las RPC `SECURITY INVOKER` funcionen) sigue sujeto a las políticas `categorias_update` / `productos_update`, que exigen `edicion` en la sección; pgTAP lo verifica con el rol de consulta.
- `docs/schema.html` no se regeneró: `pnpm docs:schema` necesita el Supabase local corriendo y expone `public`; las tablas de `dominio` tocadas (`alicuotas_iva`, columnas `alicuota_iva_id`) quedan documentadas en las migraciones `20261022140000…140200`.

## Precios de la tienda al centavo (lote 38)

La tienda pública muestra los precios finales **al centavo**, igual que el comprobante: la base redondea cada precio final a dos decimales (`private.aplicar_iva`) y la pantalla ya no lo redondea al peso. Política de formato (`formatearPrecioArs`): pesos justos sin decimales («$ 18.455», como el prototipo) y, con centavos, siempre dos decimales («$ 18.455,50»). Los subtotales de la lista de pedido y su total se suman en **centavos enteros** (`subtotalLinea`, `totalLista`), igual que el presupuesto. Se revisaron catálogo, ficha, buscador, favoritos, lista de pedido, mensaje de WhatsApp, presupuesto y compras. Lo que no cambia: el filtro «Precio máximo» (pesos enteros) y el redondeo por tienda en múltiplos (`redondeo_pesos`), que es una regla de negocio configurable.
