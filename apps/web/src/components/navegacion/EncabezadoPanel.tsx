import { AppBar, Box, Toolbar } from '@mui/material'
import { HamburgerMenu } from '@refinedev/mui'
import { MenuCuenta } from './MenuCuenta'
import { SelectorEmpresa } from './SelectorEmpresa'
import { tokens } from '../../tema/tokens'

// Header propio del panel (pedido en vivo): el menú de cuenta pasa del pie
// del sider a la esquina superior derecha, fijo arriba de todo — patrón
// estándar de panel administrativo, visible sin depender de qué sección
// del sider esté abierta o colapsada. Mismo AppBar/Toolbar que el
// ThemedHeader por defecto de Refine (incluido HamburgerMenu para
// colapsar/expandir el sider), solo que a la derecha va MenuCuenta en vez
// del nombre/avatar genérico de useGetIdentity.
export function EncabezadoPanel() {
  return (
    <AppBar position="sticky" color="inherit" elevation={0} sx={{ bgcolor: 'background.paper', color: 'text.primary', borderBottom: `1px solid ${tokens.color.borde}` }}>
      <Toolbar sx={{ gap: 2 }}>
        <HamburgerMenu />
        <SelectorEmpresa />
        <Box sx={{ flexGrow: 1 }} />
        <MenuCuenta />
      </Toolbar>
    </AppBar>
  )
}
