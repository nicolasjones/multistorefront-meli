import { Box, Chip, FormControlLabel, Stack, Switch, Typography } from '@mui/material'
import { TEXTOS_ESTADO_CUENTA_WEB, type EstadoCuentaWeb, type TiendaCuentaWeb } from '../../lib/cuentasCliente'

type Props = {
  tiendas: ReadonlyArray<Pick<TiendaCuentaWeb, 'empresaId' | 'nombre' | 'habilitada' | 'estado'>>
  puedeEditar?: boolean
  procesando?: string | null
  onCambiarHabilitada?: (empresaId: string, habilitada: boolean) => void
}

// Bloque «Tiendas» de la ficha (FR-012): por tienda, el interruptor
// «Habilitado en la tienda», la etiqueta, el texto de compra y el chip del
// estado de la cuenta web. Deshabilitar no borra la cuenta: el estado deriva
// «No habilitado» (FR-010).
export function BloqueTiendas({ tiendas, puedeEditar = false, procesando = null, onCambiarHabilitada }: Props) {
  return (
    <Box>
      <Typography component="h2" variant="h6">Tiendas</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        El cliente es de la organización. Acá elegís en qué tiendas puede comprar.
      </Typography>
      {tiendas.length === 0 ? (
        <Typography color="text.secondary">La organización todavía no tiene tiendas cargadas.</Typography>
      ) : (
        <Stack spacing={1}>
          {tiendas.map((tienda) => (
            <Box
              key={tienda.empresaId}
              sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', p: 1.25, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}
            >
              <FormControlLabel
                sx={{ m: 0 }}
                label={tienda.nombre}
                control={
                  <Switch
                    checked={tienda.habilitada}
                    disabled={!puedeEditar || procesando === tienda.empresaId}
                    onChange={(evento) => onCambiarHabilitada?.(tienda.empresaId, evento.target.checked)}
                    inputProps={{ 'aria-label': `Habilitado en la tienda: ${tienda.nombre}`, role: 'switch' }}
                  />
                }
              />
              <Typography variant="body2" sx={{ flex: 1, minWidth: 160 }}>
                {tienda.habilitada ? 'Compra con su tipo y escala' : 'No ve ni compra en esta tienda'}
              </Typography>
              <Chip
                size="small"
                variant={tienda.estado === 'sin_cuenta' || tienda.estado === 'no_habilitado' ? 'outlined' : 'filled'}
                color={tienda.estado === 'activa' ? 'success' : tienda.estado === 'suspendida' ? 'warning' : 'default'}
                label={TEXTOS_ESTADO_CUENTA_WEB[tienda.estado as EstadoCuentaWeb].etiqueta}
              />
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  )
}
