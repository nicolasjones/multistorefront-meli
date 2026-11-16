import { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material'
import { useWarnAboutChange } from '@refinedev/core'
import { EstadoCargaPagina, EstadoError } from '../../../../components/estados/EstadosPagina'
import { useNivelSeccion } from '../../../../hooks/useNivelSeccion'
import {
  analiticaIgual,
  ErrorGuardadoAnalitica,
  guardarAnalitica,
  leerAnalitica,
  validarAnalitica,
  type AnaliticaTienda,
  type CampoAnalitica,
  type ErroresAnalitica,
} from '../../../../lib/tiendaAnalitica'
import type { PropsPestanaTienda } from '../pestanas'

const CAMPOS: ReadonlyArray<{ clave: CampoAnalitica; etiqueta: string; ayuda: string; ejemplo: string }> = [
  {
    clave: 'ga4_id',
    etiqueta: 'ID de Google Analytics 4',
    ayuda: 'Empieza con G- (por ejemplo G-XXXXXXXXXX). Vacío = sin Google Analytics.',
    ejemplo: 'G-XXXXXXXXXX',
  },
  {
    clave: 'meta_pixel_id',
    etiqueta: 'ID de Meta Pixel',
    ayuda: 'Solo números, de 8 a 20 dígitos. Vacío = sin Meta Pixel.',
    ejemplo: '1234567890',
  },
]

const MENSAJE_SIN_PERMISO = 'Tu rol no puede editar la analítica de la tienda.'

function Formulario({ empresaId, empresaNombre, inicial }: PropsPestanaTienda & { inicial: AnaliticaTienda }) {
  const { setWarnWhen } = useWarnAboutChange()
  // Solo para gatear la UI; la base es la autorización real. Sin nivel cargado (null) no se bloquea: la gestión ya
  // exige edición en Empresas para llegar acá.
  const { nivel } = useNivelSeccion('empresas')
  const soloLectura = nivel === 'lectura' || nivel === 'ninguno'
  const [guardado, setGuardado] = useState<AnaliticaTienda>(inicial)
  const [valores, setValores] = useState<AnaliticaTienda>(inicial)
  const [errores, setErrores] = useState<ErroresAnalitica>({})
  const [guardando, setGuardando] = useState(false)
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [exito, setExito] = useState(false)

  const hayCambios = useMemo(() => !analiticaIgual(valores, guardado), [valores, guardado])

  // Con cambios sin guardar, la gestión avisa antes de cambiar de empresa (Principio VIII).
  useEffect(() => {
    setWarnWhen(hayCambios)
    return () => setWarnWhen(false)
  }, [hayCambios, setWarnWhen])

  const cambiar = (clave: CampoAnalitica, valor: string) => {
    setValores((actual) => ({ ...actual, [clave]: valor }))
    setErrores((actual) => ({ ...actual, [clave]: undefined }))
    setExito(false)
    setErrorGeneral(null)
  }

  // Al salir del campo se avisa el formato bajo el campo, sin esperar a «Guardar».
  const alSalir = (clave: CampoAnalitica) => {
    const encontrado = validarAnalitica(valores)[clave]
    setErrores((actual) => ({ ...actual, [clave]: encontrado }))
  }

  const descartar = () => {
    setValores(guardado)
    setErrores({})
    setErrorGeneral(null)
    setExito(false)
  }

  const guardar = async () => {
    const encontrados = validarAnalitica(valores)
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
      const resultado = await guardarAnalitica(empresaId, valores)
      setGuardado(resultado)
      setValores(resultado)
      setErrores({})
      setExito(true)
    } catch (error) {
      console.error('No se pudo guardar la analítica de la tienda', error instanceof Error ? error.message : error)
      if (error instanceof ErrorGuardadoAnalitica && error.campo) {
        setErrores({ [error.campo]: error.message })
      } else if (error instanceof ErrorGuardadoAnalitica && error.codigo === '42501') {
        setErrorGeneral(MENSAJE_SIN_PERMISO)
      } else {
        setErrorGeneral('No pudimos guardar los cambios. Intentá de nuevo.')
      }
    }
    setGuardando(false)
  }

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Conectá las herramientas con las que {empresaNombre} mide las visitas de su tienda. Son identificadores públicos: dicen a
        dónde enviar la medición y no dan acceso a nada.
      </Typography>
      {/* Es información permanente, no una alerta: `note` evita que un lector de pantalla la anuncie como urgente. */}
      <Alert severity="info" role="note" sx={{ mb: 2 }}>
        Solo se cargan en la tienda publicada y si la persona acepta las cookies.
      </Alert>
      <Alert severity="info" role="note" sx={{ mb: 3 }}>
        No se envían datos del visitante: ni nombre, ni email, ni teléfono, ni lo que escribe en el buscador o en los formularios.
        Solo viajan las visitas y cuatro acciones (ver un producto, buscar, tocar WhatsApp y enviar una consulta), sin su contenido.
        Si la persona retira su consentimiento, la medición se apaga y se borran sus cookies. En tu propiedad de Google Analytics 4
        desactivá la «Medición mejorada» (Administrar &gt; Flujos de datos &gt; tu flujo web): si no, Google suma por su cuenta visitas y
        eventos de formularios que la tienda ya registra y las visitas se duplican.
      </Alert>
      {soloLectura ? <Alert severity="info" role="status" sx={{ mb: 2 }}>{MENSAJE_SIN_PERMISO} Podés verla, pero no cambiarla.</Alert> : null}
      <Stack spacing={2} sx={{ maxWidth: 520 /* estilos-sueltos: ok: ancho de lectura del formulario */ }}>
        {CAMPOS.map((campo) => (
          <TextField
            key={campo.clave}
            label={campo.etiqueta}
            value={valores[campo.clave]}
            onChange={(evento) => cambiar(campo.clave, evento.target.value)}
            onBlur={() => alSalir(campo.clave)}
            error={Boolean(errores[campo.clave])}
            helperText={errores[campo.clave] ?? campo.ayuda}
            placeholder={campo.ejemplo}
            fullWidth
            size="small"
            disabled={guardando || soloLectura}
            slotProps={{ htmlInput: { autoComplete: 'off', spellCheck: false } }}
          />
        ))}
      </Stack>
      <Stack spacing={1} sx={{ mt: 3 }}>
        {hayCambios ? <Alert severity="info" role="status">Hay cambios sin guardar.</Alert> : null}
        {exito ? <Alert severity="success" role="status">Cambios guardados. Se aplican a la tienda publicada.</Alert> : null}
        {errorGeneral ? <Alert severity="error" role="alert">{errorGeneral}</Alert> : null}
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button onClick={descartar} disabled={!hayCambios || guardando || soloLectura}>Descartar</Button>
          <Button variant="contained" onClick={() => void guardar()} disabled={!hayCambios || guardando || soloLectura}>Guardar</Button>
        </Stack>
      </Stack>
    </Box>
  )
}

type Carga = { fase: 'cargando' } | { fase: 'error' } | { fase: 'lista'; analitica: AnaliticaTienda }

function AnaliticaDeEmpresa(props: PropsPestanaTienda) {
  const { empresaId } = props
  const [carga, setCarga] = useState<Carga>({ fase: 'cargando' })
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    let cancelada = false
    leerAnalitica(empresaId)
      .then((analitica) => { if (!cancelada) setCarga({ fase: 'lista', analitica }) })
      .catch((error) => {
        console.error('No se pudo cargar la analítica de la tienda', error instanceof Error ? error.message : error)
        if (!cancelada) setCarga({ fase: 'error' })
      })
    return () => { cancelada = true }
  }, [empresaId, intento])

  if (carga.fase === 'cargando') return <EstadoCargaPagina />
  if (carga.fase === 'error') {
    return (
      <EstadoError
        descripcion="No pudimos cargar la analítica de la tienda."
        reintentar={() => { setCarga({ fase: 'cargando' }); setIntento((n) => n + 1) }}
      />
    )
  }
  return <Formulario {...props} inicial={carga.analitica} />
}

// Pestaña «Analítica» (F-TDA-24, FR-013). `key` por empresa: al cambiar la empresa activa se descarta todo el
// estado (valores, errores) y se vuelve a leer (Principio VIII).
export default function PestanaAnalitica(props: PropsPestanaTienda) {
  return <AnaliticaDeEmpresa key={props.empresaId} {...props} />
}
