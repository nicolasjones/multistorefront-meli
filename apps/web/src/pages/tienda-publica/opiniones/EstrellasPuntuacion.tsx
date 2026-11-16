import StarIcon from '@mui/icons-material/Star'
import StarBorderIcon from '@mui/icons-material/StarBorder'
import { Box } from '@mui/material'
import { useRef } from 'react'
import { textoPuntuacion } from './textos'

const ESTRELLAS = [1, 2, 3, 4, 5] as const

// Estrellas de solo lectura: se anuncian como un único texto («4 estrellas de 5»); los íconos son decorativos.
export function EstrellasLectura({ valor, tamano = 'medium' }: { valor: number; tamano?: 'small' | 'medium' }) {
  return (
    <Box component="span" role="img" aria-label={textoPuntuacion(valor)} sx={{ display: 'inline-flex', color: 'warning.main', verticalAlign: 'middle' }}>
      {ESTRELLAS.map((n) => (n <= valor ? <StarIcon key={n} fontSize={tamano} aria-hidden /> : <StarBorderIcon key={n} fontSize={tamano} aria-hidden />))}
    </Box>
  )
}

// Estrellas operables (MSF-467, RF-OPI-11): grupo de radio con teclado (flechas mueven y eligen; Inicio y Fin van a los extremos;
// una sola parada de tabulación) y lectura de pantalla por estrella. Sin valor elegido, la primera es la parada de tabulación.
export function EstrellasPuntuacion({ valor, alCambiar, etiqueta = 'Tu puntuación', deshabilitado = false, idDescripcion }: {
  valor: number | null
  alCambiar: (nuevo: number) => void
  etiqueta?: string
  deshabilitado?: boolean
  idDescripcion?: string
}) {
  const botones = useRef<Array<HTMLButtonElement | null>>([])
  const elegir = (n: number, enfocar = true) => {
    alCambiar(n)
    if (enfocar) botones.current[n - 1]?.focus()
  }
  const alTeclear = (evento: React.KeyboardEvent, n: number) => {
    let destino: number | null = null
    if (evento.key === 'ArrowRight' || evento.key === 'ArrowUp') destino = Math.min(5, n + 1)
    else if (evento.key === 'ArrowLeft' || evento.key === 'ArrowDown') destino = Math.max(1, n - 1)
    else if (evento.key === 'Home') destino = 1
    else if (evento.key === 'End') destino = 5
    if (destino === null) return
    evento.preventDefault()
    elegir(destino)
  }
  return (
    <Box role="radiogroup" aria-label={etiqueta} aria-describedby={idDescripcion} sx={{ display: 'inline-flex', color: 'warning.main' }}>
      {ESTRELLAS.map((n) => {
        const marcada = valor !== null && n <= valor
        const paradaDeTab = valor === null ? n === 1 : n === valor
        return (
          <Box
            key={n}
            component="button"
            type="button"
            role="radio"
            aria-checked={valor === n}
            aria-label={textoPuntuacion(n)}
            disabled={deshabilitado}
            tabIndex={paradaDeTab ? 0 : -1}
            ref={(el: HTMLButtonElement | null) => { botones.current[n - 1] = el }}
            onClick={() => elegir(n, false)}
            onKeyDown={(evento: React.KeyboardEvent) => alTeclear(evento, n)}
            sx={{
              background: 'none', border: 0, p: 0, color: 'inherit', cursor: deshabilitado ? 'default' : 'pointer',
              minWidth: (tema) => tema.spacing(5.5), minHeight: (tema) => tema.spacing(5.5), display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: '2px' /* estilos-sueltos: ok */ },
            }}
          >
            {marcada ? <StarIcon aria-hidden /> : <StarBorderIcon aria-hidden />}
          </Box>
        )
      })}
    </Box>
  )
}
