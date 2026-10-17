import { Chip } from '@mui/material'
import type { ChipProps } from '@mui/material'
import { tokens } from '../../tema/tokens'

export type VarianteEtiqueta = 'neutral' | 'primario' | 'exito' | 'aviso' | 'error' | 'info' | 'contorno'

const colorPorVariante: Record<VarianteEtiqueta, ChipProps['color']> = {
  neutral: 'default',
  primario: 'primary',
  exito: 'success',
  aviso: 'warning',
  error: 'error',
  info: 'info',
  contorno: 'default',
}

// Etiqueta de estado del sistema de diseño: además de la variante semántica
// (que conserva la clase de color de MUI para accesibilidad y tests), los
// tonos .chip.n/.p/.ok/.w/.e/.i/.o del prototipo salen de los tokens (FR-006).
export function EtiquetaEstado({ texto, variante = 'neutral' }: { texto: string; variante?: VarianteEtiqueta }) {
  const tono = tokens.color.etiqueta[variante]
  const contorno = 'borde' in tono ? tono.borde : undefined
  return (
    <Chip
      label={texto}
      size="small"
      color={colorPorVariante[variante]}
      variant={variante === 'neutral' || variante === 'contorno' ? 'outlined' : 'filled'}
      sx={{
        borderRadius: `${tokens.forma.radioEtiqueta}px`,
        height: tokens.forma.altoEtiqueta,
        backgroundColor: tono.fondo,
        color: tono.texto,
        ...(contorno ? { border: `1px solid ${contorno}` } : {}),
      }}
    />
  )
}
