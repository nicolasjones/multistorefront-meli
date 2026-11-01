import { Box, Button, Card, CardContent, Stack, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import { Link as RouterLink } from 'react-router'
import { EtiquetaEstado } from '../base/EtiquetaEstado'
import { EstadoCargaPagina } from '../estados/EstadosPagina'
import type { CuentaCobroMasUsada } from '../../lib/ventas/pagos'

// La pantalla y el diálogo de cuentas de cobro son de MSF-139 (F-VTA-03): esta tarjeta solo
// resume y enlaza, no los modifica (FR-027).
export const RUTA_CUENTAS_COBRO = '/ventas/cuentas-cobro'

type Props = {
  cuentas: CuentaCobroMasUsada[]
  cargando: boolean
}

// Texto de la tarjeta (FR-027): cuántas cuentas hay cargadas y para qué sirven las marcadas
// «No usar». El número sale de la base (`total_cuentas` de `cuentas_cobro_mas_usadas`).
function textoResumenCuentas(total: number): string {
  return `${total} cargadas · se muestran las más usadas. Las marcadas como No usar no se ofrecen al cargar un comprobante, pero conservan su historial.`
}

// Sub-texto de cada cuenta: el banco y cuánto se usó. No muestra CBU ni CUIT: la tarjeta es un
// resumen y los datos bancarios completos viven en la pantalla de cuentas de cobro.
function subTextoCuenta(cuenta: Pick<CuentaCobroMasUsada, 'banco' | 'usos'>): string {
  const banco = cuenta.banco?.trim() ?? ''
  const usos = cuenta.usos === 1 ? '1 pago' : `${cuenta.usos} pagos`
  return banco === '' ? `${usos} · sin banco` : `${banco} · ${usos}`
}

// Tarjeta «Cuentas de cobro» al pie de la pantalla Pagos (F-VTA-13, FR-027). Muestra las cuentas
// más usadas con su marca «No usar» y los botones para ver todas o crear una nueva.
export function CuentasCobroResumen({ cuentas, cargando }: Props) {
  const total = cuentas.length > 0 ? cuentas[0].total_cuentas : 0
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          justifyContent="space-between"
          alignItems={{ xs: 'stretch', md: 'flex-start' }}
          sx={{ mb: 2 }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography component="h2" variant="t3">Cuentas de cobro</Typography>
            {cuentas.length > 0 ? (
              <Typography variant="s" color="text.secondary">{textoResumenCuentas(total)}</Typography>
            ) : null}
          </Box>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            <Button size="small" variant="outlined" component={RouterLink} to={RUTA_CUENTAS_COBRO}>
              Ver todas las cuentas de cobro
            </Button>
            <Button size="small" variant="outlined" component={RouterLink} to={RUTA_CUENTAS_COBRO} startIcon={<AddIcon />}>
              Nueva cuenta
            </Button>
          </Stack>
        </Stack>

        {cargando ? <EstadoCargaPagina lineas={2} /> : null}
        {!cargando && cuentas.length === 0 ? (
          <Typography variant="s" color="text.secondary">Todavía no hay cuentas de cobro cargadas.</Typography>
        ) : null}
        {cuentas.length > 0 ? (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' },
              columnGap: 3,
            }}
          >
            {cuentas.map((cuenta) => (
              <Box key={cuenta.id} sx={{ borderBottom: 1, borderColor: 'divider', pb: 1, mb: 1 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                  <Typography component="p" variant="b" sx={{ fontWeight: 600 }}>{cuenta.nombre}</Typography>
                  {cuenta.activa ? null : <EtiquetaEstado texto="No usar" variante="error" />}
                </Stack>
                <Typography component="p" variant="xs" color="text.secondary">{subTextoCuenta(cuenta)}</Typography>
              </Box>
            ))}
          </Box>
        ) : null}
      </CardContent>
    </Card>
  )
}
