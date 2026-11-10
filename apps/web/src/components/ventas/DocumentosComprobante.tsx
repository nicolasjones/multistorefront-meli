import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, CardContent, CardHeader, Snackbar, Stack, Typography } from '@mui/material'
import CheckBoxIcon from '@mui/icons-material/CheckBox'
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank'
import type { Comprobante } from '../../lib/ventas'
import {
  MENSAJE_ERROR_MARCAS,
  textoMarca,
  ultimasImpresiones,
  type ImpresionComprobante,
  type TipoDocumentoImpreso,
} from '../../lib/ventasImpresiones'
import {
  MENSAJE_ENVIADO_A_IMPRIMIR,
  documentosElegibles,
  esCancelacion,
  motivoNoImprimible,
  type TipoDocumento,
} from '../../lib/ventasImpresion'
import {
  ETIQUETA_ENVIAR_CORREO,
  MENSAJE_ENVIANDO,
  MENSAJE_ERROR_MARCA_ENVIO,
  enviarYEsperar,
  listarEnviosCorreo,
  mensajeDeErrorEnvio,
  mensajeEnviadoPorCorreo,
  textoMarcaEnvio,
  ultimoEnvioEnviado,
  type EnvioCorreoPresupuesto,
} from '../../lib/ventasPresupuestoCorreo'

// El diálogo y su motor de consulta pesan poco, pero solo se usan al imprimir: carga diferida (Principio VI).
const ImprimirComprobanteDialog = lazy(() =>
  import('./ImprimirComprobanteDialog').then((modulo) => ({ default: modulo.ImprimirComprobanteDialog })),
)

export const AVISO_CAMBIO_DE_TIENDA = 'Cambiaste de tienda: cerramos la impresión para no mezclar datos de dos tiendas.'

type Props = {
  comprobante: Comprobante
  // `lectura` alcanza para imprimir (FR-001): la pantalla pasa false si la persona no ve Ventas.
  puedeImprimir: boolean
  // Enviar el presupuesto por correo exige `edicion` (FR-027): la base lo vuelve a verificar.
  puedeEnviar?: boolean
  // Empresa activa de la barra superior (Principio VIII, FR-014).
  empresaActivaId: string | null
  // Documento con el diálogo abierto, o null. Lo controla la pantalla porque el botón «Imprimir» de la
  // cabecera y «Imprimir remito» de esta tarjeta abren el mismo diálogo.
  dialogo: TipoDocumento | null
  onAbrir: (tipo: TipoDocumento) => void
  onCerrar: () => void
}

// Tarjeta «Documentos» y diálogo «Imprimir comprobante» (F-VTA-19, FR-011, FR-012, FR-014); en un presupuesto
// (F-VTA-20, FR-026) suma «Enviar por correo» y su marca. Si el comprobante
// no es imprimible no se ofrecen los botones y se indica el motivo. Al cambiar la empresa activa con el
// diálogo abierto, se cierra con aviso: jamás se imprime con datos de otra tienda.
export function DocumentosComprobante({ comprobante, puedeImprimir, puedeEnviar = false, empresaActivaId, dialogo, onAbrir, onCerrar }: Props) {
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

  // Marcas de impreso (F-VTA-21, FR-033): la última impresión de cada documento. Se recargan al cambiar de tienda
  // (Principio VIII: nunca quedan marcas de la anterior) y tras cada impresión.
  // El resultado lleva la clave de la lectura que lo produjo: si cambia el comprobante o la tienda, el resultado
  // viejo deja de valer sin tener que resetear el estado dentro del efecto.
  const [recarga, setRecarga] = useState(0)
  const [lectura, setLectura] = useState<{
    clave: string
    marcas: Partial<Record<TipoDocumentoImpreso, ImpresionComprobante>> | null
  } | null>(null)
  // Tras imprimir se vuelve a leer, pero hasta que llegue la nueva lectura se siguen mostrando las marcas anteriores.
  const claveLectura = `${comprobante.id}|${empresaActivaId ?? ''}`
  useEffect(() => {
    if (!imprimible) return
    let vigente = true
    ultimasImpresiones(comprobante.id).then(
      (ultimas) => {
        if (vigente) setLectura({ clave: claveLectura, marcas: ultimas })
      },
      (falla) => {
        console.error(MENSAJE_ERROR_MARCAS, falla)
        if (vigente) setLectura({ clave: claveLectura, marcas: null })
      },
    )
    return () => {
      vigente = false
    }
  }, [comprobante.id, claveLectura, imprimible, recarga])
  const vigente = lectura?.clave === claveLectura ? lectura : null
  const marcas = vigente?.marcas ?? {}
  const errorMarcas = vigente !== null && vigente.marcas === null
  // Una marca por cada documento que aplica al comprobante: factura y remito, o el presupuesto.
  const tiposMarca: TipoDocumentoImpreso[] = elegibles
  const esPresupuesto = elegibles.includes('presupuesto')

  // Envíos por correo del presupuesto (F-VTA-20, FR-026): mismo criterio que las marcas de impreso.
  const [lecturaEnvios, setLecturaEnvios] = useState<{ clave: string; envios: EnvioCorreoPresupuesto[] | null } | null>(null)
  useEffect(() => {
    if (!imprimible || !esPresupuesto) return
    let vigenteEnvios = true
    listarEnviosCorreo(comprobante.id).then(
      (envios) => {
        if (vigenteEnvios) setLecturaEnvios({ clave: claveLectura, envios })
      },
      (falla) => {
        console.error(MENSAJE_ERROR_MARCA_ENVIO, falla)
        if (vigenteEnvios) setLecturaEnvios({ clave: claveLectura, envios: null })
      },
    )
    return () => {
      vigenteEnvios = false
    }
  }, [comprobante.id, claveLectura, imprimible, esPresupuesto, recarga])
  const vigenteEnvios = lecturaEnvios?.clave === claveLectura ? lecturaEnvios : null
  const marcaEnvio = vigenteEnvios?.envios ? ultimoEnvioEnviado(vigenteEnvios.envios) : undefined
  const errorEnvios = vigenteEnvios !== null && vigenteEnvios.envios === null

  // «Enviar por correo»: pide el envío y consulta su avance. El estado lleva la clave de la tienda: si cambia la
  // empresa activa, el envío en curso se corta y su resultado deja de mostrarse (Principio VIII).
  const [envio, setEnvio] = useState<{ clave: string; fase: 'enviando' | 'error'; mensaje?: string } | null>(null)
  const controlEnvio = useRef<AbortController | null>(null)
  useEffect(() => () => controlEnvio.current?.abort(), [claveLectura])
  const envioVigente = envio?.clave === claveLectura ? envio : null
  const enviando = envioVigente?.fase === 'enviando'
  const enviarPorCorreo = async () => {
    if (enviando) return
    controlEnvio.current?.abort()
    const actual = new AbortController()
    controlEnvio.current = actual
    setEnvio({ clave: claveLectura, fase: 'enviando' })
    try {
      await enviarYEsperar(comprobante.id, { signal: actual.signal })
      if (actual.signal.aborted) return
      setEnvio(null)
      setRecarga((n) => n + 1)
      setMensaje(mensajeEnviadoPorCorreo(comprobante.numero))
    } catch (falla) {
      if (esCancelacion(falla) || actual.signal.aborted) return
      setEnvio({ clave: claveLectura, fase: 'error', mensaje: mensajeDeErrorEnvio(falla) })
      setRecarga((n) => n + 1)
    }
  }

  return (
    <>
      <Card variant="outlined">
        <CardHeader title={<Typography component="h2" variant="t3">Documentos</Typography>} />
        <CardContent>
          <Stack spacing={1.5} alignItems="flex-start">
            {motivo ? <Typography variant="body2" color="text.secondary">{motivo}</Typography> : null}
            {imprimible ? (
              <Stack component="ul" spacing={0.5} aria-label="Marcas de impreso" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                {tiposMarca.map((tipo) => {
                  const impresion = marcas[tipo]
                  return (
                    <Stack component="li" key={tipo} direction="row" spacing={1} alignItems="center">
                      {impresion ? (
                        <CheckBoxIcon fontSize="small" color="success" aria-hidden />
                      ) : (
                        <CheckBoxOutlineBlankIcon fontSize="small" color="disabled" aria-hidden />
                      )}
                      <Typography variant="body2" color={impresion ? 'text.primary' : 'text.secondary'}>
                        {textoMarca(tipo, impresion)}
                      </Typography>
                    </Stack>
                  )
                })}
              </Stack>
            ) : null}
            {imprimible && esPresupuesto ? (
              <Stack direction="row" spacing={1} alignItems="center">
                {marcaEnvio ? (
                  <CheckBoxIcon fontSize="small" color="success" aria-hidden />
                ) : (
                  <CheckBoxOutlineBlankIcon fontSize="small" color="disabled" aria-hidden />
                )}
                <Typography variant="body2" color={marcaEnvio ? 'text.primary' : 'text.secondary'}>
                  {textoMarcaEnvio(marcaEnvio)}
                </Typography>
              </Stack>
            ) : null}
            {errorMarcas ? <Alert severity="warning">{MENSAJE_ERROR_MARCAS}</Alert> : null}
            {errorEnvios ? <Alert severity="warning">{MENSAJE_ERROR_MARCA_ENVIO}</Alert> : null}
            {enviando ? (
              <Alert severity="info" role="status">
                {MENSAJE_ENVIANDO}
              </Alert>
            ) : null}
            {envioVigente?.fase === 'error' ? (
              <Alert
                severity="error"
                action={
                  <Button color="inherit" size="small" onClick={() => void enviarPorCorreo()}>
                    Reintentar
                  </Button>
                }
              >
                {envioVigente.mensaje}
              </Alert>
            ) : null}
            {imprimible && elegibles.includes('remito') ? (
              <Button type="button" variant="outlined" size="small" onClick={() => onAbrir('remito')}>
                Imprimir remito
              </Button>
            ) : null}
            {imprimible && esPresupuesto && puedeEnviar ? (
              <Button type="button" variant="outlined" size="small" disabled={enviando} onClick={() => void enviarPorCorreo()}>
                {ETIQUETA_ENVIAR_CORREO}
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
            onRegistrado={() => setRecarga((n) => n + 1)}
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
