import { useState } from 'react'
import { Box, Paper, Popper } from '@mui/material'
import { tokens } from '../../tema/tokens'

type MiniaturaProductoProps = { alt: string; src?: string | null }

// Lado de la imagen ampliada al pasar el mouse (o enfocar con el teclado) sobre la miniatura.
const LADO_ZOOM = 280

// Miniatura de producto (.thumb, FR-005): 40×40, radio 8, borde #EEEDE8 y
// fondo suave cuando no hay imagen. Presentacional: no agrega datos.
// Con imagen, al pasar el mouse se muestra una vista ampliada flotante (no cambia el tamaño de la fila).
export function MiniaturaProducto({ alt, src }: MiniaturaProductoProps) {
  const [ancla, setAncla] = useState<HTMLElement | null>(null)
  // Imagen que no pudo cargarse (p. ej. URL firmada vencida): se muestra el recuadro vacío en vez de una imagen rota.
  const [fallida, setFallida] = useState<string | null>(null)
  const medidas = {
    width: tokens.forma.ladoMiniatura,
    height: tokens.forma.ladoMiniatura,
    borderRadius: `${tokens.forma.radioMiniatura}px`,
    border: `1px solid ${tokens.color.fondoAlterno}`,
    flexShrink: 0,
  } as const

  if (!src || fallida === src) {
    return <Box aria-hidden="true" sx={{ ...medidas, bgcolor: tokens.color.fondo }} />
  }

  return (
    <>
      <Box
        component="img"
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setFallida(src)}
        onMouseEnter={(evento: React.MouseEvent<HTMLElement>) => setAncla(evento.currentTarget)}
        onMouseLeave={() => setAncla(null)}
        sx={{ ...medidas, bgcolor: tokens.color.superficie, objectFit: 'contain', display: 'block', cursor: 'zoom-in' }}
      />
      <Popper
        open={ancla !== null}
        anchorEl={ancla}
        placement="right-start"
        modifiers={[{ name: 'flip', options: { fallbackPlacements: ['left-start', 'bottom-start', 'top-start'] } }, { name: 'offset', options: { offset: [0, 8] } }]}
        sx={{ zIndex: (tema) => tema.zIndex.tooltip, pointerEvents: 'none' }}
      >
        <Paper elevation={8} sx={{ p: 0.5, borderRadius: `${tokens.forma.radioMiniatura}px`, bgcolor: tokens.color.superficie }}>
          <Box
            component="img"
            src={src}
            alt=""
            aria-hidden="true"
            sx={{ display: 'block', width: LADO_ZOOM, height: LADO_ZOOM, objectFit: 'contain', borderRadius: `${tokens.forma.radioMiniatura}px` }}
          />
        </Paper>
      </Popper>
    </>
  )
}
