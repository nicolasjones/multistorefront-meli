import { Box, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'

type EncabezadoPaginaProps = {
  titulo: string
  descripcion?: string
  // Línea de contexto adicional bajo la descripción (p. ej. el origen de un comprobante, F-SVC-13).
  detalle?: ReactNode
  accion?: ReactNode
  contexto?: ReactNode
  pestanas?: ReactNode
}

// Encabezado de pantalla del prototipo: título `.t1`, descripción `.bl`, acciones
// a la derecha y, opcional, pestañas debajo (`.tabs`). Es sólo composición: no
// conoce datos ni permisos.
export function EncabezadoPagina({ titulo, descripcion, detalle, accion, contexto, pestanas }: EncabezadoPaginaProps) {
  return (
    <Stack component="header" sx={{ mb: 2.5 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ sm: 'flex-start' }}
        spacing={2}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography component="h1" variant="t1">{titulo}</Typography>
          {descripcion ? <Typography variant="bl" color="text.secondary" sx={{ mt: 0.5 }}>{descripcion}</Typography> : null}
          {detalle ? <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{detalle}</Typography> : null}
        </Box>
        {accion ? (
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ flexShrink: 0, alignItems: 'center' }}>
            {accion}
          </Stack>
        ) : null}
      </Stack>
      {contexto ? <Box sx={{ mt: 1.5 }}>{contexto}</Box> : null}
      {pestanas ? <Box sx={{ mt: 2 }}>{pestanas}</Box> : null}
    </Stack>
  )
}
