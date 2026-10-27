import { useEffect, useRef, useState } from 'react'
import { Alert, Button, LinearProgress, Stack, Typography } from '@mui/material'
import { descargarArchivo, ErrorExportacion, ExportacionCancelada, type ProgresoExportacion } from '../../lib/exportarClientes'
import {
  exportarRankingVentas, nombreArchivoRankingVentas, type ParametrosExportacionRankingVentas,
} from '../../lib/exportarRankingVentas'

type EstadoExportacion = 'inactivo' | 'exportando' | 'listo' | 'vacio' | 'error'

const PORCENTAJE_COMPLETO = 100

type Props = {
  /** Filtros vigentes de la pantalla (período, tienda y «Consumidor final»). */
  parametros: ParametrosExportacionRankingVentas
  /** Botón deshabilitado (p. ej. mientras se resuelve el filtro de empresa). */
  deshabilitado: boolean
}

// Botón «Exportar a Excel» del ranking de clientes de «Ventas · Reportes» (F-VTA-23, FR-009,
// SC-004): exporta el ranking COMPLETO que muestra la pantalla (no solo una página), con progreso,
// cancelación, aviso de éxito y reintento.
//
// El permiso NO se decide acá: la pantalla solo monta el botón con la sección `reportes` (y la base
// vuelve a rechazarlo con 42501 si no la tiene: no alcanza con ocultar el botón).
export function ExportarRankingVentas({ parametros, deshabilitado }: Props) {
  const [estado, setEstado] = useState<EstadoExportacion>('inactivo')
  const [progreso, setProgreso] = useState<ProgresoExportacion>({ descargados: 0, total: 0 })
  const [mensajeError, setMensajeError] = useState('')
  const control = useRef<AbortController | null>(null)

  useEffect(() => () => control.current?.abort(), [])

  // Principio VIII: si cambia la empresa, el período o el interruptor, la exportación en curso se
  // cancela y los avisos (listo/vacío/error) se descartan: nunca quedan datos de la vista anterior.
  const { desde, hasta, incluirConsumidorFinal, empresaId } = parametros
  useEffect(() => {
    control.current?.abort()
    control.current = null
    setEstado('inactivo')
  }, [desde, hasta, incluirConsumidorFinal, empresaId])

  async function exportar() {
    const abort = new AbortController()
    control.current = abort
    setProgreso({ descargados: 0, total: 0 })
    setEstado('exportando')
    try {
      const archivo = await exportarRankingVentas(parametros, { alProgresar: setProgreso, signal: abort.signal })
      descargarArchivo(archivo, nombreArchivoRankingVentas(parametros))
      setEstado('listo')
    } catch (error) {
      if (error instanceof ExportacionCancelada) {
        setEstado('inactivo')
        return
      }
      // El ranking vacío no es un error: es un resultado (no hay clientes con esos filtros).
      if (error instanceof ErrorExportacion && error.codigo === 'VACIO') {
        setEstado('vacio')
        return
      }
      setMensajeError(error instanceof Error && error.message ? error.message : 'No pudimos exportar el ranking.')
      setEstado('error')
    }
  }

  const exportando = estado === 'exportando'
  const porcentaje = progreso.total > 0
    ? Math.min(PORCENTAJE_COMPLETO, Math.round((progreso.descargados / progreso.total) * PORCENTAJE_COMPLETO))
    : 0

  return (
    <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Button variant="outlined" onClick={() => void exportar()} disabled={deshabilitado || exportando}>
          Exportar a Excel
        </Button>
        {exportando ? (
          <Button size="small" onClick={() => control.current?.abort()}>Cancelar exportación</Button>
        ) : null}
      </Stack>
      {exportando ? (
        <>
          <Typography variant="xs" role="status" aria-live="polite">
            Exportando {progreso.descargados} de {progreso.total} clientes…
          </Typography>
          <LinearProgress variant="determinate" value={porcentaje} aria-label="Progreso de la exportación" sx={{ width: 220 }} />
        </>
      ) : null}
      {estado === 'listo' ? (
        <Alert severity="success" onClose={() => setEstado('inactivo')}>Exportación lista: el archivo se descargó.</Alert>
      ) : null}
      {estado === 'vacio' ? (
        <Alert severity="info" onClose={() => setEstado('inactivo')}>
          No hay clientes en el ranking con esos filtros. Probá con otro período o activá el «Consumidor final».
        </Alert>
      ) : null}
      {estado === 'error' ? (
        <Alert
          severity="error"
          action={<Button color="inherit" size="small" onClick={() => void exportar()}>Reintentar</Button>}
        >
          {mensajeError}
        </Alert>
      ) : null}
    </Stack>
  )
}
