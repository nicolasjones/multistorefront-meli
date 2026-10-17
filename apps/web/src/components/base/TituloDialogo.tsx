import { DialogTitle, IconButton, Stack } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import type { ReactNode } from 'react'

type TituloDialogoProps = {
  children: ReactNode
  id?: string
  onCerrar?: () => void
}

// Encabezado de diálogo del prototipo: título `.t2` y botón «Cerrar» (X) a la
// derecha. El padding y la tipografía salen del tema (`MuiDialogTitle`).
export function TituloDialogo({ children, id, onCerrar }: TituloDialogoProps) {
  return (
    <DialogTitle id={id} sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1.5 }}>
      <Stack component="span" sx={{ flex: 1, minWidth: 0 }}>{children}</Stack>
      {onCerrar ? (
        <IconButton aria-label="Cerrar" onClick={onCerrar} edge="end" size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      ) : null}
    </DialogTitle>
  )
}
