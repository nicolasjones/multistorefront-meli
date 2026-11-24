# Bug Fix: precio final al centavo, margen sin comisión y dólar con 4 decimales

- **Slug**: msf-720
- **Fixed**: 2026-11-24
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Se completa el arreglo de MSF-720 que había quedado a medias en el lote 32. La base y el espejo del IVA
ya redondeaban al centavo (`20270507180200_aplicar_iva_al_centavo.sql`, `lib/iva.ts`); en este cambio se
corrigen las dos partes visibles que faltaban:

1. El texto del margen ahora dice que **no incluye** la comisión del canal (el cálculo del formulario es
   `(Precio − Costo) / Precio`).
2. La cotización del dólar se muestra con **hasta 4 decimales** en todos los lugares donde se muestra el
   dólar: las pantallas de Cotización y de Inicio, el bloque «Precio y costo» del formulario de producto
   («Con dólar …» y el hint «costo $ … · con dólar …») y «Dólar vigente» de la pestaña «Precios y moneda».

No se recalcula ningún comprobante emitido ni se agrega una migración: el cambio de esquema ya estaba en
`dokploy`.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/web/src/lib/formatoImporte.ts` | modified | `formatearImporteHasta(valor, decimales)`: mismo agrupado de miles y signo que el formateador compartido, sin redondear a 2. |
| `apps/web/src/lib/cotizacion.ts` | modified | `formatearCotizacion` usa el formateador de hasta 4 decimales. |
| `apps/web/src/lib/precios.ts` | modified | `NOTA_MARGEN` aclara que el margen no descuenta la comisión del canal. |
| `apps/web/src/components/precios/PrecioCostoBloque.tsx` | modified | El hint «Con dólar …» y el de costo muestran el dólar con sus 4 decimales. |
| `apps/web/src/components/precios/ReglaPrecioEmpresa.tsx` | modified | «Dólar vigente …» muestra el dólar con sus 4 decimales. |
| `apps/web/src/lib/cotizacion.test.ts` | modified | 3 y 4 decimales visibles; entero sin decimales. |
| `apps/web/src/lib/formatoImporte.test.ts` | modified | Casos del formateador de hasta 4 decimales. |
| `apps/web/src/lib/precios.test.ts` | modified | La nota del margen declara que no incluye la comisión. |
| `apps/web/src/components/precios/PrecioCostoBloque.test.tsx` | modified | Texto esperado del margen + el dólar con 4 decimales. |
| `apps/web/src/pages/empresas/precios.test.tsx` | modified | «Dólar vigente» con los 4 decimales de la base. |
| `apps/web/e2e/msf-720-precios-visibles.e2e.ts` | nuevo | Recorrido visible: el margen aclara que no incluye la comisión y el dólar se ve con 4 decimales. |
| `design/pantallas/ProductoAlta.dc.html`, `ProductoEditar.dc.html`, `ProductoEditar/ProductoEditar.dc.html` y `design/precios-e-iva/ProductoAlta.dc.html` | modified | El prototipo muestra el mismo texto de margen que la app. |
| `docs/precios.md`, `docs/tecnico/precios-e-iva.md`, `docs/cotizacion-carga-diaria.md`, `docs/iva-precio-final.md` | modified | Fórmula, aclaración de comisión y formato de 4 decimales. |
| `specs/20261022-120000-precios-e-iva/spec.md` | modified | Nota de MSF-720 sobre el texto vigente del margen (FR-006). |

## Diff Highlights

```ts
export function formatearImporteHasta(valor: number, decimales: number): string {
  if (!Number.isFinite(valor)) return '—'
  const factor = 10 ** decimales
  const escalado = Math.round(Math.abs(valor) * factor)
  const entero = Math.floor(escalado / factor)
  const resto = String(escalado % factor).padStart(decimales, '0').replace(/0+$/, '')
  const miles = String(entero).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const signo = valor < 0 && escalado > 0 ? '-' : ''
  const conDecimales = resto === '' ? '' : `,${resto.length === 1 ? `${resto}0` : resto}`
  return `${signo}$ ${miles}${conDecimales}`
}
```

```ts
export const NOTA_MARGEN = 'Margen = (Precio − Costo) / Precio; no incluye la comisión del canal. El precio es central para todas las stores.'
```

## Tests Added or Updated

- `apps/web/src/lib/cotizacion.test.ts` — `formatearCotizacion(1465,125)` y `(1465,1234)` conservan 3 y 4 decimales; `(1465,5)` mantiene los 2 del formato de importes; `(1465)` queda entero.
- `apps/web/src/lib/formatoImporte.test.ts` — el formateador de hasta 4 decimales agrupa miles, recorta ceros sobrantes y conserva el centavo mínimo.
- `apps/web/src/lib/precios.test.ts` — `NOTA_MARGEN` contiene `(Precio − Costo) / Precio` y `no incluye la comisión del canal`.
- `apps/web/src/components/precios/PrecioCostoBloque.test.tsx` — el bloque muestra la nota corregida y el dólar con 4 decimales (`$ 1.465,1234`).
- `apps/web/src/pages/empresas/precios.test.tsx` — «Dólar vigente $ 1.465,1234» en la pestaña de la empresa.
- `apps/web/e2e/msf-720-precios-visibles.e2e.ts` — E2E (rótulo `[MSF-720:BUG]`): producto en USD con la cotización 1.465,1234 → el precio en pesos, el dólar con 4 decimales y el margen con su nota.

**Los tests vigilan la regla** (comprobado cambiando la regla a propósito): con `formatearCotizacion` a 2
decimales fallan los 3 tests del dólar; con el texto viejo del margen fallan el test de `lib/precios.ts` y el
del bloque de precio.

## Local Verification

- `pnpm --filter @platform/web exec vitest run src/components/precios src/components/cotizacion src/pages/cotizacion src/pages/empresas src/lib/cotizacion.test.ts src/lib/cotizacionHistorial.test.ts src/lib/precios.test.ts src/lib/formatoImporte.test.ts src/lib/iva.test.ts src/lib/escalas.test.ts` → 592 tests, 35 archivos, OK.
- `pnpm build` → OK.
- `pnpm lint` → OK (solo warnings previos de `react(set-state-in-effect)` ajenos a este cambio).
- `pnpm docs:check` → OK (documentación, migraciones y trampas).
- `pnpm prototipo:check` → OK (120 pantallas al día).
- `pnpm matriz:check` → OK.
- `pnpm calidad` → oxlint, knip, jscpd, dependency-cruiser y syncpack OK; **gitleaks no corrió** (la herramienta va en Docker y este entorno no tiene acceso al daemon).
- E2E y pgTAP: no se pudieron correr localmente (no hay Docker ni stack de Supabase en este entorno); los corre el CI.

## Deviations from Assessment

- El assessment mencionaba `lib/iva.ts` y la migración como pendientes; ya estaban resueltos por el lote 32
  en `dokploy`. Se conserva su cobertura existente (`iva.test.ts`, `lote32_iva_al_centavo.test.sql`) y no se
  duplica una migración.
- Se eligió **corregir el texto** del margen (no descontar la comisión en el formulario): la comisión es por
  canal y la ficha de producto no tiene un canal elegido; el margen con comisión es el de Rentabilidad. Es
  la opción que habilita la decisión de negocio del 2026-11-17 («el texto aclara si incluye la comisión»).
- El assessment señalaba solo `lib/cotizacion.ts` para el dólar; al leer el código aparecieron dos places
  más que muestran **la cotización** con 2 decimales (`PrecioCostoBloque` y `ReglaPrecioEmpresa`): se
  arreglaron también, porque el síntoma era «el dólar se muestra con 2 de sus 4 decimales».

## Follow-ups

- Ninguno obligatorio. Si producto quiere que el formulario muestre además el margen después de comisión,
  necesita un selector de canal: va como historia propia.
