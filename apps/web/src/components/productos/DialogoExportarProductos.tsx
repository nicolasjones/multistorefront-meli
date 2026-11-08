import { useEffect, useRef, useState } from 'react'
import {
  Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, FormControl, FormControlLabel, FormGroup, FormHelperText,
  FormLabel, LinearProgress, Stack, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material'
import { supabaseClient } from '../../lib/supabase'
import {
  columnasOfrecidas, columnasPorDefecto, descargarCsvProductos, ExportacionCancelada, exportarProductos, filtrosExportacion,
  type ClaveColumnaExportacion,
} from '../../lib/exportarProductos'
import type { ConsultaProductos } from '../../lib/productosListado'
import { TituloDialogo } from '../base/TituloDialogo'

type Estado = 'configurando' | 'exportando' | 'error'

type Props = {
  consulta: ConsultaProductos
  /** Productos que coinciden con la búsqueda y los filtros del listado («Lo filtrado»). */
  totalFiltrado: number
  veRentabilidad: boolean
  onCerrar: () => void
  /** `recortadoA`: solo si el filtro tenía más productos que el tope del archivo. */
  onExportado: (productos: number, columnas: number, recortadoA?: number) => void
}

// Diálogo «Exportar productos» (F-CAT-11, FR-201…FR-205): Qué exportar, Formato y Columnas. Solo se monta para el
// Administrador; la autoridad es `public.exportar_productos`. El padre lo cierra al cambiar de empresa (FR-209).
export function DialogoExportarProductos({ consulta, totalFiltrado, veRentabilidad, onCerrar, onExportado }: Props) {
  const [queExportar, setQueExportar] = useState<'filtrado' | 'todos'>('filtrado')
  const [columnas, setColumnas] = useState<ClaveColumnaExportacion[]>(() => columnasPorDefecto(veRentabilidad))
  const [totalCatalogo, setTotalCatalogo] = useState<number | null>(null)
  const [errorConteo, setErrorConteo] = useState(false)
  const [reintentoConteo, setReintentoConteo] = useState(0)
  const [estado, setEstado] = useState<Estado>('configurando')
  const [progreso, setProgreso] = useState({ descargados: 0, total: 0 })
  const [mensajeError, setMensajeError] = useState('')
  const control = useRef<AbortController | null>(null)

  useEffect(() => () => control.current?.abort(), [])

  // «Todos (N)»: todo el catálogo de la organización, sin filtros.
  useEffect(() => {
    let vigente = true
    setErrorConteo(false)
    void supabaseClient
      .from('v_productos_listado')
      .select('id', { count: 'exact', head: true })
      .then(({ count, error }) => {
        if (!vigente) return
        if (error || count === null) {
          if (error) console.error('No pudimos contar el catálogo.', error)
          setErrorConteo(true)
          return
        }
        setTotalCatalogo(count)
      })
    return () => { vigente = false }
  }, [reintentoConteo])

  const cantidad = queExportar === 'todos' ? totalCatalogo : totalFiltrado
  const sinFilas = cantidad === 0
  const puedeExportar = estado === 'configurando' && cantidad !== null && !sinFilas && columnas.length > 0
  const ofrecidas = columnasOfrecidas(veRentabilidad)

  async function exportar() {
    const abort = new AbortController()
    control.current = abort
    setProgreso({ descargados: 0, total: cantidad ?? 0 })
    setEstado('exportando')
    try {
      const resultado = await exportarProductos(supabaseClient, {
        filtros: filtrosExportacion(consulta, queExportar === 'todos'),
        columnas: ofrecidas.filter((columna) => columnas.includes(columna.clave)).map((columna) => columna.clave),
        alProgresar: (descargados, total) => setProgreso({ descargados, total }),
        signal: abort.signal,
      })
      descargarCsvProductos(resultado.csv)
      if (resultado.recortado) onExportado(resultado.productos, resultado.columnas, resultado.tope)
      else onExportado(resultado.productos, resultado.columnas)
    } catch (error) {
      if (error instanceof ExportacionCancelada) {
        setEstado('configurando')
        return
      }
      console.error('No pudimos exportar los productos.', error)
      setMensajeError('No pudimos exportar los productos. Intentá de nuevo.')
      setEstado('error')
    }
  }

  const alternar = (clave: ClaveColumnaExportacion) =>
    setColumnas((actuales) => (actuales.includes(clave) ? actuales.filter((c) => c !== clave) : [...actuales, clave]))
  const porcentaje = progreso.total > 0 ? Math.min(100, Math.round((progreso.descargados / progreso.total) * 100)) : 0
  const exportando = estado === 'exportando'

  return (
    <Dialog open onClose={exportando ? undefined : onCerrar} aria-labelledby="exportar-productos-titulo" fullWidth maxWidth="sm">
      <TituloDialogo id="exportar-productos-titulo" onCerrar={exportando ? undefined : onCerrar}>Exportar productos</TituloDialogo>
      <DialogContent>
        <Stack spacing={2.5}>
          <Stack spacing={0.75}>
            <FormLabel id="exportar-productos-que">Qué exportar</FormLabel>
            <ToggleButtonGroup
              exclusive
              size="small"
              aria-labelledby="exportar-productos-que"
              value={queExportar}
              disabled={exportando}
              onChange={(_, valor: 'filtrado' | 'todos' | null) => { if (valor) setQueExportar(valor) }}
            >
              <ToggleButton value="filtrado">{`Lo filtrado (${totalFiltrado})`}</ToggleButton>
              <ToggleButton value="todos">{`Todos (${totalCatalogo ?? '…'})`}</ToggleButton>
            </ToggleButtonGroup>
            <FormHelperText>
              {queExportar === 'filtrado' ? 'Respeta la búsqueda, los filtros y la categoría elegida.' : 'Todo el catálogo, sin filtros.'}
            </FormHelperText>
          </Stack>
          <Stack spacing={0.75}>
            <FormLabel id="exportar-productos-formato">Formato</FormLabel>
            <ToggleButtonGroup exclusive size="small" aria-labelledby="exportar-productos-formato" value="csv" disabled={exportando}>
              <ToggleButton value="csv">CSV</ToggleButton>
              <ToggleButton value="xlsx" disabled>Excel (.xlsx)</ToggleButton>
            </ToggleButtonGroup>
          </Stack>
          <FormControl component="fieldset" disabled={exportando}>
            <FormLabel component="legend">Columnas</FormLabel>
            <FormGroup row>
              {ofrecidas.map((columna) => (
                <FormControlLabel
                  key={columna.clave}
                  control={<Checkbox checked={columnas.includes(columna.clave)} onChange={() => alternar(columna.clave)} />}
                  label={columna.etiqueta}
                />
              ))}
            </FormGroup>
          </FormControl>
          {errorConteo ? (
            <Alert
              severity="error"
              action={<Button color="inherit" size="small" onClick={() => setReintentoConteo((n) => n + 1)}>Reintentar</Button>}
            >
              No pudimos contar los productos del catálogo.
            </Alert>
          ) : null}
          {sinFilas ? <Alert severity="info">No hay productos para exportar.</Alert> : null}
          {exportando ? (
            <>
              <Typography role="status" aria-live="polite">Exportando {progreso.descargados} de {progreso.total} productos…</Typography>
              <LinearProgress variant="determinate" value={porcentaje} aria-label="Progreso de la exportación" />
            </>
          ) : null}
          {estado === 'error' ? <Alert severity="error">{mensajeError}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        {exportando ? (
          <Button onClick={() => control.current?.abort()}>Cancelar exportación</Button>
        ) : (
          <>
            <Button onClick={onCerrar}>Cancelar</Button>
            <Button variant="contained" disabled={!puedeExportar && estado !== 'error'} onClick={() => void exportar()}>
              {estado === 'error' ? 'Reintentar' : 'Exportar'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}
