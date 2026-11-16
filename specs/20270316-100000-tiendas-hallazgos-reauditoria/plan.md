# Implementation Plan: Tiendas públicas · Hallazgos de la re-auditoría (MSF-849)

**Spec**: [`spec.md`](./spec.md) · **Alcance de entrega**: `refine`.

## Enfoque técnico

- `layout/PieCategorias.tsx`: logo en `Box` blanco (radio 8, relleno 4×8) con la imagen de 36 px; `pages/empresas/tienda/componentes/imagen-tienda/ImagenTienda.tsx`: ayuda del campo.
- `whatsapp/DialogoWhatsApp.tsx` + `BotonWhatsApp.tsx`: prop `producto`; vista `aria-hidden` con `<b>` y `textarea` de solo lectura oculto visualmente (`SOLO_LECTORES`, `tabIndex=-1`).
- `layout/MenuMovil.tsx`: peso 600 en «Inicio»/«Contacto».
- `layout/FocoVisible.tsx` (`GlobalStyles` con el tema de la tienda) montado en `LayoutTienda`.
- Pruebas: `layout/tiendaDiseno.test.tsx`, `layout/MenuMovil.test.tsx`, `layout/auditoriaFidelidad.test.tsx`; medición con Playwright sobre una build local servida desde dev; axe a 390/1440.
- No se tocan `BannerHome`, `MenuCategorias`, `temaTienda` ni la identidad (MSF-848).
- Sin migraciones. Reversión: revertir los commits.
