import { Box, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'

type EncabezadoPaginaProps = {
  titulo: string
  descripcion?: string
  accion?: ReactNode
  contexto?: ReactNode
}

export function EncabezadoPagina({ titulo, descripcion, accion, contexto }: EncabezadoPaginaProps) {
  return (
    <Stack component="header" spacing={1.5} sx={{ mb: 3 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'flex-start' }} spacing={2}>
        <Box>
          <Typography component="h1" variant="h4">{titulo}</Typography>
          {descripcion ? <Typography color="text.secondary" sx={{ mt: 0.5 }}>{descripcion}</Typography> : null}
        </Box>
        {accion ? <Box>{accion}</Box> : null}
      </Stack>
      {contexto ? <Box>{contexto}</Box> : null}
    </Stack>
  )
}
