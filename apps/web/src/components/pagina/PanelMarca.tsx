import { Box, Stack, Typography } from '@mui/material'
import { tokens } from '../../tema/tokens'

const { color, tipografia, forma } = tokens

const TIENDAS = ['San Javucho', 'Mundo JC', '+ futuras stores']

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
          Un catálogo. Varias tiendas. Un solo panel.
        </Typography>
        <Typography sx={{ mt: 2, fontSize: tipografia.escala.bl.tamano, lineHeight: 1.55, color: color.sider.itemTexto, maxWidth: 400 }}>
          Productos, stock, stores, Mercado Libre y rentabilidad, en un mismo lugar.
        </Typography>
        <Stack direction="row" spacing={1.25} useFlexGap flexWrap="wrap" sx={{ mt: 3.5 }}>
          {TIENDAS.map((nombre) => (
            <Box
              key={nombre}
              component="span"
              sx={{
                bgcolor: color.sider.itemHover,
                color: color.sider.itemTextoActivo,
                borderRadius: `${forma.radioEtiqueta}px`,
                px: 1.75,
                py: 0.75,
                display: 'inline-flex',
                alignItems: 'center',
                fontSize: tipografia.escala.s.tamano,
                fontWeight: 600,
              }}
            >
              {nombre}
            </Box>
          ))}
        </Stack>
      </Box>
      <Typography sx={{ color: color.sider.label, fontSize: tipografia.escala.xs.tamano }}>© 2026 · Panel interno</Typography>
    </Box>
  )
}
