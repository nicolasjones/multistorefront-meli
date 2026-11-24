# Bug Fix: precio final al centavo, margen sin comisión y dólar con 4 decimales

- **Slug**: msf-720
- **Fixed**: 2026-11-24
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

El ticket reportaba tres desalineaciones entre lo que ve la persona y lo que calcula el sistema. Cada una
tiene un criterio único, tomado de la decisión de negocio del 2026-11-17 (`docs/decisiones-2026-11-17.md`,
«MSF-720 · Redondeo del precio final, margen y cotización»):

1. **Precio final con IVA**: la fórmula única de la base (`private.aplicar_iva`) redondea **al centavo**, igual
   que el total del comprobante. La dejó la migración `20270507180200_aplicar_iva_al_centavo.sql` (lote 32),
   que ya está en `dokploy`; el espejo del front (`calcularFinal`, `apps/web/src/lib/iva.ts`) redondea igual
   con aritmética decimal exacta (`BigInt`). **No se recalculan los comprobantes ya emitidos.**
2. **Margen**: el formulario de producto no tiene canal elegido, así que su margen es `(Precio − Costo) /
   Precio`; el texto lo aclara: «Margen = (Precio − Costo) / Precio; no incluye la comisión del canal…». La
   comisión por canal sigue entrando en la vista de Rentabilidad (`analitica.margen_producto_canal`).
3. **Dólar**: la base guarda la cotización con 4 decimales (`numeric(14,4)`) y la pantalla los muestra: el
   formateador del dólar usa hasta 4 decimales y todas las pantallas que muestran la cotización (Cotización,
   Inicio, el bloque «Precio y costo» del producto, «Dólar vigente» de la pestaña «Precios y moneda» y la
   pestaña «Cotizaciones» del historial) la muestran con sus 4 decimales.

**No se crea migración en este PR**: la del IVA ya está en la base real (`dokploy`) y la regla del repositorio
prohíbe tocar una migración aplicada.

## Qué aporta este PR (sobre `dokploy`)

El arreglo funcional de los tres puntos ya está en `dokploy` (el IVA con la migración del lote 32; el texto del
margen y el dólar con 4 decimales con el PR #1171, «lote 48b»). Este PR deja la historia completa y coherente:

| File | Change | Notes |
|------|--------|-------|
| `.specify/bugs/msf-720/assessment.md` | nuevo | Evaluación del bug: síntomas, reproducción, causa raíz y arreglo propuesto. |
| `.specify/bugs/msf-720/fix.md` | nuevo | Este documento. |
| `.specify/bugs/msf-720/test.md` | nuevo | Verificación: qué se reprodujo, qué test vigila cada regla y qué no se pudo correr localmente. |
| `design/pantallas/ProductoAlta.dc.html`, `design/pantallas/ProductoEditar.dc.html`, `design/pantallas/ProductoEditar/ProductoEditar.dc.html`, `design/precios-e-iva/ProductoAlta.dc.html` | modified | El prototipo muestra la nota del margen vigente («(Precio − Costo) / Precio; no incluye la comisión del canal»), igual que la app: el prototipo manda la UI. |
| `specs/20261022-120000-precios-e-iva/spec.md` | modified | Nota sobre FR-006: el texto vigente del margen y por qué (decisión del 2026-11-17). |
| `apps/web/e2e/precios-visibles.e2e.ts` | modified | Solo cambian el título del test (rótulo `[MSF-720:BUG]`: el pipeline ata el video a la historia por la etiqueta) y un comentario; no se crea ni se borra ningún E2E. |

## Lo que ya estaba resuelto en la base (no se re-implementa)

| Síntoma | Dónde quedó | Cobertura |
|---|---|---|
| Precio final al peso entero | `supabase/migrations/20270507180200_aplicar_iva_al_centavo.sql` (`private.aplicar_iva` redondea a 2 decimales; la vista `public.precios_empresa_final` y `private.precio_final_publico` la usan) | `supabase/tests/database/lote32_iva_al_centavo.test.sql`, `apps/web/src/lib/iva.test.ts` |
| Texto del margen que prometía la comisión | `apps/web/src/lib/precios.ts` (`NOTA_MARGEN`) | `apps/web/src/lib/precios.test.ts`, `apps/web/src/components/precios/PrecioCostoBloque.test.tsx` |
| Dólar con 2 de sus 4 decimales | `apps/web/src/lib/cotizacion.ts` (`formatearCotizacion` → `formatearImporteHasta(valor, 4)`), `apps/web/src/lib/formatoImporte.ts`, `components/precios/PrecioCostoBloque.tsx`, `components/precios/ReglaPrecioEmpresa.tsx`, `pages/historial/CotizacionesTab.tsx` | `apps/web/src/lib/cotizacion.test.ts`, `apps/web/src/lib/formatoImporte.test.ts`, `apps/web/src/components/precios/PrecioCostoBloque.test.tsx`, `apps/web/src/pages/empresas/precios.test.tsx`, `apps/web/src/pages/historial/CotizacionesTab.test.tsx` |

## Diff Highlights

El texto del margen (única fórmula del margen en el formulario):

```ts
export const NOTA_MARGEN = 'Margen = (Precio − Costo) / Precio; no incluye la comisión del canal. El precio es central para todas las stores.'
```

El dólar con sus 4 decimales:

```ts
export const formatearCotizacion = (valor: number) => formatearImporteHasta(valor, 4)
```

## Tests Added or Updated

En este PR no se agrega código de aplicación: la cobertura de las tres reglas ya existe en la base y se verificó
que falla si la regla cambia (ver `test.md`). Lo que sí se agrega es el E2E con el rótulo de la historia y la
alineación del prototipo.

- `apps/web/e2e/precios-visibles.e2e.ts` — E2E (rótulo `[MSF-720:BUG]`): producto en USD con la cotización
  1.465,1234 → el precio en pesos, el dólar con 4 decimales y el margen con su nota.

## Local Verification

- `pnpm --filter @platform/web exec vitest run src/lib/formatoImporte.test.ts src/lib/cotizacion.test.ts src/lib/precios.test.ts src/lib/iva.test.ts src/components/precios src/pages/empresas/precios.test.tsx src/pages/historial/CotizacionesTab.test.tsx` → OK (corrida local del autor; el resultado vigente es el del CI).
- `pnpm build` → OK (corrida local del autor).
- `pnpm lint` → OK (0 errores; solo warnings previos de `react(set-state-in-effect)` ajenos a este cambio).
- `pnpm docs:check` → OK (documentación, migraciones sin nuevas contra `origin/dokploy` y trampas conocidas).
- `pnpm prototipo:check` → OK.
- `pnpm matriz:check` → OK.
- `pnpm calidad` → oxlint, knip, jscpd, dependency-cruiser y syncpack OK; **gitleaks no corrió** (la herramienta
  va en Docker y este entorno no tiene acceso al daemon).
- `pnpm der:check` → falla en dos specs que este PR no toca (`20261012-140000-empresas`,
  `20261013-120000-usuarios-y-roles`): deuda de la base, no de esta historia.
- pgTAP y E2E: no se pudieron correr localmente (no hay Docker ni stack de Supabase en este entorno); los corre el CI.

## Deviations from Assessment

- El assessment daba por pendientes `lib/iva.ts` y la migración del IVA: ya estaban resueltos por el lote 32 en
  `dokploy`. Se conserva su cobertura existente (`iva.test.ts`, `lote32_iva_al_centavo.test.sql`) y no se
  duplica una migración.
- Se eligió **corregir el texto** del margen (no descontar la comisión en el formulario): la comisión es por
  canal y la ficha de producto no tiene un canal elegido; el margen con comisión es el de Rentabilidad. Es la
  opción que habilita la decisión de negocio del 2026-11-17 («el texto aclara si incluye la comisión»).
- El assessment señalaba solo `lib/cotizacion.ts` para el dólar; aparecieron más lugares que muestran **la
  cotización** con 2 decimales (`PrecioCostoBloque`, `ReglaPrecioEmpresa` y la pestaña «Cotizaciones» del
  historial): se arreglaron también, porque el síntoma era «el dólar se muestra con 2 de sus 4 decimales».

## Follow-ups

- Ninguno obligatorio. Si producto quiere que el formulario muestre además el margen después de comisión,
  necesita un selector de canal: va como historia propia.
