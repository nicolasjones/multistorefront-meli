# Bug Assessment: precio final con IVA al peso entero, margen sin comisión y dólar a 2 decimales

- **Slug**: msf-720
- **Created**: 2026-11-24
- **Source**: descripción del ticket MSF-720 (It's a Plan) + `docs/decisiones-2026-11-17.md`
- **Verdict**: valid (parcialmente corregido en la base por el lote 32)
- **Severity**: medium (dinero mostrado distinto de lo facturado)

## Report (resumido)

«El precio final con IVA (al peso entero) no coincide con el total del comprobante (al centavo); además
el margen no descuenta la comisión y el dólar se muestra con 2 de sus 4 decimales.»

## Symptom

Tres desalineaciones entre lo que ve la persona y lo que calcula el sistema:

1. `private.aplicar_iva` redondeaba el precio final con IVA al **peso entero**, mientras la línea del
   comprobante redondea el IVA **al centavo**. Con neto 1230 al 21 % se publicaba 1.488 y el comprobante
   cobraba 1.488,30.
2. El texto del formulario de producto decía «Margen = Precio − Costo − Comisión del canal», pero
   `resumirPrecios` calcula `(neto − costo) / neto` **sin** descontar la comisión.
3. `formatearCotizacion` delegaba en `formatearPesosPrecio` (máximo 2 decimales), aunque la base guarda
   `numeric(14,4)` y el formulario admite hasta 4: un dólar 1.465,1234 se mostraba 1.465,12.

## Reproduction

1. Producto con neto 1230 y alícuota 21 %: la vista de precio final debe dar 1.488,30 (no 1.488) y una
   línea de 3 unidades debe totalizar 4.464,90.
2. Cargar una cotización con 4 decimales (p. ej. 1465,1234) y abrir Cotización / Inicio: debe mostrarse
   con sus 4 decimales, no truncada a 2.
3. En la ficha de producto, el texto del margen debe decir de forma explícita que **no** incluye la
   comisión del canal.

[NEEDS CLARIFICATION: la reproducción 1 ya está cubierta por pgTAP (`lote32_iva_al_centavo.test.sql`) y
Vitest (`iva.test.ts`): el arreglo de base y del espejo se hizo en el lote 32 (`20270507180200`). Para
este ticket quedan la 2 y la 3, que se reproducen con tests de `lib/cotizacion.ts` y `lib/precios.ts`.]

## Suspected Code Paths

- `supabase/migrations/20261022140200_precios_empresa_iva.sql:272` — `round(neto * (1 + pct/100))` al peso.
- `supabase/migrations/20270507180200_aplicar_iva_al_centavo.sql` — ya lo lleva a `round(…, 2)`; está en
  `dokploy` desde el lote 32. No se recalcula lo emitido.
- `apps/web/src/lib/iva.ts:30-49` — espejo del cálculo; ya redondea al centavo.
- `apps/web/src/lib/precios.ts:19` — `NOTA_MARGEN` afirma que se descuenta la comisión.
- `apps/web/src/lib/precios.ts:57-68` — `resumirPrecios` no descuenta comisión (correcto: el formulario no
  tiene canal; solo hay que aclararlo en el texto).
- `apps/web/src/lib/cotizacion.ts:113` — `formatearCotizacion = formatearPesosPrecio` (2 decimales).

## Root Cause Hypothesis

El criterio de redondeo del IVA nació en la base al peso entero y la UI lo espejó; el lote 32 unificó todo
al centavo. Quedaron dos textos/formateos derivados: la nota del margen promete una resta de comisión que
el cálculo no hace, y el formateador del dólar descarta los decimales 3 y 4 que la base sí guarda.
Confianza: alta (código y migraciones leídos; la parte del IVA ya está verificada por sus tests).

## Proposed Remediation

- **IVA**: sin migración nueva; `20270507180200_aplicar_iva_al_centavo.sql` y `lib/iva.ts` ya están al
  centavo. Se conserva la cobertura de regresión existente.
- **Margen**: corregir `NOTA_MARGEN` para aclarar que el margen mostrado es `(Precio − Costo) / Precio` y
  **no incluye** la comisión del canal. Se actualiza el texto en el prototipo y en los tests.
- **Cotización**: `formatearCotizacion` pasa a mostrar hasta **4** decimales (con el mismo agrupado de
  miles): 1.465 → «$ 1.465»; 1.465,5 → «$ 1.465,50»; 1.465,1234 → «$ 1.465,1234».

## Files likely to change

- `apps/web/src/lib/cotizacion.ts`, `apps/web/src/lib/cotizacion.test.ts`
- `apps/web/src/lib/formatoImporte.ts`, `apps/web/src/lib/formatoImporte.test.ts`
- `apps/web/src/lib/precios.ts`, `apps/web/src/lib/precios.test.ts`
- `apps/web/src/components/precios/PrecioCostoBloque.test.tsx`
- `design/pantallas/ProductoAlta.dc.html`, `ProductoEditar.dc.html`, `ProductoEditar/ProductoEditar.dc.html`
  y `design/precios-e-iva/ProductoAlta.dc.html` (texto de la nota)
- `docs/precios.md`, `docs/tecnico/precios-e-iva.md`, `docs/cotizacion-carga-diaria.md`

## Tests to add or update

- `lib/cotizacion.test.ts`: formateo con 3 y 4 decimales y conservación del entero.
- `lib/formatoImporte.test.ts`: el formateador de hasta 4 decimales conserva los 4, agrupa miles y recorta
  ceros sobrantes.
- `lib/precios.test.ts`: la nota del margen dice que no incluye la comisión.
- `components/precios/PrecioCostoBloque.test.tsx`: ajustar el texto esperado.

## Risks & Considerations

- `formatearCotizacion` se usa en varias pantallas (Cotización, Inicio, diálogos de dólar): el cambio es de
  presentación y no altera los números guardados ni los cálculos.
- No se toca lo ya emitido: los comprobantes guardan sus importes.
- Sin cambios de esquema en este ticket; no se crea migración.
