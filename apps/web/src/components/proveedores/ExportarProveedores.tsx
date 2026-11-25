import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText, LinearProgress } from '@mui/material'
import { descargarArchivo, ExportacionCancelada } from '../../lib/exportarClientes'
import {
  exportarProveedores, nombreArchivoExportacionProveedores,
  type FiltrosExportacionProveedores, type ProgresoExportacionProveedores,
} from '../../lib/exportarProveedores'
import { TituloDialogo } from '../base/TituloDialogo'

type Estado = 'cerrado' | 'confirmando' | 'exportando' | 'listo' | 'error'

// Botón «Exportar» del listado de proveedores (MSF-526): confirmación, progreso, cancelación y
// reintento. El padre solo lo monta si el usuario puede exportar la sección.
export function ExportarProveedores({ filtros, total }: { filtros: FiltrosExportacionProveedores; total: number }) {
  const [estado, setEstado] = useState<Estado>('cerrado')
  const [progreso, setProgreso] = useState<ProgresoExportacionProveedores>({ descargados: 0, total })
  const [mensajeError, setMensajeError] = useState('')
  const control = useRef<AbortController | null>(null)

  useEffect(() => () => control.current?.abort(), [])

  async function exportar() {
    const abort = new AbortController()
    control.current = abort
    setProgreso({ descargados: 0, total })
    setEstado('exportando')
    try {
      const archivo = await exportarProveedores(filtros, { alProgresar: setProgreso, signal: abort.signal })
      descargarArchivo(archivo, nombreArchivoExportacionProveedores())
      setEstado('listo')
    } catch (error) {
      if (error instanceof ExportacionCancelada) {
        setEstado('cerrado')
        return
      }
      setMensajeError(error instanceof Error && error.message ? error.message : 'No pudimos exportar los proveedores.')
      setEstado('error')
    }
  }

  const cerrar = () => setEstado('cerrado')
  const porcentaje = progreso.total > 0 ? Math.min(100, Math.round((progreso.descargados / progreso.total) * 100)) : 0

  return (
    <>
      <Button variant="outlined" onClick={() => setEstado('confirmando')}>Exportar</Button>
      <Dialog open={estado !== 'cerrado'} onClose={estado === 'exportando' ? undefined : cerrar} aria-labelledby="exportar-proveedores-titulo" fullWidth maxWidth="xs">
        <TituloDialogo id="exportar-proveedores-titulo" onCerrar={estado === 'exportando' ? undefined : cerrar}>Exportar proveedores</TituloDialogo>
        <DialogContent>
          {estado === 'confirmando' ? (
            <DialogContentText>
              Se descargará un archivo Excel (.xlsx) con {total} {total === 1 ? 'proveedor' : 'proveedores'}: todos los que coinciden con la búsqueda y los filtros actuales, no solo los que ya cargó la pantalla.
            </DialogContentText>
          ) : null}
          {estado === 'exportando' ? (
            <>
              <DialogContentText role="status" aria-live="polite" sx={{ mb: 2 }}>
                Exportando {progreso.descargados} de {progreso.total || total} proveedores…
              </DialogContentText>
              <LinearProgress variant="determinate" value={porcentaje} aria-label="Progreso de la exportación" />
            </>
          ) : null}
          {estado === 'listo' ? <Alert severity="success">Listo: el archivo se descargó.</Alert> : null}
          {estado === 'error' ? <Alert severity="error">{mensajeError}</Alert> : null}
        </DialogContent>
        <DialogActions>
          {estado === 'confirmando' ? (
            <>
              <Button onClick={cerrar}>Cancelar</Button>
              <Button variant="contained" onClick={() => void exportar()}>Descargar archivo</Button>
            </>
          ) : null}
          {estado === 'exportando' ? <Button onClick={() => control.current?.abort()}>Cancelar exportación</Button> : null}
          {estado === 'listo' ? <Button onClick={cerrar}>Cerrar</Button> : null}
          {estado === 'error' ? (
            <>
              <Button onClick={cerrar}>Cerrar</Button>
              <Button variant="contained" onClick={() => void exportar()}>Reintentar</Button>
            </>
          ) : null}
        </DialogActions>
      </Dialog>
    </>
  )
}
