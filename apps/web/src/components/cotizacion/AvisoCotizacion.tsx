import { lazy, Suspense, useState } from 'react'
import { Alert, AlertTitle, Button, Snackbar } from '@mui/material'
import { useEstadoCotizacion } from '../../hooks/useCotizacion'
import { useCotizacionDelDia } from '../../hooks/useCotizacionDelDia'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import {
  AVISO_COTIZACION_REGISTRADA,
  type CotizacionConfirmada,
  avisoCotizacionAplicada,
  formatearCotizacion,
  subtituloVigente,
} from '../../lib/cotizacion'

// El diálogo (MUI Dialog + formulario) queda fuera de la carga inicial de la portada (Principio VI).
const DialogoCargarDolar = lazy(() =>
  import('./DialogoCargarDolar').then((modulo) => ({ default: modulo.DialogoCargarDolar })),
)

// Aviso «Todavía no se cargó el dólar de hoy» (F-PRE-05, FR-020; Cotizacion.dc.html). Se monta en la
// pantalla de Cotización y en la portada (FR-021). Solo lo evalúa quien tiene `cotizacion_dolar` ≥
// lectura (la base lo exige igual); «Cargar ahora» exige edición y abre el diálogo de F-PRE-02.
// La cotización es de la organización, no de la empresa activa (Principio VIII: no aplica).
export function AvisoCotizacion() {
  const { nivel } = useNivelSeccion('cotizacion_dolar')
  if (nivel !== 'lectura' && nivel !== 'edicion') return null
  return <AvisoCotizacionDelDia puedeEditar={nivel === 'edicion'} />
}

function AvisoCotizacionDelDia({ puedeEditar }: { puedeEditar: boolean }) {
  const estado = useEstadoCotizacion()
  const dia = useCotizacionDelDia()
  const [dialogoAbierto, setDialogoAbierto] = useState(false)
  const [confirmacion, setConfirmacion] = useState<string | null>(null)

  const reintentar = () => {
    void estado.recargar()
    void dia.recargar()
  }

  if (estado.hayError || dia.hayError) {
    return (
      <Alert severity="error" action={<Button color="inherit" onClick={reintentar}>Reintentar</Button>}>
        No pudimos comprobar si se cargó el dólar de hoy.
      </Alert>
    )
  }
  if (estado.cargando || dia.cargando || !estado.estado || !dia.delDia) return null

  const vigente = estado.estado.vigente
  const sinCargar = !dia.delDia.cargadaHoy
  const alConfirmar = (confirmada: CotizacionConfirmada) => {
    setDialogoAbierto(false)
    setConfirmacion(confirmada.recalculoAplicado ? avisoCotizacionAplicada(confirmada.preciosRecalculados) : AVISO_COTIZACION_REGISTRADA)
    void dia.recargar()
  }

  return (
    <>
      {sinCargar ? (
        <Alert
          severity="warning"
          action={puedeEditar ? <Button color="inherit" variant="outlined" size="small" onClick={() => setDialogoAbierto(true)}>Cargar ahora</Button> : undefined}
        >
          <AlertTitle>Todavía no se cargó el dólar de hoy</AlertTitle>
          {vigente
            ? `Los precios en dólares se siguen calculando con ${formatearCotizacion(vigente.valor)} (${subtituloVigente(vigente)}).`
            : 'Todavía no hay una cotización vigente para calcular los precios en dólares.'}
        </Alert>
      ) : null}
      {dialogoAbierto ? (
        <Suspense fallback={null}>
          <DialogoCargarDolar abierto vigente={vigente} onCerrar={() => setDialogoAbierto(false)} onConfirmada={alConfirmar} />
        </Suspense>
      ) : null}
      <Snackbar open={confirmacion !== null} autoHideDuration={4000} onClose={() => setConfirmacion(null)}>
        <Alert severity="success" onClose={() => setConfirmacion(null)}>{confirmacion}</Alert>
      </Snackbar>
    </>
  )
}
