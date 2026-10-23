import { useState } from 'react'
import { Box, ButtonBase, Typography } from '@mui/material'
import type { ImagenFicha } from '../../../lib/tiendaFicha'
import { Ampliacion } from './Ampliacion'

const MAX_MINIATURAS = 4

// Galería de la ficha (F-TDA-13, FR-052/FR-053): la imagen principal es la de menor posición, hasta 4
// miniaturas con la seleccionada marcada (botones: cambian por clic, Enter o Espacio) y la principal
// se amplía en un diálogo. Una imagen sin URL (vencida, sin permiso o que falla al cargar) cuenta como
// ausente; sin ninguna, «Sin imagen».
export function Galeria({ imagenes, urls, nombre }: { imagenes: ImagenFicha[]; urls: Record<string, string>; nombre: string }) {
  const [elegida, setElegida] = useState(0)
  const [ampliada, setAmpliada] = useState(false)
  const [fallidas, setFallidas] = useState<string[]>([])

  const disponibles = imagenes
    .slice(0, MAX_MINIATURAS)
    .flatMap((i) => (urls[i.ruta] && !fallidas.includes(urls[i.ruta]) ? [{ ...i, url: urls[i.ruta] }] : []))
  const marcarFallida = (url: string) => setFallidas((previas) => [...previas, url])

  if (disponibles.length === 0) {
    return (
      <Box
        data-testid="galeria-sin-imagen"
        sx={{ aspectRatio: '1 / 1', bgcolor: 'action.hover', borderRadius: (tema) => `${tema.shape.borderRadius}px`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <Typography color="text.secondary">Sin imagen</Typography>
      </Box>
    )
  }

  const actual = disponibles[Math.min(elegida, disponibles.length - 1)]
  return (
    <Box data-testid="galeria">
      <ButtonBase
        onClick={() => setAmpliada(true)}
        aria-label="Ampliar imagen"
        sx={{ display: 'block', width: '100%', aspectRatio: '1 / 1', bgcolor: 'action.hover', borderRadius: (tema) => `${tema.shape.borderRadius}px`, overflow: 'hidden' }}
      >
        <Box component="img" src={actual.url} alt={nombre} onError={() => marcarFallida(actual.url)} sx={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      </ButtonBase>
      {disponibles.length > 1 ? (
        <Box role="group" aria-label="Miniaturas" sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
          {disponibles.map((imagen, indice) => (
            <ButtonBase
              key={imagen.posicion}
              onClick={() => setElegida(indice)}
              aria-label={`Ver imagen ${indice + 1} de ${disponibles.length}`}
              aria-pressed={imagen === actual}
              data-testid="miniatura"
              sx={{
                width: 72, height: 72, overflow: 'hidden', bgcolor: 'action.hover', border: 2, borderRadius: (tema) => `${tema.shape.borderRadius}px`,
                borderColor: imagen === actual ? 'text.primary' : 'divider',
              }}
            >
              <Box component="img" src={imagen.url} alt="" loading="lazy" onError={() => marcarFallida(imagen.url)} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </ButtonBase>
          ))}
        </Box>
      ) : null}
      <Ampliacion abierta={ampliada} url={actual.url} nombre={nombre} onCerrar={() => setAmpliada(false)} />
    </Box>
  )
}
