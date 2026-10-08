import { Box, Card, CardContent, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography, useMediaQuery, useTheme } from '@mui/material'
import type { ReactNode } from 'react'

export type ColumnaAdaptable<T> = {
  clave: string
  encabezado: string
  render: (item: T) => ReactNode
  align?: 'left' | 'right' | 'center'
  // Para datos secundarios (p. ej. un identificador técnico) que sólo tienen
  // sentido como columna de tabla, no como línea suelta en una tarjeta.
  ocultarEnTarjeta?: boolean
}

type ContenidoAdaptableProps<T> = {
  items: T[]
  columnas: ColumnaAdaptable<T>[]
  obtenerClave: (item: T) => string
  acciones?: (item: T) => ReactNode
  etiquetaTabla?: string
}

// T040 (US4, contracts): un único punto donde tabla y tarjeta comparten las
// mismas columnas y acciones, para que angosto (xs) y ancho (sm+) nunca
// diverjan en qué datos o acciones expone una fila.
export function ContenidoAdaptable<T>({ items, columnas, obtenerClave, acciones, etiquetaTabla }: ContenidoAdaptableProps<T>) {
  const theme = useTheme()
  const esAngosta = useMediaQuery(theme.breakpoints.down('sm'))

  if (esAngosta) {
    return (
      <Stack spacing={1.5}>
        {items.map((item) => (
          <Card key={obtenerClave(item)} variant="outlined">
            <CardContent>
              <Stack spacing={1}>
                {columnas.filter((columna) => !columna.ocultarEnTarjeta).map((columna) => (
                  <Stack key={columna.clave} direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
                    <Typography variant="body2" color="text.secondary">{columna.encabezado}</Typography>
                    <Box sx={{ textAlign: 'right' }}>{columna.render(item)}</Box>
                  </Stack>
                ))}
                {acciones && (
                  <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="wrap" sx={{ pt: 1 }}>
                    {acciones(item)}
                  </Stack>
                )}
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>
    )
  }

  return (
    <TableContainer>
      <Table aria-label={etiquetaTabla}>
        <TableHead>
          <TableRow>
            {columnas.map((columna) => <TableCell key={columna.clave} align={columna.align}>{columna.encabezado}</TableCell>)}
            {acciones && <TableCell align="right">Acciones</TableCell>}
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((item) => (
            <TableRow key={obtenerClave(item)}>
              {columnas.map((columna) => <TableCell key={columna.clave} align={columna.align}>{columna.render(item)}</TableCell>)}
              {acciones && <TableCell align="right">{acciones(item)}</TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}
