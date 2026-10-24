import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Link, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, Typography,
} from '@mui/material'
import { supabaseClient } from '../../lib/supabase'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../estados/EstadosPagina'
import { formatearFechaLote, type LoteHistorial, type MovimientoDeLote } from '../../lib/lotes'

const TAMANO_PAGINA_LOTES = 50

type Props = {
  // Cambia cuando se registra un lote para volver a leer el historial.
  revision: number
}

// Historial de lotes y detalle de movimientos (F-STK-10, FR-009). Lo ven `lectura` y `edicion`;
// la RLS de la base decide qué filas llegan. Keyset por número de lote: «Ver más» pide los anteriores.
export function HistorialLotes({ revision }: Props) {
  const [lotes, setLotes] = useState<LoteHistorial[] | null>(null)
  const [hayMas, setHayMas] = useState(false)
  const [hayError, setHayError] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [abierto, setAbierto] = useState<LoteHistorial | null>(null)
  const [movimientos, setMovimientos] = useState<MovimientoDeLote[] | null>(null)
  const [errorDetalle, setErrorDetalle] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async (despuesDe: number | null) => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    setHayError(false)
    try {
      const { data, error } = await supabaseClient.rpc('listar_lotes_stock', {
        p_limite: TAMANO_PAGINA_LOTES,
        p_cursor: despuesDe === null ? null : { numero: despuesDe },
      })
      if (error) throw error
      if (peticion !== ultimaPeticion.current) return
      const filas = (data ?? []) as unknown as LoteHistorial[]
      setLotes((previo) => (despuesDe === null ? filas : [...(previo ?? []), ...filas]))
      setHayMas(filas.length === TAMANO_PAGINA_LOTES)
    } catch (error) {
      console.error('No pudimos cargar el historial de lotes.', error)
      if (peticion === ultimaPeticion.current) setHayError(true)
    } finally {
      if (peticion === ultimaPeticion.current) setCargando(false)
    }
  }, [])

  useEffect(() => { void cargar(null) }, [cargar, revision])

  const abrir = async (lote: LoteHistorial) => {
    setAbierto(lote)
    setMovimientos(null)
    setErrorDetalle(false)
    try {
      const { data, error } = await supabaseClient.rpc('listar_movimientos_lote', { p_lote: lote.id })
      if (error) throw error
      setMovimientos((data ?? []) as unknown as MovimientoDeLote[])
    } catch (error) {
      console.error('No pudimos cargar los movimientos del lote.', error)
      setErrorDetalle(true)
    }
  }

  return (
    <Box>
      <Typography variant="h3" component="h2" sx={{ mb: 1 }}>Historial de lotes</Typography>

      {lotes === null && cargando ? <EstadoCargaPagina /> : null}
      {hayError ? (
        <EstadoError titulo="No pudimos cargar el historial de lotes." reintentar={() => void cargar(null)} />
      ) : null}
      {lotes !== null && lotes.length === 0 && !hayError ? (
        <EstadoVacio titulo="Todavía no hay lotes registrados." descripcion="Los lotes que cargues aparecen acá, del más reciente al más antiguo." />
      ) : null}

      {lotes !== null && lotes.length > 0 ? (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label="Historial de lotes">
            <TableHead>
              <TableRow>
                <TableCell>Lote</TableCell>
                <TableCell>Fecha</TableCell>
                <TableCell>Proveedor</TableCell>
                <TableCell align="right">Productos</TableCell>
                <TableCell align="right">Unidades</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {lotes.map((lote) => (
                <TableRow key={lote.id} hover>
                  <TableCell>
                    <Link component="button" type="button" onClick={() => void abrir(lote)} aria-label={`Ver el lote ${lote.numero}`}>
                      Lote {lote.numero}
                    </Link>
                  </TableCell>
                  <TableCell>{formatearFechaLote(lote.fecha)}</TableCell>
                  <TableCell>{lote.proveedor ?? '—'}</TableCell>
                  <TableCell align="right">{lote.productos}</TableCell>
                  <TableCell align="right">{lote.unidades}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {hayMas ? (
            <Stack alignItems="center" sx={{ mt: 1 }}>
              <Button onClick={() => void cargar(lotes[lotes.length - 1].numero)} disabled={cargando}>Ver más</Button>
            </Stack>
          ) : null}
        </Box>
      ) : null}

      <Dialog open={abierto !== null} onClose={() => setAbierto(null)} fullWidth maxWidth="sm" aria-labelledby="titulo-detalle-lote">
        <DialogTitle id="titulo-detalle-lote">
          {abierto ? `Lote ${abierto.numero} · ${formatearFechaLote(abierto.fecha)}` : 'Lote'}
        </DialogTitle>
        <DialogContent>
          {abierto?.proveedor ? <Typography variant="body2" sx={{ mb: 1 }}>Proveedor: {abierto.proveedor}</Typography> : null}
          {errorDetalle ? <EstadoError titulo="No pudimos cargar los movimientos del lote." reintentar={() => abierto && void abrir(abierto)} /> : null}
          {!errorDetalle && movimientos === null ? <EstadoCargaPagina lineas={2} /> : null}
          {movimientos !== null && movimientos.length === 0 ? <EstadoVacio titulo="Este lote no tiene movimientos." /> : null}
          {movimientos !== null && movimientos.length > 0 ? (
            <Table size="small" aria-label="Movimientos del lote">
              <TableHead>
                <TableRow>
                  <TableCell>Producto</TableCell>
                  <TableCell align="right">Cantidad</TableCell>
                  <TableCell align="right">Saldo</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {movimientos.map((movimiento) => (
                  <TableRow key={movimiento.movimiento_id}>
                    <TableCell>{movimiento.sku ? `${movimiento.producto} · ${movimiento.sku}` : movimiento.producto}</TableCell>
                    <TableCell align="right">{movimiento.cantidad}</TableCell>
                    <TableCell align="right">{movimiento.saldo}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAbierto(null)}>Cerrar</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
