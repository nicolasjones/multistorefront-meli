import { Box, Stack, Typography } from '@mui/material'
import { tokens } from '../../tema/tokens'

const { color, tipografia, forma } = tokens

// Panel de marca del prototipo (Login / DefinirContrasena / RecuperarContrasena):
// oscuro, a la izquierda y oculto en pantallas angostas. Sólo presentación.
export function PanelMarca() {
  return (
    <Box
      sx={{
        display: { xs: 'none', md: 'flex' },
        flexDirection: 'column',
        justifyContent: 'space-between',
        width: 560,
        flexShrink: 0,
        bgcolor: color.sider.fondo,
        color: color.superficie,
        p: 6,
      }}
    >
      <Stack direction="row" spacing={1.25} alignItems="center">
        <Box
          sx={{
            width: forma.anchoIconButton,
            height: forma.altoIconButton,
            borderRadius: `${forma.radioMenu}px`,
            bgcolor: color.accion,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: tipografia.titulos,
            fontWeight: 700,
          }}
        >
          GC
        </Box>
        <Typography sx={{ fontFamily: tipografia.titulos, fontWeight: 600, fontSize: tipografia.escala.bl.tamano }}>
          Gestión comercial
        </Typography>
      </Stack>
      <Box>
        <Typography
          component="h2"
          sx={{
            fontFamily: tipografia.titulos,
            fontSize: tipografia.escala.hero.tamano,
            fontWeight: tipografia.escala.hero.peso,
            lineHeight: tipografia.escala.hero.interlineado,
            letterSpacing: tipografia.escala.hero.espaciado,
            maxWidth: 420,
          }}
        >
          Ingresá a tu panel
        </Typography>
        <Typography sx={{ mt: 2, fontSize: tipografia.escala.bl.tamano, lineHeight: 1.55, color: color.sider.itemTexto, maxWidth: 400 }}>
          Productos, stock, stores, Mercado Libre y rentabilidad, en un mismo lugar.
        </Typography>
      </Box>
      <Typography sx={{ color: color.sider.label, fontSize: tipografia.escala.xs.tamano }}>© 2026 · Gestión comercial</Typography>
    </Box>
  )
}
