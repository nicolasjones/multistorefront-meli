import { useState } from 'react'
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, LinearProgress, Paper, Stack, Typography } from '@mui/material'
import { EstadoCargaPagina, EstadoError, EstadoExito, EstadoVacio } from '../../components/estados/EstadosPagina'
import { useExportacionTotal } from '../../hooks/useExportacionTotal'
import { ErrorExportacionTotal, descargarExportacionTotal, solicitarExportacionTotal, type ProcesoExportacionTotal } from '../../lib/exportacionTotal'
import { estaAbierto, formatearFecha, porcentaje } from '../../lib/procesosMasivos'

type Props = {
  // Se llama después de pedir la exportación para que la tabla del centro muestre el proceso nuevo.
  onSolicitada: () => void
}

function Estado({ ultima, descargando, errorDescarga, onDescargar }: {
  ultima: ProcesoExportacionTotal
  descargando: boolean
  errorDescarga: string | null
  onDescargar: () => void
}) {
  const pedida = `Pedida el ${formatearFecha(ultima.creado_en)}.`
  if (estaAbierto(ultima.estado)) {
    const pct = porcentaje(ultima)
    return (
      <Box>
        <Typography fontWeight={600}>Estamos preparando tu exportación.</Typography>
        <Typography color="text.secondary">
          {ultima.total === null ? 'Empezando…' : `${ultima.procesados} de ${ultima.total} grupos de datos listos.`} {pedida} Podés seguir con tu trabajo: te avisamos acá y en la tabla de abajo.
        </Typography>
        <LinearProgress variant={pct === null ? 'indeterminate' : 'determinate'} value={pct ?? 0} aria-label="Avance de la exportación total" sx={{ mt: 1 }} />
      </Box>
    )
  }
  if (ultima.estado === 'completado' || ultima.estado === 'con_errores') {
    return (
      <Stack spacing={1}>
        <EstadoExito
          titulo="Tu exportación está lista."
          descripcion={`${pedida} ${ultima.estado === 'con_errores' ? 'Algunos grupos de datos no se pudieron leer completos: lo ves en el detalle del proceso, en la tabla de abajo.' : 'Incluye todos los datos de la organización.'}`}
          accion={<Button color="inherit" onClick={onDescargar} disabled={descargando}>Descargar</Button>}
        />
        {errorDescarga ? <Alert severity="error">{errorDescarga}</Alert> : null}
      </Stack>
    )
  }
  if (ultima.estado === 'fallido') {
    return <EstadoError titulo="La última exportación no pudo completarse." descripcion={`${pedida} Pedila de nuevo; si vuelve a fallar, avisale a quien administra la plataforma.`} />
  }
  return <EstadoVacio titulo="La última exportación se canceló." descripcion={`${pedida} Podés pedir otra cuando quieras.`} />
}

// Bloque «Exportar todos los datos» de `/importaciones` (F-OPS-06, FR-039). Independiente de la empresa activa:
// la exportación es de toda la organización. Solo se monta para administradores (lo decide la pantalla).
export function ExportacionTotal({ onSolicitada }: Props) {
  const { ultima, isLoading, isError, refetch, refrescar } = useExportacionTotal(true)
  const [confirmando, setConfirmando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [errorSolicitud, setErrorSolicitud] = useState<string | null>(null)
  const [descargando, setDescargando] = useState(false)
  const [errorDescarga, setErrorDescarga] = useState<string | null>(null)

  const abierta = ultima !== null && estaAbierto(ultima.estado)

  const confirmar = async () => {
    setEnviando(true)
    setErrorSolicitud(null)
    try {
      await solicitarExportacionTotal()
    } catch (error) {
      setEnviando(false)
      setErrorSolicitud(error instanceof ErrorExportacionTotal ? error.message : 'No pudimos pedir la exportación. Probá de nuevo.')
      return
    }
    setEnviando(false)
    setConfirmando(false)
    await refrescar()
    onSolicitada()
  }

  const descargar = async () => {
    if (!ultima) return
    setDescargando(true)
    setErrorDescarga(null)
    try {
      await descargarExportacionTotal(ultima)
    } catch (error) {
      setErrorDescarga(error instanceof ErrorExportacionTotal ? error.message : 'No pudimos preparar la descarga. Intentá de nuevo.')
    }
    setDescargando(false)
  }

  return (
    <Paper variant="outlined" component="section" aria-labelledby="exportacion-total-titulo" sx={{ p: 2, mb: 3 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'flex-start' }}>
        <Box>
          <Typography id="exportacion-total-titulo" component="h2" variant="h6">Exportar todos los datos</Typography>
          <Typography color="text.secondary">
            Descargá toda la información de la organización en un archivo ZIP, con una planilla por cada tipo de dato. No incluye contraseñas ni claves.
          </Typography>
        </Box>
        <Button variant="contained" onClick={() => { setErrorSolicitud(null); setConfirmando(true) }} disabled={abierta} sx={{ flexShrink: 0 }}>
          {abierta ? 'Exportación en curso' : 'Exportar todos los datos'}
        </Button>
      </Stack>
      <Box sx={{ mt: 2 }} aria-live="polite">
        {isLoading ? (
          <EstadoCargaPagina lineas={1} etiqueta="Cargando la exportación total" />
        ) : isError ? (
          <EstadoError descripcion="No pudimos ver el estado de la exportación total." reintentar={() => void refetch()} />
        ) : ultima ? (
          <Estado ultima={ultima} descargando={descargando} errorDescarga={errorDescarga} onDescargar={() => void descargar()} />
        ) : (
          <EstadoVacio titulo="Todavía no pediste una exportación total." descripcion="Cuando la pidas, vas a ver acá cómo avanza y vas a poder descargarla." />
        )}
      </Box>

      {confirmando ? (
        <Dialog open onClose={enviando ? undefined : () => setConfirmando(false)} aria-labelledby="exportacion-total-confirmar-titulo" fullWidth maxWidth="sm">
          <DialogTitle id="exportacion-total-confirmar-titulo">¿Exportar todos los datos de la organización?</DialogTitle>
          <DialogContent>
            <DialogContentText>
              Vamos a preparar un archivo ZIP con una planilla CSV por cada tipo de dato (productos, clientes, ventas, stock y más), de todas las tiendas. No incluye contraseñas, claves ni datos de acceso.
            </DialogContentText>
            <DialogContentText sx={{ mt: 1 }}>
              Se genera en segundo plano y podés seguirlo en esta pantalla. Solo queda disponible el último archivo: al terminar una exportación nueva, se reemplaza la anterior. El archivo tiene información sensible: guardalo con cuidado.
            </DialogContentText>
            {errorSolicitud ? <Alert severity="error" sx={{ mt: 2 }}>{errorSolicitud}</Alert> : null}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirmando(false)} disabled={enviando}>Cancelar</Button>
            <Button variant="contained" onClick={() => void confirmar()} disabled={enviando}>Sí, exportar</Button>
          </DialogActions>
        </Dialog>
      ) : null}
    </Paper>
  )
}
