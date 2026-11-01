import { Link as RouterLink } from 'react-router'
import { Alert, Box, Button, Card, CardContent, CardHeader, CircularProgress, Stack, Typography } from '@mui/material'
import { EtiquetaEstado } from '../base/EtiquetaEstado'
import { definicionEstado } from '../../lib/estadosComprobante'
import type { ComprobanteDeReparacion } from '../../lib/reparacionComprobante'
import { formatearARS } from '../../lib/serviceTecnico'

type Props = {
  comprobante: ComprobanteDeReparacion | null
  cargando: boolean
  error: string | null
  onReintentar: () => void
  // Enlace a Ventas solo con acceso a `ventas` (FR-004).
  puedeVerEnVentas: boolean
}

const ETIQUETA_TIPO: Record<string, string> = { factura: 'Factura', presupuesto: 'Presupuesto' }

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <Stack spacing={0.25} sx={{ minWidth: 120 }}>
      <Typography variant="caption" color="text.secondary">{etiqueta}</Typography>
      <Box>{children}</Box>
    </Stack>
  )
}

// Tarjeta «Comprobante asociado» del detalle de la reparación (F-SVC-13, FR-004). Sin comprobante vigente no se
// muestra nada (la acción «Generar comprobante» vive junto al total); mientras carga o si falla, lo dice.
export function ComprobanteReparacion({ comprobante, cargando, error, onReintentar, puedeVerEnVentas }: Props) {
  if (cargando && !comprobante) {
    return (
      <Stack direction="row" spacing={1} alignItems="center" role="status" aria-live="polite">
        <CircularProgress size={18} />
        <Typography variant="body2" color="text.secondary">Cargando el comprobante asociado…</Typography>
      </Stack>
    )
  }
  if (error) {
    return (
      <Alert severity="error" action={<Button color="inherit" size="small" onClick={onReintentar}>Reintentar</Button>}>
        {error}
      </Alert>
    )
  }
  if (!comprobante) return null

  const estado = definicionEstado(comprobante.estado)
  return (
    <Card component="section" aria-labelledby="titulo-comprobante-asociado">
      <CardHeader title={<Typography id="titulo-comprobante-asociado" component="h2" variant="t3">Comprobante asociado</Typography>} />
      <CardContent>
        <Stack direction="row" spacing={3} rowGap={2} flexWrap="wrap" alignItems="flex-end">
          <Dato etiqueta="Número"><Typography variant="body1">{comprobante.numero}</Typography></Dato>
          <Dato etiqueta="Tipo"><Typography variant="body1">{ETIQUETA_TIPO[comprobante.tipo] ?? comprobante.tipo}</Typography></Dato>
          <Dato etiqueta="Estado">
            <EtiquetaEstado texto={estado.etiqueta} variante={estado.tono} />
          </Dato>
          <Dato etiqueta="Tienda"><Typography variant="body1">{comprobante.empresa}</Typography></Dato>
          <Dato etiqueta="Total (con IVA)"><Typography variant="body1">{formatearARS(comprobante.total)}</Typography></Dato>
          {puedeVerEnVentas ? (
            <Button component={RouterLink} to={`/ventas/comprobantes/${comprobante.id}`} variant="outlined" size="small">
              Abrir en Ventas
            </Button>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  )
}
