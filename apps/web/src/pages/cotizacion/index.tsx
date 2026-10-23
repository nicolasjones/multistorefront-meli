import { lazy, Suspense, useState } from 'react'
import { Alert, Button, Snackbar, Stack } from '@mui/material'
import { AvisoCotizacion } from '../../components/cotizacion/AvisoCotizacion'
import { TarjetaVigente } from '../../components/cotizacion/TarjetaVigente'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { useEstadoCotizacion } from '../../hooks/useCotizacion'
import { useCotizacionDelDia } from '../../hooks/useCotizacionDelDia'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { AVISO_COTIZACION_REGISTRADA, type CotizacionConfirmada, avisoCotizacionAplicada } from '../../lib/cotizacion'

// El diálogo (MUI Dialog + formulario) queda fuera de la carga inicial de la pantalla (Principio VI).
const DialogoCargarDolar = lazy(() =>
  import('../../components/cotizacion/DialogoCargarDolar').then((modulo) => ({ default: modulo.DialogoCargarDolar })),
)

// «Cotización del dólar» (F-PRE-02, FR-005/FR-008; Cotizacion.dc.html). La cotización es una sola
// para la organización: no depende de la empresa activa de la barra superior (Principio VIII, no
// aplica). La ruta va envuelta en RequiereAccesoSeccion (`cotizacion_dolar` ≥ lectura); el botón
// «Cargar cotización» solo se ofrece con edición (la base lo exige igual).
export function CotizacionPage() {
  const { estado, cargando, hayError, recargar } = useEstadoCotizacion()
  const { delDia } = useCotizacionDelDia()
  const { nivel } = useNivelSeccion('cotizacion_dolar')
  const [dialogoAbierto, setDialogoAbierto] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const puedeEditar = nivel === 'edicion'

  // El aviso refleja lo que decidió la base: aplicó el recálculo o solo registró la cotización (F-PRE-03, FR-015).
  const alConfirmar = (confirmada: CotizacionConfirmada) => {
    setDialogoAbierto(false)
    setAviso(confirmada.recalculoAplicado ? avisoCotizacionAplicada(confirmada.preciosRecalculados) : AVISO_COTIZACION_REGISTRADA)
    void recargar()
  }

  let contenido
  if (hayError) contenido = <EstadoError descripcion="No pudimos leer la cotización del dólar." reintentar={() => void recargar()} />
  else if (cargando || !estado) contenido = <EstadoCargaPagina />
  else if (!estado.vigente) {
    contenido = (
      <EstadoVacio
        titulo="Todavía no hay una cotización cargada"
        descripcion={puedeEditar ? 'Cargá el dólar del día para calcular los precios de los productos en USD.' : 'Cuando se cargue el dólar del día lo vas a ver acá.'}
      />
    )
  } else contenido = <TarjetaVigente vigente={estado.vigente} productosUsd={estado.productosUsd} delDia={delDia} />

  return (
    <Stack spacing={2}>
      <EncabezadoPagina
        titulo="Cotización del dólar"
        descripcion="Valor que se carga cada día para calcular los precios de los productos en USD."
        contexto={<ContextoOrganizacionActiva />}
        accion={puedeEditar ? <Button variant="contained" onClick={() => setDialogoAbierto(true)}>Cargar cotización</Button> : undefined}
      />
      <AvisoCotizacion />
      {contenido}
      {dialogoAbierto ? (
        <Suspense fallback={null}>
          <DialogoCargarDolar
            abierto
            vigente={estado?.vigente ?? null}
            onCerrar={() => setDialogoAbierto(false)}
            onConfirmada={alConfirmar}
          />
        </Suspense>
      ) : null}
      <Snackbar open={aviso !== null} autoHideDuration={4000} onClose={() => setAviso(null)}>
        <Alert severity="success" onClose={() => setAviso(null)}>{aviso}</Alert>
      </Snackbar>
    </Stack>
  )
}
