import { Box } from '@mui/material'
import { tokens } from '../../tema/tokens'

type MiniaturaProductoProps = { alt: string; src?: string | null }

// Miniatura de producto (.thumb, FR-005): 40×40, radio 8, borde #EEEDE8 y
// fondo suave cuando no hay imagen. Presentacional: no agrega datos.
export function MiniaturaProducto({ alt, src }: MiniaturaProductoProps) {
  const medidas = {
    width: tokens.forma.ladoMiniatura,
    height: tokens.forma.ladoMiniatura,
    borderRadius: `${tokens.forma.radioMiniatura}px`,
    border: `1px solid ${tokens.color.fondoAlterno}`,
    flexShrink: 0,
  } as const

  if (!src) {
    return <Box aria-hidden="true" sx={{ ...medidas, bgcolor: tokens.color.fondo }} />
  }

  return (
    <Box
      component="img"
      src={src}
      alt={alt}
      sx={{ ...medidas, bgcolor: tokens.color.superficie, objectFit: 'contain', display: 'block' }}
    />
  )
}
