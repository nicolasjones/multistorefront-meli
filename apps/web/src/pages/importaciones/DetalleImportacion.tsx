import { useCallback } from 'react'
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
  duracion,
  etiquetaEstado,
  etiquetaFuncionalidad,
  etiquetaTipo,
  formatearFecha,
  nombreArchivoErrores,
  resultado,
  pedirLoteErrores,
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
  const pedirLote = useCallback((desde: number, limite: number) => pedirLoteErrores(proceso.id, desde, limite), [proceso.id])
  const nombreArchivo = useCallback(() => nombreArchivoErrores(proceso.nombre), [proceso.nombre])
  const { exportar, exportando, mensaje, cerrarMensaje } = useExportarCsv<ErrorProceso>({
    columnas: COLUMNAS_CSV_ERRORES,
    nombreArchivo,
    tamanoLote: LOTE_CSV_ERRORES,
    pedirLote,
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
