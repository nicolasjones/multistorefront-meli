import { Box, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'

type BarraHerramientasProps = {
  children?: ReactNode
  contador?: ReactNode
  ayuda?: ReactNode
}

// Barra de herramientas del listado: la fila del prototipo con la búsqueda, las
// píldoras de filtro y el contador de resultados, más un texto de ayuda opcional
// debajo. Es sólo disposición: no conoce datos ni permisos, recibe todo armado.
export function BarraHerramientas({ children, contador, ayuda }: BarraHerramientasProps) {
  return (
    <Stack spacing={1} sx={{ mb: 1.5 }}>
      <Stack direction="row" spacing={1.25} alignItems="center" useFlexGap flexWrap="wrap">
        {children}
        <Box sx={{ flexGrow: 1 }} />
        {contador ? <Typography component="span" variant="s">{contador}</Typography> : null}
      </Stack>
      {ayuda ? <Typography variant="xs">{ayuda}</Typography> : null}
    </Stack>
  )
}
