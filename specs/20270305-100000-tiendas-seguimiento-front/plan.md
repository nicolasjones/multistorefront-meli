# Implementation Plan: Tiendas públicas · Seguimiento del front (MSF-846 B)

**Spec**: [`spec.md`](./spec.md) · **Alcance de entrega**: `refine`.

## Enfoque técnico

- `lib/tiendaCategorias.ts`: `cuantasEntran(anchos, anchoMas, gap, disponible, hayMas)` (función pura). `layout/MenuCategorias.tsx` mide una copia invisible con `ResizeObserver` y dibuja `principales.slice(0, n)` + «Más categorías».
- `components/pagina/CargaInfinita.tsx`: la zona de controles rastrea el foco y lo devuelve al control vigente tras cada cambio de fase; región viva vacía en error; estilo de `aria-disabled`.
- `hooks/useCatalogoPublico.ts`: `claveVista` en estado; al cambiar la clave se descarta lo acumulado durante el render.
- E2E: locators exactos y acotados a `<main>`.
- Sin migraciones. Reversión: revertir los commits.
