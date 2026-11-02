import { Link as RouterLink } from 'react-router'
import { Alert, AlertTitle, Button, Stack, Typography } from '@mui/material'
import { useEstadoCotizacion } from '../../hooks/useCotizacion'
import { useCotizacionDelDia } from '../../hooks/useCotizacionDelDia'
import { formatearCotizacion, subtituloVigente } from '../../lib/cotizacion'
import { TarjetaInicio } from './TarjetaInicio'

// Dólar (FR-006): cotización vigente con su fecha y, si no hay carga confirmada hoy (`cotizacion_del_dia`;
// una carga pendiente cuenta como no cargada), el aviso «Todavía no se cargó el dólar de hoy». `Cargar
// ahora` solo con edición y lleva a Cotización, donde vive el diálogo (no se duplica acá).
export function TarjetaDolar({ puedeEditar }: { puedeEditar: boolean }) {
  const estado = useEstadoCotizacion()
  const dia = useCotizacionDelDia()
  const reintentar = () => {
    void estado.recargar()
    void dia.recargar()
  }
  const vigente = estado.estado?.vigente ?? null
  return (
    <TarjetaInicio
      titulo="Dólar"
      cargando={estado.cargando || dia.cargando}
      hayError={estado.hayError || dia.hayError}
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
        {dia.delDia && !dia.delDia.cargadaHoy ? (
          <Alert
            severity="warning"
            sx={{ width: '100%' }}
            action={puedeEditar ? <Button color="inherit" variant="outlined" size="small" component={RouterLink} to="/cotizacion">Cargar ahora</Button> : undefined}
          >
            <AlertTitle>Todavía no se cargó el dólar de hoy</AlertTitle>
          </Alert>
        ) : null}
      </Stack>
    </TarjetaInicio>
  )
}
