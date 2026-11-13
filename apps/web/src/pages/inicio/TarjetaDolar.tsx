import { Suspense, lazy, useState } from 'react'
import { Alert, AlertTitle, Button, Stack, Typography } from '@mui/material'
import { useConfiguracionCotizacion } from '../../hooks/useConfiguracionCotizacion'
import { useEstadoCotizacion } from '../../hooks/useCotizacion'
import { useCotizacionDelDia } from '../../hooks/useCotizacionDelDia'
import { useEmpresasAccesibles } from '../../hooks/useEmpresasAccesibles'
import {
  AVISO_COTIZACION_REGISTRADA,
  type CotizacionConfirmada,
  avisoCotizacionAplicada,
  formatearCotizacion,
  subtituloVigente,
} from '../../lib/cotizacion'
import { TarjetaInicio } from './TarjetaInicio'

// El diálogo (y MUI Dialog con su tabla de vista previa) se baja solo al abrirlo.
const DialogoCargarDolarConImpacto = lazy(() =>
  import('../../components/cotizacion/DialogoCargarDolarConImpacto').then((modulo) => ({ default: modulo.DialogoCargarDolarConImpacto })),
)

// Dólar (FR-006 y F-INI-07, MSF-823): cotización vigente con su fecha y, si no hay carga confirmada hoy
// (`cotizacion_del_dia`; una carga pendiente cuenta como no cargada), el aviso «Todavía no se cargó el dólar de
// hoy» con «Cargar ahora», que abre el diálogo con el impacto por tienda ANTES de guardar. Aviso y botón son solo
// para quien puede editar la cotización (el operador no ve ninguno, CA-INI-07-7). Con alcance «una por empresa» la
// carga es de la empresa activa: en «Todas mis empresas» hay que elegir una antes (como en Cotización).
export function TarjetaDolar({ puedeEditar }: { puedeEditar: boolean }) {
  const config = useConfiguracionCotizacion(true)
  // La carga es de la empresa activa de la barra superior (en «Todas mis empresas» no hay una elegida).
  const { empresas, empresaActivaId } = useEmpresasAccesibles()
  const porEmpresa = config.configuracion?.alcance === 'empresa'
  const empresaId = porEmpresa ? empresaActivaId : null
  const nombreEmpresa = empresas.find((empresa) => empresa.id === empresaId)?.nombre ?? null
  // Hasta saber el alcance no se pide la cotización: evita mostrar la general y saltar a la de la empresa.
  const alcanceListo = !config.cargando
  const estado = useEstadoCotizacion(empresaId, alcanceListo)
  const dia = useCotizacionDelDia(alcanceListo, empresaId)
  // El diálogo guarda la empresa con la que se abrió: si la activa cambia, se cierra sin guardar.
  const [dialogoPara, setDialogoPara] = useState<{ empresaId: string | null } | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  if (dialogoPara && dialogoPara.empresaId !== empresaId) {
    setDialogoPara(null)
    setAviso('Cambiaste de empresa: el diálogo de carga se cerró sin guardar.')
  }
  const sinEmpresaElegida = porEmpresa && empresaId === null

  const reintentar = () => {
    void config.recargar()
    void estado.recargar()
    void dia.recargar()
  }
  // El aviso refleja lo que decidió la base y se actualiza sin recargar la página.
  const alConfirmar = (confirmada: CotizacionConfirmada) => {
    setDialogoPara(null)
    setAviso(confirmada.recalculoAplicado ? avisoCotizacionAplicada(confirmada.preciosRecalculados) : AVISO_COTIZACION_REGISTRADA)
    void estado.recargar()
    void dia.recargar()
  }
  const vigente = estado.estado?.vigente ?? null
  const sinCargarHoy = dia.delDia !== null && !dia.delDia.cargadaHoy
  return (
    <TarjetaInicio
      titulo="Dólar"
      cargando={config.cargando || estado.cargando || dia.cargando}
      hayError={config.hayError || estado.hayError || dia.hayError}
      onReintentar={reintentar}
    >
      <Stack spacing={1.5} alignItems="flex-start">
        {vigente ? (
          <div>
            <Typography variant="t2" component="p">{formatearCotizacion(vigente.valor)}</Typography>
            <Typography variant="s" color="text.secondary">{subtituloVigente(vigente)}</Typography>
          </div>
        ) : (
          <Typography>Todavía no hay una cotización vigente.</Typography>
        )}
        {aviso ? <Alert severity="success" sx={{ width: '100%' }} onClose={() => setAviso(null)}>{aviso}</Alert> : null}
        {puedeEditar && sinCargarHoy ? (
          <Alert
            severity="warning"
            sx={{ width: '100%' }}
            action={
              <Button color="inherit" variant="outlined" size="small" disabled={sinEmpresaElegida} onClick={() => setDialogoPara({ empresaId })}>
                Cargar ahora
              </Button>
            }
          >
            <AlertTitle>Todavía no se cargó el dólar de hoy</AlertTitle>
            {sinEmpresaElegida ? 'Elegí una empresa en la barra superior para cargar su dólar.' : null}
          </Alert>
        ) : null}
      </Stack>
      {dialogoPara ? (
        <Suspense fallback={null}>
          <DialogoCargarDolarConImpacto
            abierto
            vigente={vigente}
            aplicada={estado.estado?.aplicada ?? null}
            onCerrar={() => setDialogoPara(null)}
            onConfirmada={alConfirmar}
            empresaId={empresaId}
            nombreEmpresa={nombreEmpresa}
            confirmacionPct={config.configuracion?.confirmacionPct}
          />
        </Suspense>
      ) : null}
    </TarjetaInicio>
  )
}
