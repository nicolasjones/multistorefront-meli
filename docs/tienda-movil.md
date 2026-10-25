---
owner: producto
sources: [specs]
---
# Tienda pública · versión móvil (F-TDA-17)

Spec: `specs/20261024-120000-tienda-inicio-busqueda-movil/` (US3, FR-040…FR-048, SC-007…SC-009).

## Tamaños verificados

360, 390, 412 y 430 px (celular) y 768 y 1024 px (tableta). El corte entre «móvil» y «escritorio» es `md` (900 px,
`useCelular` en `pages/tienda-publica/useAnchoCelular.ts`): por debajo rigen el menú y el panel de filtros móviles;
desde ahí, el menú horizontal y la columna lateral de MSF-167. En tableta no hay diseño nuevo (contradicción 3 de la spec).
Verificación: `apps/web/e2e/tienda-movil.e2e.ts` (sin scroll horizontal en home, catálogo, categoría, resultados, ficha,
404 y «Volvemos pronto», sobre las dos tiendas del seed).

## Componentes móviles

| Componente | Qué hace |
|---|---|
| `layout/MenuMovil.tsx` (carga diferida) | Botón de menú + `Drawer` con «Inicio» y «Categorías» (actual con `aria-current`). Cierra con botón, Esc, fuera o navegar. Foco atrapado y devuelto. |
| `catalogo/PanelFiltrosMovil.tsx` (carga diferida) | Botón «Filtrar · N» y panel «Filtros» (Limpiar, Categoría, Solo con stock, Precio máximo, Ordenar, «Ver N productos»). Mismo estado en la URL que escritorio; vive fuera de la rama «lista» para no desmontarse al recargar. |
| `ErrorConReintento.tsx` | Error de red con «Reintentar»; repite el pedido sin tocar URL ni filtros. Lo usan home, catálogo, categoría, resultados, ficha y menús. |
| Ficha | Una columna, enlace «← Todos los productos» arriba, miniaturas táctiles, ampliación a pantalla completa bajo 600 px. Sin WhatsApp (MSF-212). |

## Contacto

La página de Contacto (MSF-212) todavía no existe: el menú móvil **no** incluye la entrada (D10) y no se construye acá.
La comprobación móvil de Contacto queda como verificación pendiente de esa épica.

## Rendimiento (SC-009, FR-047)

Hecho: menú y panel móviles con carga diferida, `loading="lazy"` en tarjetas y miniaturas (la imagen principal de la
ficha no, es el LCP), sin pedidos extra por pantalla.

**LCP medido: pendiente.** El entorno de la historia no tenía Docker (sin stack local) ni Lighthouse. La medición
(Lighthouse móvil, `--throttling-method=devtools`, CPU ×4, «4G lento», LCP < 3 s en home, catálogo y ficha) queda
trazada en el seguimiento MSF-560; al medirla se anotan acá los valores.

| Pantalla | LCP |
|---|---|
| Home | sin medir (MSF-560) |
| Catálogo | sin medir (MSF-560) |
| Ficha | sin medir (MSF-560) |

## Notas de contradicciones para el PR

- El prototipo móvil no dibuja «Precio máximo» en el panel: se incluye igual (D5), el comportamiento manda.
- Tableta sin artboard: se reutiliza el layout existente.
