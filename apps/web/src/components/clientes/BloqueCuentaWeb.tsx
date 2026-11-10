import { Box, Button, Stack, Tab, Tabs, Typography } from '@mui/material'
import { EtiquetaEstado } from '../base/EtiquetaEstado'
import {
  formatearUltimoIngreso,
  TEXTOS_ESTADO_CUENTA_WEB,
  type TiendaCuentaWeb,
} from '../../lib/cuentasCliente'

type Props = {
  tiendas: ReadonlyArray<TiendaCuentaWeb>
  seleccionada: string | null
  onSeleccionar: (empresaId: string) => void
  puedeEditar?: boolean
  procesando?: string | null
  onCrear?: (empresaId: string) => void
  onRestablecer?: (empresaId: string) => void
  onSuspender?: (empresaId: string) => void
  onReactivar?: (empresaId: string) => void
  onHabilitar?: (empresaId: string) => void
}

const MENSAJE_SIN_CORREO = 'Cargá un correo para crear la cuenta.'

// Bloque «Cuenta web» de la ficha (FR-013): una pestaña por tienda con el chip
// y el texto del estado, el correo de acceso y el último ingreso (si hay
// cuenta), y las acciones que corresponden a ese estado. «Crear cuenta web» se
// deshabilita con el motivo cuando el cliente no tiene correo (FR-003).
export function BloqueCuentaWeb({
  tiendas,
  seleccionada,
  onSeleccionar,
  puedeEditar = false,
  procesando = null,
  onCrear,
  onRestablecer,
  onSuspender,
  onReactivar,
  onHabilitar,
}: Props) {
  const tienda = tiendas.find((fila) => fila.empresaId === seleccionada) ?? tiendas[0] ?? null

  return (
    <Box>
      <Typography component="h2" variant="h6">Cuenta web</Typography>
      {tiendas.length === 0 ? (
        <Typography color="text.secondary">La organización todavía no tiene tiendas cargadas.</Typography>
      ) : (
        <Stack spacing={1.5}>
          <Tabs
            value={tienda?.empresaId ?? false}
            onChange={(_, valor: string) => onSeleccionar(valor)}
            variant="scrollable"
            scrollButtons="auto"
            aria-label="Cuenta web por tienda"
          >
            {tiendas.map((fila) => <Tab key={fila.empresaId} value={fila.empresaId} label={fila.nombre} />)}
          </Tabs>
          {tienda ? (
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <EtiquetaEstado texto={TEXTOS_ESTADO_CUENTA_WEB[tienda.estado].etiqueta} variante={TEXTOS_ESTADO_CUENTA_WEB[tienda.estado].variante} />
                <Typography variant="body2">{TEXTOS_ESTADO_CUENTA_WEB[tienda.estado].descripcion}</Typography>
              </Stack>

              {tienda.estado === 'activa' || tienda.estado === 'suspendida' ? (
                <Box>
                  <Typography component="p" variant="caption" color="text.secondary">Correo de acceso</Typography>
                  <Typography component="p">{tienda.correo || '—'}</Typography>
                  <Typography component="p" variant="caption" color="text.secondary">
                    Último ingreso: {formatearUltimoIngreso(tienda.ultimoIngreso)}
                  </Typography>
                </Box>
              ) : null}

              {puedeEditar ? (
                <Stack spacing={1} alignItems="flex-start">
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {tienda.estado === 'activa' ? (
                      <>
                        <Button size="small" variant="outlined" disabled={procesando === tienda.empresaId} onClick={() => onRestablecer?.(tienda.empresaId)}>
                          Restablecer clave
                        </Button>
                        <Button size="small" color="warning" disabled={procesando === tienda.empresaId} onClick={() => onSuspender?.(tienda.empresaId)}>
                          Suspender acceso
                        </Button>
                      </>
                    ) : tienda.estado === 'suspendida' ? (
                      <Button size="small" variant="contained" disabled={procesando === tienda.empresaId} onClick={() => onReactivar?.(tienda.empresaId)}>
                        Reactivar acceso
                      </Button>
                    ) : tienda.estado === 'sin_cuenta' ? (
                      <Button
                        size="small"
                        variant="contained"
                        disabled={!tienda.correo || procesando === tienda.empresaId}
                        onClick={() => onCrear?.(tienda.empresaId)}
                      >
                        Crear cuenta web
                      </Button>
                    ) : (
                      <Button size="small" variant="contained" disabled={procesando === tienda.empresaId} onClick={() => onHabilitar?.(tienda.empresaId)}>
                        Habilitar en {tienda.nombre}
                      </Button>
                    )}
                  </Stack>
                  {tienda.estado === 'sin_cuenta' && !tienda.correo ? (
                    <Typography variant="caption" color="text.secondary">{MENSAJE_SIN_CORREO}</Typography>
                  ) : null}
                </Stack>
              ) : null}
            </Stack>
          ) : null}
        </Stack>
      )}
    </Box>
  )
}
