import { useCallback, useRef } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { CargaInfinita } from '../../components/pagina/CargaInfinita'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { useErroresProceso } from '../../hooks/useErroresProceso'
import { useExportarCsv } from '../../hooks/useExportarCsv'
import {
  COLUMNAS_CSV_ERRORES,
  LOTE_CSV_ERRORES,
  avance,
  detalleTruncado,
  duracion,
  etiquetaEstado,
  etiquetaFuncionalidad,
  etiquetaTipo,
  formatearFecha,
  nombreArchivoErrores,
  resultado,
  pedirLoteErrores,
  textoDetalleTruncado,
  type ErrorProceso,
  type ProcesoMasivo,
} from '../../lib/procesosMasivos'

const columnas: ColumnaAdaptable<ErrorProceso>[] = [
  { clave: 'fila', encabezado: 'Fila', render: (error) => error.fila ?? '—' },
  { clave: 'columna', encabezado: 'Columna', render: (error) => error.columna ?? '—' },
  { clave: 'referencia', encabezado: 'Referencia', render: (error) => error.referencia ?? '—' },
  { clave: 'motivo', encabezado: 'Motivo', render: (error) => error.motivo_sanitizado },
]

// Diálogo «Detalle de la importación» (FR-013): resumen del proceso y sus errores paginados.
export function DetalleImportacion({ proceso, onCerrar }: { proceso: ProcesoMasivo; onCerrar: () => void }) {
  const { errores, total, hayMas, cargandoMas, errorMas, cargarMas, isLoading, isError, refetch } = useErroresProceso(proceso.id, `${proceso.estado}:${proceso.procesados}:${proceso.con_errores}`)
  // Descarga TODO el reporte del proceso (no solo lo cargado en pantalla), por lotes (RF-IMP-01-3).
  const truncado = detalleTruncado(proceso, total)
  const nota = textoDetalleTruncado(total, proceso.con_errores)
  // El CSV cierra con una fila de aviso si el detalle está truncado (se agrega una sola vez, en el último lote).
  const notaAgregada = useRef(false)
  const pedirLote = useCallback(async (desde: number, limite: number) => {
    const lote = await pedirLoteErrores(proceso.id, desde, limite)
    if (truncado && lote.length < limite && !notaAgregada.current) {
      notaAgregada.current = true
      return [...lote, { id: 'nota-detalle-truncado', fila: null, columna: null, referencia: null, motivo_sanitizado: nota }]
    }
    return lote
  }, [proceso.id, truncado, nota])
  const reiniciarNota = useCallback(() => { notaAgregada.current = false }, [])
  const nombreArchivo = useCallback(() => nombreArchivoErrores(proceso.nombre), [proceso.nombre])
  const { exportar, exportando, mensaje, cerrarMensaje } = useExportarCsv<ErrorProceso>({
    columnas: COLUMNAS_CSV_ERRORES,
    nombreArchivo,
    tamanoLote: LOTE_CSV_ERRORES,
    pedirLote,
    iniciar: reiniciarNota,
  })
  const resumen: [string, string][] = [
    ['Nombre', proceso.nombre],
    ['Origen', `${etiquetaTipo(proceso.tipo)} · ${etiquetaFuncionalidad(proceso.funcionalidad)}`],
    ['Estado', etiquetaEstado(proceso)],
    ['Avance', avance(proceso)],
    ['Resultado', resultado(proceso)],
    ['Creado', formatearFecha(proceso.creado_en)],
    ['Duración', duracion(proceso)],
  ]

  return (
    <Dialog open onClose={onCerrar} fullWidth maxWidth="md" aria-labelledby="detalle-importacion-titulo">
      <DialogTitle id="detalle-importacion-titulo">Detalle de la importación</DialogTitle>
      <DialogContent dividers>
        <Stack component="dl" spacing={0.5} sx={{ m: 0, mb: 2 }}>
          {resumen.map(([etiqueta, valor]) => (
            <Stack key={etiqueta} direction="row" spacing={1}>
              <Typography component="dt" color="text.secondary" sx={{ minWidth: 96 }}>{etiqueta}</Typography>
              <Typography component="dd" sx={{ m: 0 }}>{valor}</Typography>
            </Stack>
          ))}
        </Stack>
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{ mb: 1 }}>
          <Typography component="h3" variant="subtitle1">Errores ({total})</Typography>
          {proceso.con_errores > 0 || total > 0 ? (
            <Button size="small" variant="outlined" disabled={exportando} onClick={() => void exportar()}>
              {exportando ? 'Preparando el archivo…' : 'Descargar errores (CSV)'}
            </Button>
          ) : null}
        </Stack>
        {truncado ? <Alert severity="info" sx={{ mb: 1 }}>{nota}</Alert> : null}
        {mensaje ? <Alert severity={mensaje.tipo === 'error' ? 'error' : 'info'} onClose={cerrarMensaje} sx={{ mb: 1 }}>{mensaje.texto}</Alert> : null}
        {isLoading ? (
          <EstadoCargaPagina lineas={2} />
        ) : isError ? (
          <EstadoError descripcion="No pudimos cargar los errores." reintentar={() => void refetch()} />
        ) : errores.length === 0 ? (
          <EstadoVacio titulo="Este proceso no registró errores." />
        ) : (
          <>
            <ContenidoAdaptable items={errores} columnas={columnas} obtenerClave={(error) => error.id} etiquetaTabla="Errores del proceso" />
            <Typography color="text.secondary" aria-live="polite" sx={{ mt: 1 }}>Mostrando {errores.length} de {total} errores</Typography>
            <CargaInfinita hayMas={hayMas} cargando={cargandoMas} hayError={errorMas} onCargarMas={cargarMas} />
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCerrar}>Cerrar</Button>
      </DialogActions>
    </Dialog>
  )
}
