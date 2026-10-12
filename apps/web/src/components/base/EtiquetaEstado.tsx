import { Chip } from '@mui/material'
import type { ChipProps } from '@mui/material'
import { tokens } from '../../tema/tokens'

export type VarianteEtiqueta = 'neutral' | 'primario' | 'exito' | 'aviso' | 'error' | 'info'

const colorPorVariante: Record<VarianteEtiqueta, ChipProps['color']> = {
  neutral: 'default',
  primario: 'primary',
  exito: 'success',
  aviso: 'warning',
  error: 'error',
  info: 'info',
}

// Etiqueta de estado del sistema de diseño (DS-02): variantes semánticas
// mapeadas a la paleta del tema.
export function EtiquetaEstado({ texto, variante = 'neutral' }: { texto: string; variante?: VarianteEtiqueta }) {
  return (
    <Chip
      label={texto}
      size="small"
      color={colorPorVariante[variante]}
      variant={variante === 'neutral' ? 'outlined' : 'filled'}
      sx={{ borderRadius: `${tokens.forma.radioEtiqueta}px` }}
    />
  )
}
