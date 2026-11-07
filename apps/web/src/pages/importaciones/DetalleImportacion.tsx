import { useState } from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { useErroresProceso } from '../../hooks/useErroresProceso'
import {
  TAMANO_PAGINA_ERRORES,
  avance,
  duracion,
  etiquetaEstado,
  etiquetaFuncionalidad,
  etiquetaTipo,
  formatearFecha,
  type ErrorProceso,
  type ProcesoMasivo,
} from '../../lib/procesosMasivos'

const columnas: ColumnaAdaptable<ErrorProceso>[] = [
  { clave: 'fila', encabezado: 'Fila', render: (error) => error.fila ?? '—' },
  { clave: 'referencia', encabezado: 'Referencia', render: (error) => error.referencia ?? '—' },
  { clave: 'motivo', encabezado: 'Motivo', render: (error) => error.motivo_sanitizado },
]

// Diálogo «Detalle de la importación» (FR-013): resumen del proceso y sus errores paginados.
export function DetalleImportacion({ proceso, onCerrar }: { proceso: ProcesoMasivo; onCerrar: () => void }) {
  const [pagina, setPagina] = useState(1)
  const { errores, total, isLoading, isError, refetch } = useErroresProceso(proceso.id, pagina, `${proceso.estado}:${proceso.procesados}:${proceso.con_errores}`)
  const totalPaginas = Math.max(1, Math.ceil(total / TAMANO_PAGINA_ERRORES))
  const resumen: [string, string][] = [
    ['Nombre', proceso.nombre],
    ['Origen', `${etiquetaTipo(proceso.tipo)} · ${etiquetaFuncionalidad(proceso.funcionalidad)}`],
    ['Estado', etiquetaEstado(proceso)],
    ['Avance', avance(proceso)],
    ['Errores', String(proceso.con_errores)],
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
        <Typography component="h3" variant="subtitle1" sx={{ mb: 1 }}>Errores</Typography>
        {isLoading ? (
          <EstadoCargaPagina lineas={2} />
        ) : isError ? (
          <EstadoError descripcion="No pudimos cargar los errores." reintentar={() => void refetch()} />
        ) : errores.length === 0 ? (
          <EstadoVacio titulo="Este proceso no registró errores." />
        ) : (
          <>
            <ContenidoAdaptable items={errores} columnas={columnas} obtenerClave={(error) => error.id} etiquetaTabla="Errores del proceso" />
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 2 }}>
              <Typography color="text.secondary" aria-live="polite">Página {pagina} de {totalPaginas}</Typography>
              <Stack direction="row" spacing={1}>
                <Button size="small" disabled={pagina <= 1} onClick={() => setPagina((actual) => actual - 1)} aria-label="Página anterior de errores">Anterior</Button>
                <Button size="small" disabled={pagina >= totalPaginas} onClick={() => setPagina((actual) => actual + 1)} aria-label="Página siguiente de errores">Siguiente</Button>
              </Stack>
            </Stack>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCerrar}>Cerrar</Button>
      </DialogActions>
    </Dialog>
  )
}
