---
owner: tecnico
sources:
  - specs/20261024-120000-tienda-inicio-busqueda-movil
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

**LCP: el catálogo y la ficha ya están medidos (MSF-552); la home sigue pendiente (MSF-560).** Medición del
17/11/2026 en el CI: stack local de Supabase con el seed y 500 productos por tienda, Lighthouse 13.6 en perfil
móvil (390×844, CPU ×4, «4G lento», `throttlingMethod: devtools`), 3 corridas por ruta, objetivo LCP < 3 s.

| Pantalla | LCP (mediana) | Nota |
|---|---|---|
| Home | pendiente (MSF-560) | La home no entra en la medición de MSF-552 |
| Catálogo | 18.511 ms (Mundo JC) · 18.206 ms (San Javucho) | No cumple el objetivo de 3 s |
| Ficha | 17.783 ms (Mundo JC) · 17.378 ms (San Javucho) | No cumple el objetivo de 3 s |

El detalle (cifras por corrida, FCP, CLS, TBT, entorno y fuente) está en
[Rendimiento en celular (T071, SC-010)](./tiendas-online.md#rendimiento-en-celular-t071-sc-010). La causa medida
no es la base: el servidor responde en menos de 50 ms y el tiempo se va en descargar y ejecutar el JavaScript,
porque la primera carga pide 126 scripts y el *entry* del front es el bundle del panel (la tienda pública y el
panel se importan en el mismo *entry*, en `apps/web/src/main.tsx`). Corregirlo es un cambio de front con su
propia spec.

MSF-560 mide lo mismo sobre la demo (con el catálogo real); si sus valores difieren, la diferencia es el
entorno (demo con 2.204 productos por tienda contra el stack del CI con 500), no el objetivo.

## Notas de contradicciones para el PR

- El prototipo móvil no dibuja «Precio máximo» en el panel: se incluye igual (D5), el comportamiento manda.
- Tableta sin artboard: se reutiliza el layout existente.
