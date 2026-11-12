import { Box, Typography } from '@mui/material'
import { lazy, Suspense } from 'react'
import { Link as EnlaceRuta, NavLink, Outlet, useMatch, useOutletContext } from 'react-router'
import { ContextoContactoTienda, useLeerContactoTienda } from '../../../hooks/useContactoTienda'
import { ProveedorContenidoTienda } from '../../../hooks/useContenidoPublico'
import { useCategoriasTienda, type CategoriasTienda } from '../../../hooks/useCategoriasTienda'
import type { TiendaPublica } from '../../../lib/tienda'
import { urlPublica } from '../../../lib/tiendaIdentidad'
import { AccesoCliente } from './AccesoCliente'
import { BarraSuperior } from './BarraSuperior'
import { ContextoEnLayout } from './enLayout'
import { ProveedorIdentidadTienda, useIdentidadTienda } from './IdentidadTiendaContexto'
import { MenuCategorias } from './MenuCategorias'
import { PieCategorias } from './PieCategorias'

const BuscadorTienda = lazy(() => import('./BuscadorTienda'))
const MenuMovil = lazy(() => import('./MenuMovil'))
// Medición (F-TDA-24): carga diferida; no hace nada sin IDs configurados y sin consentimiento de cookies.
const MedicionTienda = lazy(() => import('./MedicionTienda'))

// Lo que el layout comparte con cada ruta por el outlet: la tienda, su host y las categorías.
export type ContextoTienda = { tienda: TiendaPublica; host: string; categorias: CategoriasTienda }

export function useContextoTienda(): ContextoTienda {
  return useOutletContext<ContextoTienda>()
}

const estiloEnlacePrincipal = {
  color: 'inherit',
  textDecoration: 'none',
  fontSize: 15, // estilos-sueltos: ok
  fontWeight: 600,
  py: 1,
  borderBottom: 2,
  borderColor: 'transparent',
  '&:hover, &:focus-visible': { borderColor: 'divider' },
  '&[aria-current="page"]': { borderColor: 'primary.main' },
} as const

// Marca del encabezado: el logo de la tienda (a la izquierda) o, sin logo, el nombre en texto. Es el h1 solo en
// la home; en el resto de las páginas el h1 es el de la propia página.
function Marca({ tienda, enInicio }: { tienda: TiendaPublica; enInicio: boolean }) {
  const logo = urlPublica(useIdentidadTienda()?.logoRuta ?? null)
  return (
    <Typography component={enInicio ? 'h1' : 'p'} variant="h5" sx={{ fontWeight: 700, flex: { xs: 1, md: '0 0 auto' }, minWidth: 0, overflowWrap: 'anywhere' }}>
      <Box component={EnlaceRuta} to="/" sx={{ color: 'inherit', textDecoration: 'none', display: 'inline-block', py: 1 }}>
        {logo ? (
          <Box component="img" src={logo} alt={tienda.empresaNombre} sx={{ display: 'block', height: { xs: 40, md: 52 }, width: 'auto', maxWidth: '100%', objectFit: 'contain' }} />
        ) : tienda.empresaNombre}
      </Box>
    </Typography>
  )
}

function Cuerpo({ tienda, host }: { tienda: TiendaPublica; host: string }) {
  const categorias = useCategoriasTienda(host)
  const enInicio = useMatch({ path: '/', end: true }) !== null
  const contexto: ContextoTienda = { tienda, host, categorias }

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <BarraSuperior host={host} />
      <Box component="header" sx={{ bgcolor: 'background.paper', borderBottom: '1px solid rgba(0,0,0,.08)' /* estilos-sueltos: ok */ }}>
        {/* Celular: marca + botón de menú arriba y buscador a todo el ancho debajo; desde `md`, en una fila. */}
        <Box sx={{ maxWidth: 1200, mx: 'auto', px: 2, pt: { xs: 1, md: 0 }, minHeight: { md: 84 }, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 2, pb: { xs: 1.5, md: 0 } }}>
          <Marca tienda={tienda} enInicio={enInicio} />
          {/* Menú de celular (F-TDA-17, FR-040): carga diferida; el hueco evita el salto de diseño. */}
          <Suspense fallback={<Box sx={{ display: { xs: 'block', md: 'none' }, width: 48, height: (tema) => tema.spacing(6) }} aria-hidden />}>
            <MenuMovil categorias={categorias} />
          </Suspense>
          {/* Buscador (F-TDA-15, FR-024): carga diferida, no pesa en el primer pintado. */}
          <Box sx={{ order: { xs: 3, md: 0 }, flexBasis: { xs: '100%', md: 'auto' }, flexGrow: { md: 1 }, display: 'flex', justifyContent: 'center', minWidth: 0 }}>
            <Suspense fallback={<Box sx={(tema) => ({ width: { xs: '100%', md: 560 }, height: tema.spacing(5.5) })} aria-hidden />}>
              <BuscadorTienda host={host} />
            </Suspense>
          </Box>
          <Box component="nav" aria-label="Principal" sx={{ display: { xs: 'none', md: 'flex' }, gap: 3 }}>
            <Box component={NavLink} to="/" end sx={estiloEnlacePrincipal}>Inicio</Box>
            <Box component={NavLink} to="/contacto" sx={estiloEnlacePrincipal}>Contacto</Box>
          </Box>
          <AccesoCliente host={host} />
        </Box>
      </Box>
      <MenuCategorias categorias={categorias} />
      <Suspense fallback={null}>
        <MedicionTienda host={host} />
      </Suspense>
      <Box component="main" sx={{ maxWidth: 1200, width: '100%', mx: 'auto', boxSizing: 'border-box', px: 2, py: 2, flex: 1 }}>
        <Outlet context={contexto} />
      </Box>
      <PieCategorias categorias={categorias.categorias} host={host} empresaNombre={tienda.empresaNombre} />
    </Box>
  )
}

// Layout común del front público (F-TDA-11, FR-003; MSF-841): barra superior con el eslogan y el contacto, encabezado
// con la marca (logo) de la tienda, el buscador, «Inicio» / «Contacto» y el acceso «Ingresar» / «Salir» del cliente
// (F-CLI-06), la barra de categorías, el contenido de la ruta y el pie oscuro. La identidad, el contenido y el
// contacto de la tienda se leen una vez por host y llegan a todas las rutas.
export function LayoutTienda({ tienda, host }: { tienda: TiendaPublica; host: string }) {
  const contacto = useLeerContactoTienda(host)
  return (
    <ProveedorIdentidadTienda host={host}>
      <ProveedorContenidoTienda host={host}>
        <ContextoContactoTienda.Provider value={contacto}>
          <ContextoEnLayout.Provider value>
            <Cuerpo tienda={tienda} host={host} />
          </ContextoEnLayout.Provider>
        </ContextoContactoTienda.Provider>
      </ProveedorContenidoTienda>
    </ProveedorIdentidadTienda>
  )
}
