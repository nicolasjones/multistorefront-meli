import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, CardContent, CardHeader, Snackbar, Stack, Typography } from '@mui/material'
import type { Comprobante } from '../../lib/ventas'
import {
  MENSAJE_ENVIADO_A_IMPRIMIR,
  documentosElegibles,
  motivoNoImprimible,
  type TipoDocumento,
} from '../../lib/ventasImpresion'

// El diálogo y su motor de consulta pesan poco, pero solo se usan al imprimir: carga diferida (Principio VI).
const ImprimirComprobanteDialog = lazy(() =>
  import('./ImprimirComprobanteDialog').then((modulo) => ({ default: modulo.ImprimirComprobanteDialog })),
)

export const AVISO_CAMBIO_DE_TIENDA = 'Cambiaste de tienda: cerramos la impresión para no mezclar datos de dos tiendas.'

type Props = {
  comprobante: Comprobante
  // `lectura` alcanza para imprimir (FR-001): la pantalla pasa false si la persona no ve Ventas.
  puedeImprimir: boolean
  // Empresa activa de la barra superior (Principio VIII, FR-014).
  empresaActivaId: string | null
  // Documento con el diálogo abierto, o null. Lo controla la pantalla porque el botón «Imprimir» de la
  // cabecera y «Imprimir remito» de esta tarjeta abren el mismo diálogo.
  dialogo: TipoDocumento | null
  onAbrir: (tipo: TipoDocumento) => void
  onCerrar: () => void
}

// Tarjeta «Documentos» y diálogo «Imprimir comprobante» (F-VTA-19, FR-011, FR-012, FR-014). Si el comprobante
// no es imprimible no se ofrecen los botones y se indica el motivo. Al cambiar la empresa activa con el
// diálogo abierto, se cierra con aviso: jamás se imprime con datos de otra tienda.
export function DocumentosComprobante({ comprobante, puedeImprimir, empresaActivaId, dialogo, onAbrir, onCerrar }: Props) {
  const [mensaje, setMensaje] = useState<string | null>(null)
  const empresaAlAbrir = useRef<string | null>(empresaActivaId)
  const abierto = dialogo !== null

  // La empresa «de referencia» es la vigente al abrir; un cambio posterior cierra el diálogo.
  useEffect(() => {
    if (!abierto) {
      empresaAlAbrir.current = empresaActivaId
      return
    }
    if (empresaActivaId !== empresaAlAbrir.current) {
      empresaAlAbrir.current = empresaActivaId
      onCerrar()
      setMensaje(AVISO_CAMBIO_DE_TIENDA)
    }
  }, [abierto, empresaActivaId, onCerrar])

  const elegibles = documentosElegibles(comprobante)
  const imprimible = puedeImprimir && elegibles.length > 0
  const motivo = puedeImprimir ? motivoNoImprimible(comprobante) : null

  return (
    <>
      <Card variant="outlined">
        <CardHeader title={<Typography component="h2" variant="t3">Documentos</Typography>} />
        <CardContent>
          <Stack spacing={1.5} alignItems="flex-start">
            {motivo ? <Typography variant="body2" color="text.secondary">{motivo}</Typography> : null}
            {imprimible ? (
              <Button type="button" variant="outlined" size="small" onClick={() => onAbrir('remito')}>
                Imprimir remito
              </Button>
            ) : null}
          </Stack>
        </CardContent>
      </Card>

      {abierto && imprimible ? (
        <Suspense fallback={null}>
          <ImprimirComprobanteDialog
            open
            comprobante={comprobante}
            tipoInicial={dialogo}
            onCerrar={onCerrar}
            onImpreso={() => {
              onCerrar()
              setMensaje(MENSAJE_ENVIADO_A_IMPRIMIR)
            }}
          />
        </Suspense>
      ) : null}

      <Snackbar open={mensaje !== null} autoHideDuration={4000} onClose={() => setMensaje(null)}>
        <Alert severity={mensaje === AVISO_CAMBIO_DE_TIENDA ? 'info' : 'success'} onClose={() => setMensaje(null)}>
          {mensaje}
        </Alert>
      </Snackbar>
    </>
  )
}
