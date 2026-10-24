import { Box, Typography } from '@mui/material'
import { lazy, Suspense } from 'react'
import { Link as EnlaceRuta, Outlet, useMatch, useOutletContext } from 'react-router'
import { useCategoriasTienda, type CategoriasTienda } from '../../../hooks/useCategoriasTienda'
import type { TiendaPublica } from '../../../lib/tienda'
import { MenuCategorias } from './MenuCategorias'
import { PieCategorias } from './PieCategorias'

const BuscadorTienda = lazy(() => import('./BuscadorTienda'))
const MenuMovil = lazy(() => import('./MenuMovil'))

// Lo que el layout comparte con cada ruta por el outlet: la tienda, su host y las categorías.
export type ContextoTienda = { tienda: TiendaPublica; host: string; categorias: CategoriasTienda }

export function useContextoTienda(): ContextoTienda {
  return useOutletContext<ContextoTienda>()
}

// Layout común del front público (F-TDA-11, FR-003): encabezado con la marca de la tienda y el menú de
// categorías, el contenido de la ruta y el pie con la columna «Categorías». La marca es el h1 solo en
// la home; en el resto de las páginas el h1 es el de la propia página.
export function LayoutTienda({ tienda, host }: { tienda: TiendaPublica; host: string }) {
  const categorias = useCategoriasTienda(host)
  const enInicio = useMatch({ path: '/', end: true }) !== null
  const contexto: ContextoTienda = { tienda, host, categorias }

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Box component="header" sx={{ px: 2, pt: 2, borderBottom: 1, borderColor: 'divider' }}>
        {/* Celular: marca + botón de menú arriba y buscador a todo el ancho debajo; desde `md`, en una fila. */}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, pb: { xs: 1.5, md: 0 } }}>
          <Typography component={enInicio ? 'h1' : 'p'} variant="h5" sx={{ fontWeight: 700, flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
            <Box component={EnlaceRuta} to="/" sx={{ color: 'inherit', textDecoration: 'none', display: 'inline-block', py: 1 }}>{tienda.empresaNombre}</Box>
          </Typography>
          {/* Menú de celular (F-TDA-17, FR-040): carga diferida; el hueco evita el salto de diseño. */}
          <Suspense fallback={<Box sx={{ display: { xs: 'block', md: 'none' }, width: 48, height: 48 }} aria-hidden />}>
            <MenuMovil categorias={categorias} />
          </Suspense>
          {/* Buscador (F-TDA-15, FR-024): carga diferida, no pesa en el primer pintado. */}
          <Box sx={{ order: { xs: 3, md: 0 }, flexBasis: { xs: '100%', md: 'auto' }, minWidth: 0 }}>
            <Suspense fallback={<Box sx={(tema) => ({ width: { xs: '100%', sm: tema.spacing(45) }, height: tema.spacing(5) })} aria-hidden />}>
              <BuscadorTienda host={host} />
            </Suspense>
          </Box>
        </Box>
        <MenuCategorias categorias={categorias} />
      </Box>
      <Box component="main" sx={{ px: 2, py: 2, flex: 1 }}>
        <Outlet context={contexto} />
      </Box>
      <Box component="footer" sx={{ px: 2, py: 3, borderTop: 1, borderColor: 'divider' }}>
        <PieCategorias categorias={categorias.categorias} />
      </Box>
    </Box>
  )
}
