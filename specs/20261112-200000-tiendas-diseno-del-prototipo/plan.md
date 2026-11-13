# Plan de implementación: Tiendas online · Diseño del prototipo

**Spec**: [spec.md](./spec.md) · **Alcance de entrega**: `refine`, `supabase`

## Resumen técnico

1. **Tramo A (datos)**: migraciones `20270303100000` a `20270303400000` (tipografías, `color_barra`, `eslogan`, `imagen` de categoría) y su pestaña en el panel.
2. **Tramo B (front)**: la carga de la identidad sube de la sección `TemaTienda` al layout (`layout/IdentidadTiendaContexto.tsx`): un solo fetch por host, `ProveedorTemaTienda` con la identidad completa (se extendió `IdentidadTienda` de `tema/temaTienda.ts` con `colorPrimarioOscuro`, `colorAcento` y `colorBarra` opcionales y `theme.tienda` con los derivados), variables CSS y Google Fonts. El contenido y el contacto también se leen una vez y se comparten por contexto.
3. Piezas visuales: `BarraSuperior`, encabezado con logo + «Principal», `MenuCategorias` (solo categorías), `PieCategorias` (pie oscuro), `CategoriasInicio` con foto (URL firmada con `urlsImagenesProducto`) y la sección `ConsultasInicio`.

## Decisiones

- **`BarraBienvenida`**: se conserva pero no duplica. La barra superior muestra `eslogan || bienvenida`; la franja de la portada solo se dibuja si hay eslogan y una bienvenida distinta (o en la vista previa, sin layout). Así no se pierde un mensaje configurado.
- **`PieTienda`** (texto del pie): pasa al pie oscuro del layout en todas las páginas; la sección solo queda para la vista previa.
- **Sin migración nueva**: `vista_previa_tienda` sigue sin devolver la `imagen` de categorías; la vista previa muestra el recuadro neutro (tolerado en el front).
- **Sin bloquear el pintado**: la tienda arranca con el tema base y pasa a la identidad al llegar (una petición más antes de pintar rompería los tests y la carga inicial); fuentes con `display=swap` y `preconnect`.
- **Paridad móvil**: se conserva el layout móvil de MSF-825 (menú, marca, buscador a todo el ancho); solo se suma el logo, la franja de 28 px y el pie.

## Verificación

Vitest por pieza (`layout/tiendaDiseno.test.tsx`, `TemaTienda.test.tsx`, `rutas/inicio/CategoriasInicio.test.tsx`, `rutas/inicio/ConsultasInicio.test.tsx`, `EnrutadorTienda.test.tsx`), axe a 320/768/1440 px, `tsc -b`, `oxlint`, `vite build` y los guards de `scripts/`.
