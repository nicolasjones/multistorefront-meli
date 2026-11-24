# Bug Fix: Rendimiento móvil del catálogo y la ficha medido y registrado (MSF-552 · T071/SC-010 de MSF-167)

- **Slug**: msf-552
- **Fixed**: 2026-11-24
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

SC-010 estaba cerrado sin cifras. Este cambio deja la medición repetible (script `pnpm medir:tienda`, job `medir`
del nightly, siembra de 500 productos por tienda, guarda documental `verificar-medicion-tienda.mjs`) y la corre
de verdad en el runner hosted. La medición mostró que la tienda pública descargaba el panel en el chunk de
entrada: el panel pasa a `lazy` en `apps/web/src/main.tsx`.

## Changes

| Archivo | Cambio |
|---|---|
| `.github/workflows/nightly.yml` | Job `medir`: corre en `CI_RUNS_ON_PESADO`, instala Chromium con Playwright y valida el input `productos` sin imprimirlo crudo |
| `scripts/medir-tienda-lighthouse.mjs`, `.lighthouserc.tienda.json` | Lighthouse móvil sobre las cuatro rutas; falla si no mide todo, no llega a 3 s o supera la línea base (14.000 ms) |
| `scripts/sembrar-tienda-medicion.sql`, `scripts/limpiar-tienda-medicion.sql` | Catálogo de medición idempotente, con guarda de entorno |
| `scripts/medir-tienda-catalogo.sql` | Costo de la RPC con catálogo grande, en una transacción que se revierte |
| `scripts/verificar-medicion-tienda.mjs` | Guarda de `docs:check`: la guía tiene que traer las cifras, el entorno y la fuente |
| `apps/web/src/main.tsx`, `main.guard.test.ts` | El panel se carga con `lazy` y `Suspense`; el test impide la importación estática |
| `docs/tiendas-online.md` y guías relacionadas | Cifras medidas y cómo repetirlas |

## Result

Las cifras están en la guía, con su run. El LCP bajó de 15,6–16,0 s a 10,5–10,9 s y sigue sin cumplir los 3 s: el
job `medir` queda rojo a propósito hasta que cumpla.
