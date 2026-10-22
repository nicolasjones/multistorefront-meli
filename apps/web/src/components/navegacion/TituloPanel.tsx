import { Box, Typography } from '@mui/material'
import { tokens } from '../../tema/tokens'

const { color, tipografia, forma } = tokens

// Marca del panel en la barra lateral, como el prototipo (AdminSider): logo
// «GC» y «Gestión comercial». Colapsada queda solo el logo.
export function TituloPanel({ collapsed }: { collapsed?: boolean }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1.5,
        minHeight: forma.altoHeader,
        color: color.superficie,
      }}
    >
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
          flexShrink: 0,
        }}
      >
        GC
      </Box>
      {!collapsed && (
        <Typography noWrap sx={{ fontFamily: tipografia.titulos, fontWeight: 600, fontSize: tipografia.escala.bl.tamano }}>
          Gestión comercial
        </Typography>
      )}
    </Box>
  )
}
