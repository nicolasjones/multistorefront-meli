import { Box } from '@mui/material'
import { useLayoutEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router'
import type { CategoriasTienda } from '../../../hooks/useCategoriasTienda'
import { categoriasPrincipales, cuantasEntran, hayMasCategorias } from '../../../lib/tiendaCategorias'
import { ErrorConReintento } from '../ErrorConReintento'

// Barra de categorías (prototipo MJC_Home): en mayúsculas, 15 px, 600, con subrayado de 3 px en la activa (color primario).
const estiloEnlace = {
  display: 'inline-block',
  whiteSpace: 'nowrap',
  py: '14px',
  px: '4px',
  color: 'text.primary',
  textDecoration: 'none',
  textTransform: 'uppercase',
  fontFamily: 'var(--tienda-fuente-titulos, inherit)',
  letterSpacing: '.04em',
  fontSize: 15, // estilos-sueltos: ok
  fontWeight: 600,
  borderBottom: 3,
  borderColor: 'transparent',
  '&:hover, &:focus-visible': { borderColor: 'divider' },
  '&[aria-current="page"]': { borderColor: 'primary.main' },
} as const

const GAP = 28
// El texto de la copia de medida va en un pseudo-elemento: no es texto del DOM (no lo ven lectores de pantalla ni búsquedas por texto).
const estiloCopia = { ...estiloEnlace, '&::before': { content: 'attr(data-nombre)' } } as const

// Una sola línea sin cortes (MSF-846): con una tipografía ancha (p. ej. Bricolage Grotesque en San Javucho a 1440 px)
// las 6 principales + «Más categorías» no entran; se mide el ancho real de cada entrada (en una copia oculta, para
// no depender de lo que ya se recortó) y se muestran solo las que entran; el resto se alcanza desde «Más categorías».
// Se vuelve a medir al cambiar el ancho de la barra o de la copia (carga de la fuente). Sin ResizeObserver
// (navegadores viejos, tests) se muestran todas y la barra desplaza en horizontal.
function useEntradasVisibles(total: number, hayMas: boolean) {
  const lista = useRef<HTMLUListElement | null>(null)
  const medida = useRef<HTMLUListElement | null>(null)
  const [visibles, setVisibles] = useState<number | null>(null)
  useLayoutEffect(() => {
    const ul = lista.current
    const copia = medida.current
    if (!ul || !copia || typeof ResizeObserver === 'undefined') return undefined
    const medir = () => {
      const anchos = Array.from(copia.children).map((nodo) => nodo.getBoundingClientRect().width)
      const anchoMas = anchos.pop() ?? 0
      setVisibles(cuantasEntran(anchos, anchoMas, GAP, ul.getBoundingClientRect().width, hayMas))
    }
    medir()
    const observador = new ResizeObserver(medir)
    observador.observe(ul)
    observador.observe(copia)
    return () => observador.disconnect()
  }, [total, hayMas])
  return { lista, medida, visibles: visibles === null ? total : Math.min(visibles, total) }
}

// Barra de categorías del encabezado (F-TDA-11, FR-004/FR-008): una entrada por categoría principal y «Más categorías».
// «Inicio» y «Contacto» (F-TDA-16, FR-010) viven en la fila de la marca (MSF-841, como el prototipo). Es una lista de
// enlaces (teclado nativo); NavLink marca con aria-current la ruta actual. Sin categorías no hay barra; si la
// lectura falla, un aviso con «Reintentar». Desde celular (< md) lo reemplaza `MenuMovil` (F-TDA-17, FR-040).
// MSF-825 (MSF-826): en UNA línea, con las categorías principales de la tienda (las de mayor cantidad, hasta 6;
// la tienda oculta las que no quiere desde su configuración) y «Más categorías» hacia el catálogo con el resto;
// ya no se listan las ~190 de la base.
export function MenuCategorias({ categorias }: { categorias: CategoriasTienda }) {
  const principales = categoriasPrincipales(categorias.categorias)
  const hayMas = hayMasCategorias(categorias.categorias, principales)
  const { lista, medida, visibles } = useEntradasVisibles(principales.length, hayMas)
  // Sin ResizeObserver no se puede medir: se muestran todas y la barra desplaza en horizontal en vez de recortar.
  const hayObservador = typeof ResizeObserver !== 'undefined'
  if (categorias.fase === 'lista' && principales.length === 0) return null
  const mostradas = principales.slice(0, visibles)
  return (
    <Box sx={{ display: { xs: 'none', md: 'block' }, bgcolor: 'background.paper', borderBottom: '1px solid rgba(0,0,0,.08)' /* estilos-sueltos: ok */ }}>
      <Box component="nav" aria-label="Categorías" aria-busy={categorias.fase === 'cargando'} sx={{ position: 'relative', maxWidth: 1200, mx: 'auto', px: 2, minHeight: 52 /* estilos-sueltos: ok */ }}>
        {/* Copia invisible para medir cada entrada (no se lee ni se enfoca). Va dentro de un contenedor recortado
            (overflow:hidden, del tamaño de la barra): una lista `position:absolute` con `width:max-content` fuera de él
            ensancha el scroll horizontal de toda la página. Los anchos de los hijos se siguen midiendo igual. */}
        <Box aria-hidden sx={{ position: 'absolute', inset: 0, overflow: 'hidden', visibility: 'hidden', pointerEvents: 'none' }}>
          <Box component="ul" ref={medida} sx={{ display: 'flex', flexWrap: 'nowrap', gap: `${GAP}px`, listStyle: 'none', m: 0, p: 0, width: 'max-content' }}>
            {principales.map((categoria) => <li key={categoria.id}><Box component="span" data-nombre={categoria.nombre} sx={estiloCopia} /></li>)}
            <li><Box component="span" data-nombre="Más categorías" sx={estiloCopia} /></li>
          </Box>
        </Box>
        <Box component="ul" ref={lista} data-testid="menu-categorias-lista" sx={{ display: 'flex', flexWrap: 'nowrap', overflowX: hayObservador ? 'hidden' : 'auto', overflowY: 'hidden', gap: `${GAP}px`, listStyle: 'none', m: 0, p: 0, alignItems: 'center' }}>
          {mostradas.map((categoria) => (
            <li key={categoria.id}>
              <Box component={NavLink} to={`/categoria/${categoria.id}`} sx={estiloEnlace}>{categoria.nombre}</Box>
            </li>
          ))}
          {hayMas || mostradas.length < principales.length ? (
            <li><Box component={NavLink} to="/catalogo" end sx={estiloEnlace}>Más categorías</Box></li>
          ) : null}
          {categorias.fase === 'error' && (
            <li>
              <ErrorConReintento titulo="No pudimos cargar las categorías." alReintentar={categorias.reintentar} />
            </li>
          )}
        </Box>
      </Box>
    </Box>
  )
}
