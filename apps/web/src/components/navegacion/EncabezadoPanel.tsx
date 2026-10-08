import { AppBar, Box, Toolbar } from '@mui/material'
import { HamburgerMenu } from '@refinedev/mui'
import { MenuCuenta } from './MenuCuenta'

// Header propio del panel (pedido en vivo): el menú de cuenta pasa del pie
// del sider a la esquina superior derecha, fijo arriba de todo — patrón
// estándar de panel administrativo, visible sin depender de qué sección
// del sider esté abierta o colapsada. Mismo AppBar/Toolbar que el
// ThemedHeader por defecto de Refine (incluido HamburgerMenu para
// colapsar/expandir el sider), solo que a la derecha va MenuCuenta en vez
// del nombre/avatar genérico de useGetIdentity.
export function EncabezadoPanel() {
  return (
    <AppBar position="sticky">
      <Toolbar>
        <HamburgerMenu />
        <Box sx={{ flexGrow: 1 }} />
        <MenuCuenta />
      </Toolbar>
    </AppBar>
  )
}
