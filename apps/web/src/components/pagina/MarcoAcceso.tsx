import { Box } from '@mui/material'
import type { ReactNode } from 'react'
import { PanelMarca } from './PanelMarca'

type MarcoAccesoProps = {
  children: ReactNode
  // Ancho máximo de la columna del formulario (440 en el prototipo).
  ancho?: number
}

// Marco de las pantallas de acceso del prototipo: panel de marca a la izquierda
// y el contenido centrado a la derecha.
export function MarcoAcceso({ children, ancho = 440 }: MarcoAccesoProps) {
  return (
    <Box component="main" sx={{ minHeight: '100vh', display: 'flex', bgcolor: 'background.default' }}>
      <PanelMarca />
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
        <Box sx={{ width: '100%', maxWidth: ancho }}>{children}</Box>
      </Box>
    </Box>
  )
}
