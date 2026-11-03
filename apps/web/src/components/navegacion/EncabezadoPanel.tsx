import { AppBar, Box, Toolbar, Typography } from '@mui/material'
import { HamburgerMenu } from '@refinedev/mui'
import { useLocation } from 'react-router'
import { BusquedaGlobal } from './BusquedaGlobal'
import { MenuCuenta } from './MenuCuenta'
import { SelectorEmpresa } from './SelectorEmpresa'
import { SelectorEmpresaActiva } from './SelectorEmpresaActiva'
import { SECCIONES_PANEL } from './destinosPanel'
import { tokens } from '../../tema/tokens'

// Migas de pan (.s, FR-009): se derivan del destino activo del sider, así no
// duplican rutas ni etiquetas.
function MigasPanel() {
  const { pathname } = useLocation()
  const coincide = (ruta: string) => ruta === pathname || (ruta !== '/' && pathname.startsWith(ruta))
  const seccion = SECCIONES_PANEL.find((candidata) => candidata.destinos.some((destino) => coincide(destino.ruta)))
  const destino = seccion?.destinos.find((candidato) => coincide(candidato.ruta))

  if (!destino) {
    return null
  }

  return (
    <Typography component="nav" aria-label="Ubicación" variant="s" noWrap>
      {seccion?.etiqueta ? `${seccion.etiqueta} · ` : ''}{destino.etiqueta}
    </Typography>
  )
}

// Header propio del panel (pedido en vivo): el menú de cuenta pasa del pie
// del sider a la esquina superior derecha, fijo arriba de todo — patrón
// estándar de panel administrativo, visible sin depender de qué sección
// del sider esté abierta o colapsada. Mismo AppBar/Toolbar que el
// ThemedHeader por defecto de Refine (incluido HamburgerMenu para
// colapsar/expandir el sider), solo que a la derecha va MenuCuenta en vez
// del nombre/avatar genérico de useGetIdentity.
export function EncabezadoPanel() {
  return (
    <AppBar position="sticky" color="inherit" elevation={0} sx={{ bgcolor: 'background.paper', color: 'text.primary', borderBottom: `1px solid ${tokens.color.bordeSuave}` }}>
      <Toolbar sx={{ gap: 2, flexWrap: 'wrap', minHeight: { xs: 56, sm: tokens.forma.altoHeader } }}>
        <HamburgerMenu />
        <SelectorEmpresa />
        <SelectorEmpresaActiva />
        <MigasPanel />
        <Box sx={{ flexGrow: 1 }} />
        <BusquedaGlobal />
        <MenuCuenta />
      </Toolbar>
    </AppBar>
  )
}
