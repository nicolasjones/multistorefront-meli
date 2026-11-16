# Implementation Plan: Tiendas públicas · Fidelidad con el prototipo (MSF-847)

**Spec**: [`spec.md`](./spec.md) · **Alcance de entrega**: `refine`.

## Enfoque técnico

- **Medición**: Playwright contra los prototipos locales (`file://`, las plantillas traen el CSS real) y contra la tienda en dev; se vuelca por elemento `font`, `line-height`, color, `padding`, borde y caja, y se compara. Para validar los cambios se compila `apps/web` con las variables de dev y se sirve la build desde la misma URL de dev (Playwright intercepta `index.html` y `assets/`; la API sigue siendo la real).
- `tema/temaTienda.ts`: títulos `fontWeight 700`, `letterSpacing normal`, `lineHeight normal`; texto con `lineHeight normal`; `MuiButton` sin mayúsculas, 700 y radio 8.
- `layout/medidas.ts` (1232 px = 1200 + 2 × 16; margen de 14 px en celular), `layout/MigasTienda.tsx` (migas de prototipo con `nav` + `ol`), `layout/LayoutTienda.tsx` (color/fondo de la tienda, marca centrada y menú a la izquierda en celular), `MenuCategorias`, `BuscadorTienda`, `MenuMovil`, `PieCategorias`, `estilosPie`.
- `catalogo/TarjetaProducto.tsx`, `PrecioTachado.tsx`, `disponibilidad/EtiquetaDisponibilidad.tsx`, `catalogo/GrillaProductos.tsx` (4/3/2 columnas).
- `catalogo/PanelFiltros.tsx`, `Ordenar.tsx`, `EstadoVacio.tsx`, `PanelFiltrosMovil.tsx`, `secciones-catalogo/ListadoProductos.tsx`, `rutas/catalogo.tsx`, `rutas/categoria.tsx`.
- `secciones/BannerHome.tsx` (franja a todo el ancho: capa de 100vw con `overflow: hidden` que recorta las franjas inclinadas, más `overflow-x: clip` en el layout; sin scroll horizontal), `CategoriasInicio.tsx`, `DestacadosInicio.tsx`, `ConsultasInicio.tsx`, `TemaTienda.tsx`.
- `ficha/DatosProducto.tsx`, `Galeria.tsx`, `Relacionados.tsx`, `whatsapp/BotonWhatsApp.tsx`, `rutas/producto.tsx`; `contacto/DatosContacto.tsx`, `FormularioContacto.tsx`, `rutas/contacto.tsx`.
- Pruebas: Vitest (tarjeta, grillas, piezas compartidas, axe a 320/768/1440); E2E de `apps/web/e2e/tienda-*.e2e.ts` revisados (los locators siguen válidos; no se pueden correr aquí).
- Sin migraciones. Reversión: revertir los commits.
