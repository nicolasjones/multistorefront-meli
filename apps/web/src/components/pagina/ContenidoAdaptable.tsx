import { Box, Card, CardContent, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel, Typography, useMediaQuery, useTheme } from '@mui/material'
import type { ReactNode } from 'react'
import { tokens } from '../../tema/tokens'

export type ColumnaAdaptable<T> = {
  clave: string
  encabezado: string
  render: (item: T) => ReactNode
  align?: 'left' | 'right' | 'center'
  // Para datos secundarios (p. ej. un identificador técnico) que sólo tienen
  // sentido como columna de tabla, no como línea suelta en una tarjeta.
  ocultarEnTarjeta?: boolean
  // Encabezado clicable que ordena (solo tabla ancha); requiere `orden` y `alOrdenar` en el contenedor.
  ordenable?: boolean
}

export type OrdenAdaptable = { clave: string; direccion: 'asc' | 'desc' }

// Variantes de fila del prototipo: .neg (negativa) y .hi (destacada) (FR-007).
export type VarianteFila = 'negativa' | 'destacada'

type ContenidoAdaptableProps<T> = {
  items: T[]
  columnas: ColumnaAdaptable<T>[]
  obtenerClave: (item: T, indice: number) => string
  acciones?: (item: T) => ReactNode
  etiquetaTabla?: string
  varianteFila?: (item: T) => VarianteFila | undefined
  orden?: OrdenAdaptable
  alOrdenar?: (clave: string) => void
  // Control de selección en la cabecera de la PRIMERA columna (la de casillas): así lo dibuja el
  // prototipo (`VentasFaltantes.dc.html`, la casilla «Seleccionar todos» va en el encabezado de la
  // columna de selección, sin texto visible). En la vista angosta, donde no hay tabla, se dibuja una
  // sola vez arriba de las tarjetas para que el «seleccionar todo» no se pierda a 320 px.
  seleccionEnCabecera?: ReactNode
}

function fondoFila(variante: VarianteFila | undefined) {
  if (variante === 'negativa') return tokens.color.fila.negativa
  if (variante === 'destacada') return tokens.color.fila.destacada
  return undefined
}

// T040 (US4, contracts): un único punto donde tabla y tarjeta comparten las
// mismas columnas y acciones, para que angosto (xs) y ancho (sm+) nunca
// diverjan en qué datos o acciones expone una fila.
export function ContenidoAdaptable<T>({ items, columnas, obtenerClave, acciones, etiquetaTabla, varianteFila, orden, alOrdenar, seleccionEnCabecera }: ContenidoAdaptableProps<T>) {
  const theme = useTheme()
  const esAngosta = useMediaQuery(theme.breakpoints.down('sm'))

  if (esAngosta) {
    return (
      <Stack spacing={1.5}>
        {seleccionEnCabecera}
        {items.map((item, indice) => (
          <Card key={obtenerClave(item, indice)} variant="outlined">
            <CardContent>
              <Stack spacing={1}>
                {columnas.filter((columna) => !columna.ocultarEnTarjeta).map((columna) => (
                  <Stack key={columna.clave} direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
                    {columna.encabezado ? <Typography variant="body2" color="text.secondary">{columna.encabezado}</Typography> : null}
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
      <Table
        aria-label={etiquetaTabla}
        sx={{ '& .MuiTableRow-root:last-child .MuiTableCell-root': { borderBottom: 0 } }}
      >
        <TableHead>
          <TableRow>
            {columnas.map((columna, indice) => {
              const ordenable = columna.ordenable && orden && alOrdenar
              const activa = ordenable && orden.clave === columna.clave
              return (
                <TableCell
                  key={columna.clave}
                  align={columna.align}
                  sortDirection={activa ? orden.direccion : false}
                >
                  {indice === 0 ? seleccionEnCabecera : null}
                  {ordenable ? (
                    <TableSortLabel
                      active={activa}
                      direction={activa ? orden.direccion : 'asc'}
                      onClick={() => alOrdenar(columna.clave)}
                    >
                      {columna.encabezado}
                    </TableSortLabel>
                  ) : columna.encabezado}
                </TableCell>
              )
            })}
            {acciones && <TableCell align="right">Acciones</TableCell>}
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((item, indice) => (
            <TableRow key={obtenerClave(item, indice)} sx={{ backgroundColor: fondoFila(varianteFila?.(item)) }}>
              {columnas.map((columna) => <TableCell key={columna.clave} align={columna.align}>{columna.render(item)}</TableCell>)}
              {acciones && <TableCell align="right">{acciones(item)}</TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}
