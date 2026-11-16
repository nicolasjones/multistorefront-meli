import { useState } from 'react'
import { Box, ButtonBase, Typography, type Theme } from '@mui/material'
import type { ImagenFicha } from '../../../lib/tiendaFicha'
import { Ampliacion } from './Ampliacion'

const MAX_MINIATURAS = 4

// Marco de la imagen principal (prototipo `MJC_Producto`): cuadrado de ancho completo (600 px a escritorio) y 390 px de alto en
// celular, fondo de superficie y radio de 12 px. La imagen se ve completa (`contain`, hasta el 88 %).
const estiloMarco = (tema: Theme) => ({
  width: '100%', height: { xs: 390, md: 'auto' }, aspectRatio: { md: '1 / 1' }, bgcolor: tema.tienda?.superficie ?? tema.palette.action.hover, borderRadius: '12px', overflow: 'hidden', // estilos-sueltos: ok
})

// Galería de la ficha (F-TDA-13, FR-052/FR-053): la imagen principal es la de menor posición, hasta 4
// miniaturas con la seleccionada marcada (botones: cambian por clic, Enter o Espacio) y la principal
// se amplía en un diálogo. Una imagen sin URL (vencida, sin permiso o que falla al cargar) cuenta como
// ausente; sin ninguna, «Sin imagen».
export function Galeria({ imagenes, urls, nombre }: { imagenes: ImagenFicha[]; urls: Record<string, string>; nombre: string }) {
  const [elegida, setElegida] = useState(0)
  const [ampliada, setAmpliada] = useState(false)
  const [fallidas, setFallidas] = useState<string[]>([])

  const disponibles = imagenes
    .flatMap((i) => (urls[i.ruta] && !fallidas.includes(urls[i.ruta]) ? [{ ...i, url: urls[i.ruta] }] : []))
    .slice(0, MAX_MINIATURAS)
  const marcarFallida = (url: string) => setFallidas((previas) => [...previas, url])

  if (disponibles.length === 0) {
    return (
      <Box
        data-testid="galeria-sin-imagen"
        sx={(tema) => ({ ...estiloMarco(tema), display: 'flex', alignItems: 'center', justifyContent: 'center' })}
      >
        <Typography sx={{ color: 'text.secondary', fontSize: 13 /* estilos-sueltos: ok */ }}>Sin imagen</Typography>
      </Box>
    )
  }

  const actual = disponibles[Math.min(elegida, disponibles.length - 1)]
  return (
    <Box data-testid="galeria">
      <ButtonBase
        onClick={() => setAmpliada(true)}
        aria-label="Ampliar imagen"
        sx={(tema) => ({ ...estiloMarco(tema), display: 'flex', alignItems: 'center', justifyContent: 'center' })}
      >
        <Box component="img" src={actual.url} alt={nombre} onError={() => marcarFallida(actual.url)} sx={{ maxWidth: '88%', maxHeight: '88%', objectFit: 'contain' }} />
      </ButtonBase>
      {disponibles.length > 1 ? (
        <Box role="group" aria-label="Miniaturas" sx={{ display: 'flex', gap: '12px', mt: '14px', overflowX: 'auto', pb: 0.5 /* estilos-sueltos: ok */ }}>
          {disponibles.map((imagen, indice) => (
            <ButtonBase
              key={imagen.posicion}
              onClick={() => setElegida(indice)}
              aria-label={`Ver imagen ${indice + 1} de ${disponibles.length}`}
              aria-pressed={imagen === actual}
              data-testid="miniatura"
              sx={(tema) => ({
                width: 84, minWidth: 56, flexShrink: 1, aspectRatio: 1, overflow: 'hidden', bgcolor: tema.tienda?.superficie ?? 'action.hover', border: '2px solid', borderRadius: '8px', // estilos-sueltos: ok
                borderColor: imagen === actual ? 'primary.main' : 'transparent',
              })}
            >
              <Box component="img" src={imagen.url} alt="" loading="lazy" onError={() => marcarFallida(imagen.url)} sx={{ width: '80%', height: '80%', objectFit: 'contain' }} />
            </ButtonBase>
          ))}
        </Box>
      ) : null}
      <Ampliacion abierta={ampliada} url={actual.url} nombre={nombre} onCerrar={() => setAmpliada(false)} />
    </Box>
  )
}
