import { useEffect, useMemo, useState } from 'react'
import { Link as RouterLink, useParams } from 'react-router'
import { Alert, Box, Button, GlobalStyles, Link, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { EstadoCargaPagina, EstadoError } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { EtiquetaReparacion } from '../../components/service/EtiquetaReparacion'
import { useDocumentoReparacion } from '../../components/service/useDocumentoReparacion'
import {
  ERROR_ALTO, ERROR_ANCHO, ERROR_COPIAS, TAMANOS_ETIQUETA, TEXTO_ANULADA, TEXTO_DEMASIADO_CHICA, TEXTO_DIRECCION_LARGA,
  TEXTO_ENTORNO_DE_PRUEBA, altoValido, anchoValido, copiasValidas, esEntornoDePrueba, etiquetaDemasiadoChica, guardarPreferencia,
  leerPreferencia, medidasDeTamano, textosDeEtiqueta, urlEtiquetaReparacion, type ClaveTamano, type PreferenciaEtiqueta,
} from '../../lib/etiquetaReparacion'
import { QrDemasiadoLargo, generarQr, type ResultadoQr } from '../../lib/qr/qr'
import { qrASvg } from '../../lib/qr/svg'

// Vista de la etiqueta con QR de una reparación (F-SVC-32, P-4, FR-043 a FR-049). El acceso (`lectura` en
// `service_tecnico`) lo exige la ruta; la tienda accesible, `obtener_reparacion`. Solo lee: no hay rutas ni RPC nuevas.
// La impresión es la del navegador, con `@page` del tamaño de la etiqueta y sin márgenes (D-20).
function estilosDeImpresion(ancho: number, alto: number) {
  return {
    '@page': { size: `${ancho}mm ${alto}mm`, margin: 0 },
    '@media print': {
      '.MuiAppBar-root, .MuiDrawer-root, nav, .no-imprimir': { display: 'none !important' },
      'html, body': { background: '#fff !important', margin: '0 !important', padding: '0 !important' }, // estilos-sueltos: ok: la hoja impresa es blanca por definición
      main: { padding: '0 !important', margin: '0 !important' },
    },
  }
}

type Armado = { estado: 'listo'; qr: ResultadoQr } | { estado: 'larga' } | { estado: 'invalido' }

function armarQr(origen: string, id: string): Armado {
  try {
    return { estado: 'listo', qr: generarQr(urlEtiquetaReparacion(origen, id)) }
  } catch (error) {
    return error instanceof QrDemasiadoLargo ? { estado: 'larga' } : { estado: 'invalido' }
  }
}

export function ServicioEtiqueta() {
  const { id } = useParams()
  const { datos, error, cargando, reintentar } = useDocumentoReparacion(id)
  const [preferencia, setPreferencia] = useState<PreferenciaEtiqueta>(() => leerPreferencia())
  const [anchoTexto, setAnchoTexto] = useState(() => String(preferencia.ancho))
  const [altoTexto, setAltoTexto] = useState(() => String(preferencia.alto))
  const [copiasTexto, setCopiasTexto] = useState('1')

  const volver = (
    <Link component={RouterLink} to={id ? `/service-tecnico/reparaciones/${id}` : '/service-tecnico/reparaciones'} underline="hover">
      ← Volver a la reparación
    </Link>
  )

  // El QR depende solo del origen del panel y del id: se arma una vez por reparación.
  const origen = typeof window === 'undefined' ? '' : window.location.origin
  const nombreDeHost = typeof window === 'undefined' ? '' : window.location.hostname
  const reparacionId = datos?.reparacion.id
  const armado = useMemo<Armado | null>(() => (reparacionId ? armarQr(origen, reparacionId) : null), [origen, reparacionId])

  // La preferencia (tamaño y medidas, no la cantidad) se recuerda en este navegador.
  useEffect(() => {
    guardarPreferencia(preferencia)
  }, [preferencia])

  if (cargando) return <EstadoCargaPagina />
  if (error || !datos) {
    return (
      <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        <Box sx={{ width: '100%' }}>
          <EstadoError titulo="No pudimos cargar la reparación." descripcion={error ?? undefined} reintentar={reintentar} />
        </Box>
        <Link component={RouterLink} to="/service-tecnico/reparaciones" underline="hover">
          Volver al listado
        </Link>
      </Stack>
    )
  }
  if (datos.reparacion.anulada_en !== null) {
    return (
      <Box>
        <Alert severity="warning" sx={{ mb: 2 }}>{TEXTO_ANULADA}</Alert>
        {volver}
      </Box>
    )
  }

  const textos = textosDeEtiqueta(datos.reparacion, datos.tienda)
  const { ancho, alto } = medidasDeTamano(preferencia.tamano, preferencia)
  const personalizada = preferencia.tamano === 'personalizada'
  const anchoNumero = Number(anchoTexto)
  const altoNumero = Number(altoTexto)
  const copiasNumero = Number(copiasTexto)
  const errorAncho = personalizada && (anchoTexto.trim() === '' || !anchoValido(anchoNumero)) ? ERROR_ANCHO : null
  const errorAlto = personalizada && (altoTexto.trim() === '' || !altoValido(altoNumero)) ? ERROR_ALTO : null
  const errorCopias = copiasTexto.trim() === '' || !copiasValidas(copiasNumero) ? ERROR_COPIAS : null

  const qr = armado?.estado === 'listo' ? armado.qr : null
  const demasiadoChica = qr ? etiquetaDemasiadoChica(ancho, alto, qr.tamano) : false
  const copias = errorCopias ? 1 : copiasNumero
  const puedeImprimir = qr !== null && !demasiadoChica && !errorAncho && !errorAlto && !errorCopias
  const svg = qr ? qrASvg(qr.modulos) : null

  const elegirTamano = (clave: ClaveTamano) => {
    setPreferencia((actual) => ({ ...actual, tamano: clave }))
    if (clave === 'personalizada') {
      setAnchoTexto(String(preferencia.ancho))
      setAltoTexto(String(preferencia.alto))
    }
  }
  // Una medida personalizada solo se aplica (y se recuerda) cuando es válida.
  const cambiarAncho = (texto: string) => {
    setAnchoTexto(texto)
    const valor = Number(texto)
    if (texto.trim() !== '' && anchoValido(valor)) setPreferencia((actual) => ({ ...actual, ancho: valor }))
  }
  const cambiarAlto = (texto: string) => {
    setAltoTexto(texto)
    const valor = Number(texto)
    if (texto.trim() !== '' && altoValido(valor)) setPreferencia((actual) => ({ ...actual, alto: valor }))
  }

  return (
    <Box>
      <GlobalStyles styles={estilosDeImpresion(ancho, alto)} />
      <Box className="no-imprimir">
        <Box sx={{ mb: 1.5 }}>{volver}</Box>
        <EncabezadoPagina
          titulo={`Etiqueta de la reparación ${textos.codigo}`}
          accion={
            <Button variant="contained" onClick={() => window.print()} disabled={!puedeImprimir}>
              Imprimir
            </Button>
          }
        />
        <Stack spacing={1.5} sx={{ mb: 2 }}>
          {esEntornoDePrueba(nombreDeHost) ? <Alert severity="info">{TEXTO_ENTORNO_DE_PRUEBA}</Alert> : null}
          {armado?.estado === 'larga' ? <Alert severity="error">{TEXTO_DIRECCION_LARGA}</Alert> : null}
          {armado?.estado === 'invalido' ? <Alert severity="error">No pudimos armar la dirección del código QR.</Alert> : null}
          {demasiadoChica ? <Alert severity="warning">{TEXTO_DEMASIADO_CHICA}</Alert> : null}
        </Stack>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 1.5, alignItems: { md: 'flex-start' } }}>
          <TextField
            select
            size="small"
            label="Tamaño de la etiqueta"
            value={preferencia.tamano}
            onChange={(evento) => elegirTamano(evento.target.value as ClaveTamano)}
            sx={{ minWidth: { md: 240 } }}
          >
            {TAMANOS_ETIQUETA.map((tamano) => (
              <MenuItem key={tamano.clave} value={tamano.clave}>{tamano.nombre}</MenuItem>
            ))}
          </TextField>
          {personalizada ? (
            <>
              <TextField
                size="small"
                type="number"
                label="Ancho (mm)"
                value={anchoTexto}
                onChange={(evento) => cambiarAncho(evento.target.value)}
                error={errorAncho !== null}
                helperText={errorAncho ?? undefined}
                slotProps={{ htmlInput: { min: 25, max: 100, step: 1, inputMode: 'numeric' } }}
              />
              <TextField
                size="small"
                type="number"
                label="Alto (mm)"
                value={altoTexto}
                onChange={(evento) => cambiarAlto(evento.target.value)}
                error={errorAlto !== null}
                helperText={errorAlto ?? undefined}
                slotProps={{ htmlInput: { min: 15, max: 100, step: 1, inputMode: 'numeric' } }}
              />
            </>
          ) : null}
          <TextField
            size="small"
            type="number"
            label="Cantidad de etiquetas"
            value={copiasTexto}
            onChange={(evento) => setCopiasTexto(evento.target.value)}
            error={errorCopias !== null}
            helperText={errorCopias ?? undefined}
            slotProps={{ htmlInput: { min: 1, max: 10, step: 1, inputMode: 'numeric' } }}
          />
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Se imprime con el diálogo del navegador. Elegí tu impresora de etiquetas, dejá la escala en 100 % y los márgenes en «Ninguno».
        </Typography>
      </Box>
      {svg ? (
        <Box className="etiquetas-impresion" data-copias={copias}>
          {Array.from({ length: copias }, (_, indice) => (
            <EtiquetaReparacion key={indice} textos={textos} qr={svg} ancho={ancho} alto={alto} soloImpresion={indice > 0} />
          ))}
        </Box>
      ) : null}
      <Typography className="no-imprimir" variant="body2" color="text.secondary" sx={{ mt: 2 }}>
        El código QR abre esta reparación en el panel: hace falta tener sesión.
      </Typography>
    </Box>
  )
}
