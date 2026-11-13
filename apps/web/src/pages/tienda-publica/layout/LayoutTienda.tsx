import { Box, Typography } from '@mui/material'
import { lazy, Suspense } from 'react'
import { Link as EnlaceRuta, NavLink, Outlet, useMatch, useOutletContext } from 'react-router'
import { ContextoContactoTienda, useLeerContactoTienda } from '../../../hooks/useContactoTienda'
import { ProveedorContenidoTienda, useContenidoPublico } from '../../../hooks/useContenidoPublico'
import { ContextoCategoriasTienda, useLeerCategoriasTienda, type CategoriasTienda } from '../../../hooks/useCategoriasTienda'
import type { TiendaPublica } from '../../../lib/tienda'
import { urlPublica } from '../../../lib/tiendaIdentidad'
import { AccesoCliente } from './AccesoCliente'
import { BarraSuperior } from './BarraSuperior'
import { ContextoEnLayout } from './enLayout'
import { ProveedorIdentidadTienda, useIdentidadTienda } from './IdentidadTiendaContexto'
import { MenuCategorias } from './MenuCategorias'
import { PieCategorias } from './PieCategorias'
import { ANCHO_MAXIMO_TIENDA, LINEA_SUAVE, MARGEN_LATERAL_TIENDA } from './medidas'

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
    <Typography component={enInicio ? 'h1' : 'p'} variant="h5" sx={{ fontWeight: 700, lineHeight: 0, m: 0, order: { xs: 1, md: 0 }, flex: { xs: 1, md: '0 0 auto' }, minWidth: 0, overflowWrap: 'anywhere', display: 'flex', justifyContent: { xs: 'center', md: 'flex-start' } }}>
      <Box component={EnlaceRuta} to="/" sx={{ color: 'inherit', textDecoration: 'none', display: 'flex', lineHeight: 'normal', py: { xs: '10px', md: 1 } /* estilos-sueltos: ok */ }}>
        {logo ? (
          <Box component="img" src={logo} alt={tienda.empresaNombre} sx={{ display: 'block', height: { xs: 40, md: 52 }, width: 'auto', maxWidth: '100%', objectFit: 'contain' }} />
        ) : tienda.empresaNombre}
      </Box>
    </Typography>
  )
}

function Cuerpo({ tienda, host, categorias }: { tienda: TiendaPublica; host: string; categorias: CategoriasTienda }) {
  // El h1 de la portada es el título del héroe (prototipo); sin título de héroe lo conserva la marca (un solo h1 por página).
  const tituloHeroe = useContenidoPublico(host)?.titulo.trim()
  const enInicio = useMatch({ path: '/', end: true }) !== null && !tituloHeroe
  const contexto: ContextoTienda = { tienda, host, categorias }

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', color: 'text.primary', bgcolor: 'background.default', overflowX: 'clip' /* la franja del héroe y el bloque de consultas llegan al borde de la ventana sin ensanchar la página */ }}>
      {/* La barra superior va dentro del <header> (landmark banner): sin esto queda fuera de todo landmark (axe «region»). */}
      <Box component="header" sx={{ bgcolor: 'background.paper', borderBottom: LINEA_SUAVE /* estilos-sueltos: ok */ }}>
        <BarraSuperior host={host} />
        {/* Celular: marca + botón de menú arriba y buscador a todo el ancho debajo; desde `md`, en una fila. */}
        <Box sx={{ maxWidth: ANCHO_MAXIMO_TIENDA, mx: 'auto', px: MARGEN_LATERAL_TIENDA, pt: 0, minHeight: { xs: 60, md: 84 }, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 2, rowGap: 0, pb: 0 /* estilos-sueltos: ok */ }}>
          {/* Menú de celular (F-TDA-17, FR-040): carga diferida; el hueco evita el salto de diseño. En celular va a la IZQUIERDA y
              la marca centrada (prototipo `MJC_M_Home`); el menú va primero también en el DOM (la tabulación sigue el orden
              visual: menú, marca, buscador, «Ingresar»; solo «Ingresar» se ve antes que el buscador). */}
          <Box sx={{ order: 0, display: { xs: 'block', md: 'none' } }}>
            <Suspense fallback={<Box sx={{ width: 48, height: (tema) => tema.spacing(6) }} aria-hidden />}>
              <MenuMovil categorias={categorias} empresaNombre={tienda.empresaNombre} host={host} />
            </Suspense>
          </Box>
          <Marca tienda={tienda} enInicio={enInicio} />
          {/* Buscador (F-TDA-15, FR-024): carga diferida, no pesa en el primer pintado. En celular, en su propia fila de 12 px de aire. */}
          <Box sx={{ order: { xs: 3, md: 0 }, flexBasis: { xs: '100%', md: 'auto' }, flexGrow: { md: 1 }, flexShrink: { md: 1 }, display: 'flex', justifyContent: 'center', minWidth: 0, py: { xs: '12px', md: 0 } /* estilos-sueltos: ok */ }}>
            <Suspense fallback={<Box sx={(tema) => ({ width: { xs: '100%', md: '100%' }, maxWidth: 560, height: tema.spacing(5.5) })} aria-hidden />}>
              <BuscadorTienda host={host} />
            </Suspense>
          </Box>
          <Box component="nav" aria-label="Principal" sx={{ display: { xs: 'none', md: 'flex' }, gap: 3 }}>
            <Box component={NavLink} to="/" end sx={estiloEnlacePrincipal}>Inicio</Box>
            <Box component={NavLink} to="/contacto" sx={estiloEnlacePrincipal}>Contacto</Box>
          </Box>
          <Box sx={{ order: { xs: 2, md: 0 }, display: 'flex' }}>
            <AccesoCliente host={host} />
          </Box>
        </Box>
      </Box>
      <MenuCategorias categorias={categorias} />
      <Suspense fallback={null}>
        <MedicionTienda host={host} />
      </Suspense>
      <Box component="main" sx={{ maxWidth: ANCHO_MAXIMO_TIENDA, width: '100%', mx: 'auto', boxSizing: 'border-box', px: MARGEN_LATERAL_TIENDA, py: 0, flex: 1 }}>
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
  const categorias = useLeerCategoriasTienda(host)
  return (
    <ProveedorIdentidadTienda host={host}>
      <ProveedorContenidoTienda host={host}>
        <ContextoContactoTienda.Provider value={contacto}>
          <ContextoCategoriasTienda.Provider value={categorias}>
            <ContextoEnLayout.Provider value>
              <Cuerpo tienda={tienda} host={host} categorias={categorias} />
            </ContextoEnLayout.Provider>
          </ContextoCategoriasTienda.Provider>
        </ContextoContactoTienda.Provider>
      </ProveedorContenidoTienda>
    </ProveedorIdentidadTienda>
  )
}
