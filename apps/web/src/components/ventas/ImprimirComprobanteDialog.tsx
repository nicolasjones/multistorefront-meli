import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  FormControlLabel,
  Link,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material'
import type { Comprobante } from '../../lib/ventas'
import {
  ETIQUETA_DOCUMENTO,
  MENSAJE_PREPARANDO,
  TEXTO_IMPRIMIR,
  TITULO_IMPRIMIR,
  documentosElegibles,
  esCancelacion,
  esperarDocumento,
  mensajeDeErrorImpresion,
  solicitarDocumento,
  urlFirmadaDocumento,
  type TipoDocumento,
} from '../../lib/ventasImpresion'
import { MENSAJE_ERROR_REGISTRO, registrarImpresion } from '../../lib/ventasImpresiones'
import { TituloDialogo } from '../base/TituloDialogo'

type Props = {
  open: boolean
  comprobante: Comprobante
  // Documento preseleccionado: «Imprimir remito» abre el diálogo con el remito elegido.
  tipoInicial?: TipoDocumento
  onCerrar: () => void
  // El PDF se abrió: la pantalla confirma con «Enviado a imprimir».
  onImpreso: (tipo: TipoDocumento) => void
  /** La impresión ya quedó registrada (aunque el navegador bloquee el popup): refresca las marcas sin cerrar. */
  onRegistrado?: () => void
}

// Diálogo «Imprimir comprobante» (F-VTA-19, FR-006, FR-011). Muestra solo los documentos que aplican al
// comprobante, pide el PDF a la base, consulta su avance sin recargar y abre el archivo con una URL firmada.
// El contenido se monta al abrir: cada apertura parte limpia. La carga es diferida desde la pantalla.
export function ImprimirComprobanteDialog({ open, comprobante, tipoInicial, onCerrar, onImpreso, onRegistrado }: Props) {
  return (
    <Dialog open={open} onClose={onCerrar} fullWidth maxWidth="xs" aria-labelledby="titulo-imprimir-comprobante">
      <Contenido comprobante={comprobante} tipoInicial={tipoInicial} onCerrar={onCerrar} onImpreso={onImpreso} onRegistrado={onRegistrado} />
    </Dialog>
  )
}

type Estado = { fase: 'elegir' } | { fase: 'preparando' } | { fase: 'error'; mensaje: string } | { fase: 'bloqueado'; url: string }

function Contenido({ comprobante, tipoInicial, onCerrar, onImpreso, onRegistrado }: Omit<Props, 'open'>) {
  const elegibles = documentosElegibles(comprobante)
  const [tipo, setTipo] = useState<TipoDocumento | null>(
    tipoInicial && elegibles.includes(tipoInicial) ? tipoInicial : (elegibles[0] ?? null),
  )
  const [estado, setEstado] = useState<Estado>({ fase: 'elegir' })
  const control = useRef<AbortController | null>(null)

  // Cerrar el diálogo (o cambiar de tienda, que lo desmonta) corta la consulta del avance.
  useEffect(() => () => control.current?.abort(), [])

  const imprimir = async () => {
    if (!tipo || estado.fase === 'preparando') return
    control.current?.abort()
    const actual = new AbortController()
    control.current = actual
    setEstado({ fase: 'preparando' })
    try {
      let documento = await solicitarDocumento(comprobante.id, tipo)
      if (documento.estado !== 'generado') documento = await esperarDocumento(documento.id, { signal: actual.signal })
      if (!documento.ruta) throw new Error('El documento generado no trae ruta')
      const url = await urlFirmadaDocumento(documento.ruta)
      if (actual.signal.aborted) return
      // FR-034: se marca como impreso solo con el documento ya disponible (si algo falló antes, no llega acá).
      // Si el registro falla no se abre el PDF: se avisa y «Reintentar» pide el mismo documento y registra una vez.
      try {
        await registrarImpresion(documento.id)
      } catch (falla) {
        console.error(MENSAJE_ERROR_REGISTRO, falla)
        if (actual.signal.aborted) return
        setEstado({ fase: 'error', mensaje: MENSAJE_ERROR_REGISTRO })
        return
      }
      onRegistrado?.()
      if (actual.signal.aborted) return
      // Sin `noopener` en la llamada (devolvería null aunque abra) para poder detectar el bloqueo del navegador.
      const ventana = window.open(url, '_blank')
      if (ventana) {
        ventana.opener = null
        // Se puede imprimir otra vez sin límite (FR-035): el diálogo vuelve a quedar listo.
        setEstado({ fase: 'elegir' })
        onImpreso(tipo)
      } else {
        setEstado({ fase: 'bloqueado', url })
      }
    } catch (falla) {
      if (esCancelacion(falla) || actual.signal.aborted) return
      setEstado({ fase: 'error', mensaje: mensajeDeErrorImpresion(falla) })
    }
  }

  const preparando = estado.fase === 'preparando'

  return (
    <>
      <TituloDialogo id="titulo-imprimir-comprobante" onCerrar={onCerrar}>
        {TITULO_IMPRIMIR}
      </TituloDialogo>
      <DialogContent>
        <Stack spacing={1.5}>
          <Typography variant="body2">{TEXTO_IMPRIMIR}</Typography>
          <RadioGroup
            aria-label="Documento a imprimir"
            value={tipo ?? ''}
            onChange={(evento) => setTipo(evento.target.value as TipoDocumento)}
          >
            {elegibles.map((candidato) => (
              <FormControlLabel
                key={candidato}
                value={candidato}
                disabled={preparando}
                control={<Radio />}
                sx={{ alignItems: 'flex-start', border: 1, borderColor: 'divider', borderRadius: 1, m: 0, mb: 1, p: 1 }}
                label={
                  <Box sx={{ pt: 0.75 }}>
                    <Typography variant="body2" component="span" sx={{ fontWeight: 600, display: 'block' }}>
                      {ETIQUETA_DOCUMENTO[candidato].etiqueta}
                      {candidato === 'factura' ? ` ${comprobante.numero}` : ''}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {ETIQUETA_DOCUMENTO[candidato].subtitulo}
                    </Typography>
                  </Box>
                }
              />
            ))}
          </RadioGroup>
          {preparando ? (
            <Alert severity="info" role="status">
              {MENSAJE_PREPARANDO}
            </Alert>
          ) : null}
          {estado.fase === 'error' ? (
            <Alert
              severity="error"
              action={
                <Button color="inherit" size="small" onClick={() => void imprimir()}>
                  Reintentar
                </Button>
              }
            >
              {estado.mensaje}
            </Alert>
          ) : null}
          {estado.fase === 'bloqueado' ? (
            <Alert severity="warning">
              Tu navegador bloqueó la ventana del documento.{' '}
              <Link href={estado.url} target="_blank" rel="noopener noreferrer" onClick={() => tipo && onImpreso(tipo)}>
                Abrir documento
              </Link>
            </Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCerrar}>Cancelar</Button>
        <Button variant="contained" onClick={() => void imprimir()} disabled={!tipo || preparando}>
          Imprimir
        </Button>
      </DialogActions>
    </>
  )
}
