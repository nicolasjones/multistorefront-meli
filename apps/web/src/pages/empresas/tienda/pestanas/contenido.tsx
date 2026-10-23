import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { useWarnAboutChange } from '@refinedev/core'
import { EstadoCargaPagina, EstadoError } from '../../../../components/estados/EstadosPagina'
import {
  CAMPOS_CONTENIDO,
  DESTINOS_BOTON,
  ErrorGuardadoContenido,
  contenidoIgual,
  guardarContenido,
  leerContenido,
  validarContenido,
  type ClaveCampoContenido,
  type ContenidoTienda,
  type ErroresContenido,
} from '../../../../lib/tiendaContenido'
import { BannerContenido } from '../../../tienda-publica/secciones/BannerHome'
import type { PropsPestanaTienda } from '../pestanas'

const CLAVES_BANNER: ClaveCampoContenido[] = ['titulo', 'subtitulo', 'texto_boton']
const CLAVES_TEXTOS: ClaveCampoContenido[] = ['bienvenida', 'pie', 'aviso_ficha', 'texto_boton_contacto']

function Formulario({ empresaId, empresaNombre, inicial }: PropsPestanaTienda & { inicial: ContenidoTienda }) {
  const { setWarnWhen } = useWarnAboutChange()
  const [guardado, setGuardado] = useState<ContenidoTienda>(inicial)
  const [valores, setValores] = useState<ContenidoTienda>(inicial)
  const [errores, setErrores] = useState<ErroresContenido>({})
  const [guardando, setGuardando] = useState(false)
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [exito, setExito] = useState(false)

  const hayCambios = useMemo(() => !contenidoIgual(valores, guardado), [valores, guardado])

  // Con cambios sin guardar, la gestión avisa antes de cambiar de empresa (Principio VIII).
  useEffect(() => {
    setWarnWhen(hayCambios)
    return () => setWarnWhen(false)
  }, [hayCambios, setWarnWhen])

  const cambiar = useCallback(<K extends keyof ContenidoTienda>(clave: K, valor: ContenidoTienda[K]) => {
    setValores((actual) => ({ ...actual, [clave]: valor }))
    setErrores((actual) => ({ ...actual, [clave]: undefined }))
    setExito(false)
    setErrorGeneral(null)
  }, [])

  const descartar = () => {
    setValores(guardado)
    setErrores({})
    setErrorGeneral(null)
    setExito(false)
  }

  const guardar = async () => {
    const encontrados = validarContenido(valores)
    if (Object.keys(encontrados).length > 0) {
      setErrores(encontrados)
      setErrorGeneral(null)
      setExito(false)
      return
    }
    setGuardando(true)
    setErrorGeneral(null)
    setExito(false)
    try {
      const resultado = await guardarContenido(empresaId, valores)
      setGuardado(resultado)
      setValores(resultado)
      setErrores({})
      setExito(true)
    } catch (error) {
      console.error('No se pudo guardar el contenido de la tienda', error instanceof Error ? error.message : error)
      if (error instanceof ErrorGuardadoContenido && error.campo) {
        setErrores({ [error.campo]: error.message })
      } else {
        setErrorGeneral('No pudimos guardar los cambios. Intentá de nuevo.')
      }
    }
    setGuardando(false)
  }

  const campo = (clave: ClaveCampoContenido) => {
    const definicion = CAMPOS_CONTENIDO.find((c) => c.clave === clave)!
    const largo = valores[clave].trim().length
    return (
      <TextField
        key={clave}
        label={definicion.etiqueta}
        value={valores[clave]}
        onChange={(evento) => cambiar(clave, evento.target.value)}
        error={Boolean(errores[clave])}
        helperText={errores[clave] ?? `${largo}/${definicion.limite}`}
        multiline={definicion.multilinea}
        minRows={definicion.multilinea ? 2 : undefined}
        fullWidth
        size="small"
        disabled={guardando}
      />
    )
  }

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Textos de la tienda de {empresaNombre}. Se muestran como texto: no se interpreta HTML. Un campo vacío no se muestra en la tienda.
      </Typography>
      <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' } }}>
        <Stack spacing={3}>
          <Stack spacing={2} role="group" aria-labelledby="contenido-banner">
            <Typography id="contenido-banner" component="h2" variant="h6">Banner principal</Typography>
            {CLAVES_BANNER.map(campo)}
            <TextField
              select
              label="El botón lleva a"
              value={valores.boton_destino}
              onChange={(evento) => cambiar('boton_destino', evento.target.value as ContenidoTienda['boton_destino'])}
              error={Boolean(errores.boton_destino)}
              helperText={errores.boton_destino}
              fullWidth
              size="small"
              disabled={guardando}
            >
              {DESTINOS_BOTON.map((destino) => (
                <MenuItem key={destino.valor} value={destino.valor}>{destino.etiqueta}</MenuItem>
              ))}
            </TextField>
          </Stack>
          <Stack spacing={2} role="group" aria-labelledby="contenido-textos">
            <Typography id="contenido-textos" component="h2" variant="h6">Textos comerciales</Typography>
            {CLAVES_TEXTOS.map(campo)}
          </Stack>
        </Stack>
        <Stack spacing={2} role="group" aria-labelledby="contenido-vista-previa">
          <Typography id="contenido-vista-previa" component="h2" variant="h6">Vista previa</Typography>
          <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, minHeight: 120 }} data-testid="vista-previa-banner">
            <BannerContenido contenido={valores} />
            {!valores.titulo.trim() && !valores.subtitulo.trim() && !valores.texto_boton.trim() ? (
              <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                El banner no se muestra mientras el título, el subtítulo y el texto del botón estén vacíos.
              </Typography>
            ) : null}
          </Box>
          <Typography variant="caption" color="text.secondary">Se actualiza con los cambios sin guardar.</Typography>
        </Stack>
      </Box>
      <Stack spacing={1} sx={{ mt: 3 }}>
        {hayCambios ? <Alert severity="info" role="status">Hay cambios sin guardar.</Alert> : null}
        {exito ? <Alert severity="success" role="status">Cambios guardados. La tienda ya muestra los textos nuevos.</Alert> : null}
        {errorGeneral ? <Alert severity="error" role="alert">{errorGeneral}</Alert> : null}
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button onClick={descartar} disabled={!hayCambios || guardando}>Descartar</Button>
          <Button variant="contained" onClick={() => void guardar()} disabled={!hayCambios || guardando}>Guardar</Button>
        </Stack>
      </Stack>
    </Box>
  )
}

type Carga = { fase: 'cargando' } | { fase: 'error' } | { fase: 'lista'; contenido: ContenidoTienda }

function ContenidoDeEmpresa(props: PropsPestanaTienda) {
  const { empresaId } = props
  const [carga, setCarga] = useState<Carga>({ fase: 'cargando' })
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    let cancelada = false
    leerContenido(empresaId)
      .then((contenido) => { if (!cancelada) setCarga({ fase: 'lista', contenido }) })
      .catch((error) => {
        console.error('No se pudo cargar el contenido de la tienda', error instanceof Error ? error.message : error)
        if (!cancelada) setCarga({ fase: 'error' })
      })
    return () => { cancelada = true }
  }, [empresaId, intento])

  if (carga.fase === 'cargando') return <EstadoCargaPagina />
  if (carga.fase === 'error') {
    return (
      <EstadoError
        descripcion="No pudimos cargar los textos de la tienda."
        reintentar={() => { setCarga({ fase: 'cargando' }); setIntento((n) => n + 1) }}
      />
    )
  }
  return <Formulario {...props} inicial={carga.contenido} />
}

// Pestaña «Contenido» (F-TDA-03, FR-037). `key` por empresa: al cambiar la empresa activa se
// descarta todo el estado (valores, errores, vista previa) y se vuelve a leer (Principio VIII).
export default function PestanaContenido(props: PropsPestanaTienda) {
  return <ContenidoDeEmpresa key={props.empresaId} {...props} />
}
