import { Link as RouterLink } from 'react-router'
import { Button, Stack, Typography } from '@mui/material'
import { leerConteoStock, pluralizar } from '../../lib/inicio'
import { TarjetaInicio } from './TarjetaInicio'
import { useLecturaInicio } from './useLecturaInicio'

// Stock hoy (FR-004): productos sin stock y con stock bajo según `stock_estados`, con enlace a Stock.
// El padre la monta solo con stock ≥ lectura (FR-007): sin permiso ni se renderiza ni se consulta.
export function TarjetaStock() {
  const { cargando, hayError, datos, recargar } = useLecturaInicio(leerConteoStock)
  return (
    <TarjetaInicio titulo="Stock hoy" cargando={cargando} hayError={hayError} onReintentar={() => void recargar()}>
      {datos ? (
        <Stack spacing={1} alignItems="flex-start">
          <Typography>{pluralizar(datos.sinStock, 'producto sin stock', 'productos sin stock')}</Typography>
          <Typography>{pluralizar(datos.stockBajo, 'producto con stock bajo', 'productos con stock bajo')}</Typography>
          <Button component={RouterLink} to="/stock" size="small" variant="outlined">Ver stock</Button>
        </Stack>
      ) : null}
    </TarjetaInicio>
  )
}
