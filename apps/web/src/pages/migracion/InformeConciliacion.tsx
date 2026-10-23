import { useCallback, useEffect, useState } from 'react'
import { Alert, Box, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { EstadoCargaPagina, EstadoError } from '../../components/estados/EstadosPagina'
import {
  etiquetaEntidadMigracion,
  mensajeDeErrorMigracion,
  obtenerInformeConciliacion,
  type InformeConciliacion as Informe,
} from '../../lib/migracion'
import { supabaseClient } from '../../lib/supabase'

// F-MIG-04 (FR-040): informe de conciliación de una carga. Muestra las filas del archivo de
// origen contra lo cargado (nuevos, actualizados, con error, omitidos) y la diferencia que
// calcula la base, más la verificación contra la tabla destino. Se usa tras aplicar en el
// asistente y al consultar una carga anterior. Solo lee: la base lo vuelve a calcular cada vez.
// Es de la organización, no de una empresa (FR-011): cambiar la empresa activa no lo reencuadra.
export function InformeConciliacion({ carga, conErrores = true }: { carga: string; conErrores?: boolean }) {
  const [informe, setInforme] = useState<Informe | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setInforme(null)
    setError(null)
    try {
      setInforme(await obtenerInformeConciliacion(supabaseClient, carga))
    } catch (excepcion) {
      setError(mensajeDeErrorMigracion(excepcion, 'No pudimos calcular el informe de conciliación. Intentá de nuevo.'))
    }
  }, [carga])

  useEffect(() => {
    let vigente = true
    setInforme(null)
    setError(null)
    obtenerInformeConciliacion(supabaseClient, carga)
      .then((resultado) => { if (vigente) setInforme(resultado) })
      .catch((excepcion: unknown) => {
        if (vigente) setError(mensajeDeErrorMigracion(excepcion, 'No pudimos calcular el informe de conciliación. Intentá de nuevo.'))
      })
    return () => { vigente = false }
  }, [carga])

  if (error) return <EstadoError titulo="No pudimos calcular la conciliación." descripcion={error} reintentar={() => void cargar()} />
  if (!informe) return <EstadoCargaPagina lineas={2} />

  const filas: Array<[string, number, boolean?]> = [
    ['Filas del archivo de origen', informe.filasOrigen],
    ['Nuevos', informe.nuevos],
    ['Actualizados', informe.actualizados],
    ['Con error', informe.conError],
    ['Omitidos (sin resultado)', informe.omitidos],
    ['Diferencia (origen − con resultado)', informe.diferencia, informe.diferencia !== 0],
    ['Verificadas en el destino', informe.destinoVerificadas],
    ['Diferencia contra el destino', informe.destinoDiferencia, informe.destinoDiferencia !== 0],
  ]

  return (
    <Stack spacing={2} component="section" aria-label="Informe de conciliación">
      <Typography component="h2" variant="t3">
        Conciliación · {etiquetaEntidadMigracion(informe.entidad)}
      </Typography>
      {informe.conciliado ? (
        <Alert severity="success" role="status">
          Conciliado: el archivo y lo cargado cuadran, sin diferencias.
        </Alert>
      ) : (
        <Alert severity="warning" role="status">
          Hay diferencias: {informe.estado !== 'aplicada' ? 'la carga no está completa. ' : ''}
          {informe.diferencia !== 0 ? `Faltan o sobran ${Math.abs(informe.diferencia)} filas contra el archivo. ` : ''}
          {informe.destinoDiferencia !== 0 ? `${Math.abs(informe.destinoDiferencia)} filas aplicadas no se encuentran en el destino. ` : ''}
          Reintentá la carga: lo ya cargado no se duplica.
        </Alert>
      )}
      <Typography variant="body2" color="text.secondary">Archivo: {informe.archivo}</Typography>
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small" aria-label="Detalle de la conciliación">
          <TableHead>
            <TableRow>
              <TableCell>Concepto</TableCell>
              <TableCell align="right">Filas</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filas.map(([etiqueta, valor, resaltar]) => (
              <TableRow key={etiqueta}>
                <TableCell>{etiqueta}</TableCell>
                <TableCell align="right" sx={resaltar ? { fontWeight: 600, color: 'warning.main' } : undefined}>{valor}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
      {conErrores && informe.errores.length > 0 ? (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label="Filas con error de la carga">
            <TableHead>
              <TableRow>
                <TableCell>Fila</TableCell>
                <TableCell>Motivo</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {informe.errores.map((fila) => (
                <TableRow key={fila.fila}>
                  <TableCell>{fila.fila}</TableCell>
                  <TableCell>{fila.motivo}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      ) : null}
    </Stack>
  )
}
