import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Alert, Box, Button, Card, CardContent, Stack, Typography } from '@mui/material'
import { useWarnAboutChange } from '@refinedev/core'
import {
  IDENTIDAD_BASE, borrarImagenes, esColorValido, guardarIdentidad, leerIdentidadDeEmpresa, normalizarColor, rutaArchivo,
  subirImagen, urlPublica, type ClaveImagen, type IdentidadDeEmpresa, type IdentidadTienda,
} from '../../../../lib/tiendaIdentidad'
import { tokens } from '../../../../tema/tokens'
import { EstadoCargaPagina, EstadoError } from '../../../../components/estados/EstadosPagina'
import { ImagenTienda, useUrlLocal, type EstadoImagen } from '../componentes/imagen-tienda/ImagenTienda'
import {
  AvisoContraste, CampoColor, MuestraTipografia, SelectorTipografia, useFuentes,
} from '../componentes/identidad/CamposDeIdentidad'
import type { PropsPestanaTienda } from '../pestanas'

// F-TDA-02 (US2, FR-020…FR-030): pestaña «Identidad visual». Todo cambio vive en el formulario hasta
// «Guardar» (sin borrador: no se escribe nada al elegir ni al previsualizar); «Descartar» vuelve al
// último valor guardado. «Guardar» sube los archivos nuevos, llama a la RPC y recién entonces la tienda
// pública cambia.

type Imagenes = Record<ClaveImagen, EstadoImagen>

const CLAVES_IMAGEN: readonly ClaveImagen[] = ['logo', 'banner', 'bannerMovil']
const RUTA_DE = { logo: 'logoRuta', banner: 'bannerRuta', bannerMovil: 'bannerMovilRuta' } as const
const NOMBRE_IMAGEN: Record<ClaveImagen, string> = { logo: 'el logo', banner: 'el banner principal', bannerMovil: 'el banner móvil' }

// Falla de la subida de un archivo: el mensaje ya es apto para mostrar y no se antepone otro.
class ErrorSubida extends Error {}

const imagenesDe = (identidad: IdentidadTienda): Imagenes => ({
  logo: { ruta: identidad.logoRuta, archivo: null },
  banner: { ruta: identidad.bannerRuta, archivo: null },
  bannerMovil: { ruta: identidad.bannerMovilRuta, archivo: null },
})

type Campos = Pick<IdentidadTienda, 'colorPrimario' | 'colorPrimarioOscuro' | 'colorAcento' | 'colorFondo' | 'tipografiaTitulos' | 'tipografiaTexto'>
const camposDe = (identidad: IdentidadTienda): Campos => ({
  colorPrimario: identidad.colorPrimario,
  colorPrimarioOscuro: identidad.colorPrimarioOscuro,
  colorAcento: identidad.colorAcento,
  colorFondo: identidad.colorFondo,
  tipografiaTitulos: identidad.tipografiaTitulos,
  tipografiaTexto: identidad.tipografiaTexto,
})

const COLORES: ReadonlyArray<{ clave: 'colorPrimario' | 'colorPrimarioOscuro' | 'colorAcento' | 'colorFondo'; etiqueta: string }> = [
  { clave: 'colorPrimario', etiqueta: 'Primario' },
  { clave: 'colorPrimarioOscuro', etiqueta: 'Primario oscuro' },
  { clave: 'colorAcento', etiqueta: 'Acento' },
  { clave: 'colorFondo', etiqueta: 'Fondo' },
]

function Tarjeta({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <Card variant="outlined" component="section" aria-label={titulo}>
      <CardContent>
        <Typography component="h2" variant="h6" sx={{ mb: 2 }}>{titulo}</Typography>
        {children}
      </CardContent>
    </Card>
  )
}

// Muestra del sitio con los valores SIN guardar: encabezado con logo, banner y productos de ejemplo.
// Es una miniatura ilustrativa del sitio (proporciones de la maqueta), no una pantalla del panel.
function VistaPrevia({ campos, logoUrl, bannerUrl }: { campos: Campos; logoUrl: string | null; bannerUrl: string | null }) {
  const color = (valor: string, base: string) => (esColorValido(valor) ? valor.trim() : base)
  const primario = color(campos.colorPrimario, IDENTIDAD_BASE.colorPrimario)
  const fondo = color(campos.colorFondo, IDENTIDAD_BASE.colorFondo)
  const oscuro = color(campos.colorPrimarioOscuro, IDENTIDAD_BASE.colorPrimarioOscuro)
  const acento = color(campos.colorAcento, IDENTIDAD_BASE.colorAcento)
  const titulos = `"${campos.tipografiaTitulos}", system-ui, sans-serif`
  const texto = `"${campos.tipografiaTexto}", system-ui, sans-serif`
  return (
    <Card data-testid="vista-previa" variant="outlined" sx={{ overflow: 'hidden', bgcolor: fondo, fontFamily: texto }}>
      <Box sx={{ bgcolor: oscuro, height: (tema) => tema.spacing(1.5) }} />
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1.25, py: 0.75, bgcolor: fondo }}>
        {logoUrl ? <Box component="img" src={logoUrl} alt="" sx={{ height: (tema) => tema.spacing(3), maxWidth: 120, objectFit: 'contain' }} /> : <Box sx={{ width: 60, height: (tema) => tema.spacing(1.5), borderRadius: (tema) => tema.shape.borderRadius, bgcolor: 'divider' }} />}
        <Box sx={{ width: 100, height: (tema) => tema.spacing(1.5), borderRadius: (tema) => tema.shape.borderRadius, bgcolor: 'action.hover' }} />
      </Box>
      <Box
        data-testid="vista-previa-banner"
        sx={{
          color: 'common.white',
          px: 1.5,
          py: 2,
          minHeight: (tema) => tema.spacing(8.75),
          bgcolor: oscuro,
          backgroundImage: bannerUrl ? `url("${bannerUrl}")` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <Typography component="div" sx={{ fontFamily: titulos, fontSize: tokens.tipografia.escala.b.tamano, fontWeight: 700, lineHeight: 1.1, maxWidth: 170 }}>Todo para tu consola</Typography>
        <Box component="span" sx={{ display: 'inline-block', mt: 1, bgcolor: primario, color: 'common.white', fontSize: tokens.tipografia.escala.xs.tamano, fontWeight: 700, px: 1, py: 0.5, borderRadius: (tema) => tema.shape.borderRadius }}>Ver catálogo</Box>
      </Box>
      <Box sx={{ display: 'flex', gap: 0.75, p: 1.25 }}>
        {[1, 2, 3].map((n) => (
          <Box key={n} sx={{ flex: 1, bgcolor: fondo, border: 1, borderColor: 'divider', borderRadius: (tema) => tema.shape.borderRadius, p: 0.75 }}>
            <Box sx={{ height: (tema) => tema.spacing(5), borderRadius: (tema) => tema.shape.borderRadius, bgcolor: 'action.hover' }} />
            <Box sx={{ fontSize: tokens.tipografia.escala.xs.tamano, lineHeight: 1.2, mt: 0.5, color: 'inherit' }}>Producto de ejemplo</Box>
            <Box sx={{ fontSize: tokens.tipografia.escala.xs.tamano, fontWeight: 700, color: acento }}>$ 0</Box>
          </Box>
        ))}
      </Box>
    </Card>
  )
}

function FormularioIdentidad({
  empresaId, empresaNombre, organizacionId, inicial,
}: PropsPestanaTienda & { organizacionId: string; inicial: IdentidadTienda }) {
  const { setWarnWhen } = useWarnAboutChange()
  const [guardado, setGuardado] = useState<IdentidadTienda>(inicial)
  const [campos, setCampos] = useState<Campos>(camposDe(inicial))
  const [imagenes, setImagenes] = useState<Imagenes>(imagenesDe(inicial))
  const [guardando, setGuardando] = useState(false)
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null)
  const [exito, setExito] = useState(false)
  const enCurso = useRef(false)

  const hayCambios = useMemo(() => {
    const igualesCampos = (Object.keys(campos) as Array<keyof Campos>).every((clave) => {
      const nuevo = clave.startsWith('color') ? normalizarColor(campos[clave]) : campos[clave]
      return nuevo === guardado[clave]
    })
    const igualesImagenes = CLAVES_IMAGEN.every((clave) => imagenes[clave].archivo === null && imagenes[clave].ruta === guardado[RUTA_DE[clave]])
    return !igualesCampos || !igualesImagenes
  }, [campos, imagenes, guardado])

  useEffect(() => {
    setWarnWhen(hayCambios)
    return () => setWarnWhen(false)
  }, [hayCambios, setWarnWhen])

  useFuentes(campos)
  const urlLocalLogo = useUrlLocal(imagenes.logo.archivo)
  const urlLocalBanner = useUrlLocal(imagenes.banner.archivo)
  const urlLogo = urlLocalLogo ?? urlPublica(imagenes.logo.ruta)
  const urlBanner = urlLocalBanner ?? urlPublica(imagenes.banner.ruta)

  const cambiarCampo = <K extends keyof Campos>(clave: K, valor: Campos[K]) => {
    setCampos((actual) => ({ ...actual, [clave]: valor }))
    setExito(false)
    setErrorGuardar(null)
  }
  const cambiarImagen = (clave: ClaveImagen, estado: EstadoImagen) => {
    setImagenes((actual) => ({ ...actual, [clave]: estado }))
    setExito(false)
    setErrorGuardar(null)
  }

  const descartar = () => {
    setCampos(camposDe(guardado))
    setImagenes(imagenesDe(guardado))
    setErrorGuardar(null)
    setExito(false)
  }

  const guardar = useCallback(async () => {
    if (enCurso.current) return
    if (!COLORES.every(({ clave }) => esColorValido(campos[clave]))) {
      setErrorGuardar('Revisá los colores marcados: usá el formato #RRGGBB.')
      return
    }
    enCurso.current = true
    setGuardando(true)
    setErrorGuardar(null)
    setExito(false)
    const subidas: string[] = []
    try {
      const rutas: Record<ClaveImagen, string | null> = { logo: null, banner: null, bannerMovil: null }
      for (const clave of CLAVES_IMAGEN) {
        const { archivo, ruta } = imagenes[clave]
        if (!archivo) {
          rutas[clave] = ruta
          continue
        }
        const nueva = rutaArchivo(organizacionId, empresaId, clave, archivo)
        try {
          await subirImagen(nueva, archivo)
        } catch (error) {
          console.error('No se pudo subir la imagen de la tienda', error instanceof Error ? error.message : error)
          throw new ErrorSubida(`No pudimos subir ${NOMBRE_IMAGEN[clave]}. Revisá tu conexión e intentá de nuevo: no se guardó nada y la imagen anterior se conserva.`)
        }
        subidas.push(nueva)
        rutas[clave] = nueva
      }
      const resultado = await guardarIdentidad(empresaId, {
        colorPrimario: normalizarColor(campos.colorPrimario),
        colorPrimarioOscuro: normalizarColor(campos.colorPrimarioOscuro),
        colorAcento: normalizarColor(campos.colorAcento),
        colorFondo: normalizarColor(campos.colorFondo),
        tipografiaTitulos: campos.tipografiaTitulos,
        tipografiaTexto: campos.tipografiaTexto,
        logoRuta: rutas.logo,
        bannerRuta: rutas.banner,
        bannerMovilRuta: rutas.bannerMovil,
      })
      const enUso = [resultado.logoRuta, resultado.bannerRuta, resultado.bannerMovilRuta]
      const sinUso = CLAVES_IMAGEN.map((clave) => guardado[RUTA_DE[clave]]).filter((ruta): ruta is string => Boolean(ruta) && !enUso.includes(ruta))
      setGuardado(resultado)
      setCampos(camposDe(resultado))
      setImagenes(imagenesDe(resultado))
      setExito(true)
      void borrarImagenes(sinUso)
    } catch (error) {
      if (error instanceof ErrorSubida) {
        await borrarImagenes(subidas)
        setErrorGuardar(error.message)
      } else {
        // La RPC pudo haber guardado y perderse solo la respuesta: se relee la identidad y se borran
        // únicamente las subidas que la base no referencia. Si no se puede releer, se conservan (un
        // huérfano no rompe nada; un archivo borrado bajo una ruta guardada sí).
        const leida = await leerIdentidadDeEmpresa(empresaId).catch(() => null)
        if (leida) {
          const { logoRuta, bannerRuta, bannerMovilRuta } = leida.identidad
          await borrarImagenes(subidas.filter((ruta) => ![logoRuta, bannerRuta, bannerMovilRuta].includes(ruta)))
        }
        const mensaje = error instanceof Error ? error.message : 'Error desconocido'
        console.error('No se pudo guardar la identidad de la tienda', mensaje)
        setErrorGuardar(`No pudimos guardar los cambios: ${mensaje}`)
      }
    } finally {
      enCurso.current = false
      setGuardando(false)
    }
  }, [campos, imagenes, guardado, empresaId, organizacionId])

  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 360px' }, alignItems: 'start' }}>
      <Stack spacing={2} sx={{ minWidth: 0 }}>
        <Tarjeta titulo="Logo">
          <ImagenTienda clave="logo" urlLocal={urlLocalLogo} empresaNombre={empresaNombre} estado={imagenes.logo} onElegir={(archivo) => cambiarImagen('logo', { ruta: imagenes.logo.ruta, archivo })} onQuitar={() => cambiarImagen('logo', { ruta: null, archivo: null })} />
        </Tarjeta>
        <Tarjeta titulo="Colores">
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' } }}>
            {COLORES.map(({ clave, etiqueta }) => (
              <CampoColor key={clave} etiqueta={etiqueta} valor={campos[clave]} onChange={(valor) => cambiarCampo(clave, valor)} />
            ))}
          </Box>
          <Box sx={{ mt: 1 }}>
            <AvisoContraste colorPrimario={campos.colorPrimario} />
          </Box>
        </Tarjeta>
        <Tarjeta titulo="Tipografía">
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <SelectorTipografia etiqueta="Títulos" valor={campos.tipografiaTitulos} onChange={(valor) => cambiarCampo('tipografiaTitulos', valor)} />
            <SelectorTipografia etiqueta="Texto" valor={campos.tipografiaTexto} onChange={(valor) => cambiarCampo('tipografiaTexto', valor)} />
          </Stack>
          <MuestraTipografia titulos={campos.tipografiaTitulos} texto={campos.tipografiaTexto} />
        </Tarjeta>
        <Tarjeta titulo="Banner e imágenes principales">
          <Stack spacing={2.5}>
            <ImagenTienda clave="banner" urlLocal={urlLocalBanner} empresaNombre={empresaNombre} estado={imagenes.banner} onElegir={(archivo) => cambiarImagen('banner', { ruta: imagenes.banner.ruta, archivo })} onQuitar={() => cambiarImagen('banner', { ruta: null, archivo: null })} />
            <ImagenTienda clave="bannerMovil" empresaNombre={empresaNombre} estado={imagenes.bannerMovil} onElegir={(archivo) => cambiarImagen('bannerMovil', { ruta: imagenes.bannerMovil.ruta, archivo })} onQuitar={() => cambiarImagen('bannerMovil', { ruta: null, archivo: null })} />
          </Stack>
        </Tarjeta>
      </Stack>
      <Stack spacing={2} sx={{ minWidth: 0 }}>
        <Tarjeta titulo="Vista previa">
          <VistaPrevia campos={campos} logoUrl={urlLogo} bannerUrl={urlBanner} />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.25 }}>Se actualiza con tus cambios sin guardar.</Typography>
        </Tarjeta>
        <Tarjeta titulo="Publicación">
          <Stack spacing={1.5}>
            {hayCambios ? <Alert severity="warning" role="status">Hay cambios sin guardar.</Alert> : null}
            {errorGuardar ? <Alert severity="error" role="alert">{errorGuardar}</Alert> : null}
            {exito && !hayCambios ? <Alert severity="success" role="status">Cambios guardados: la tienda ya los muestra.</Alert> : null}
            <Stack direction="row" spacing={1} justifyContent="flex-end">
              <Button color="inherit" size="small" onClick={descartar} disabled={!hayCambios || guardando}>Descartar</Button>
              <Button variant="contained" size="small" onClick={() => void guardar()} disabled={!hayCambios || guardando}>
                {guardando ? 'Guardando…' : 'Guardar'}
              </Button>
            </Stack>
          </Stack>
        </Tarjeta>
      </Stack>
    </Box>
  )
}

type Carga = { fase: 'cargando' } | { fase: 'error' } | { fase: 'lista'; datos: IdentidadDeEmpresa }

// Carga la identidad de la empresa activa. Al cambiar de empresa vuelve a «cargando» y el formulario
// se monta de nuevo con `key`: nunca queda un valor de la empresa anterior (Principio VIII).
export default function PestanaIdentidad({ empresaId, empresaNombre }: PropsPestanaTienda) {
  const [carga, setCarga] = useState<Carga>({ fase: 'cargando' })
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    let cancelada = false
    setCarga({ fase: 'cargando' })
    leerIdentidadDeEmpresa(empresaId)
      .then((datos) => { if (!cancelada) setCarga({ fase: 'lista', datos }) })
      .catch((error) => {
        console.error('No se pudo cargar la identidad de la tienda', error instanceof Error ? error.message : error)
        if (!cancelada) setCarga({ fase: 'error' })
      })
    return () => { cancelada = true }
  }, [empresaId, intento])

  if (carga.fase === 'cargando') return <EstadoCargaPagina />
  if (carga.fase === 'error') {
    return <EstadoError titulo="No pudimos cargar la identidad visual." descripcion="Revisá tu conexión e intentá de nuevo." reintentar={() => setIntento((n) => n + 1)} />
  }
  return (
    <FormularioIdentidad
      key={empresaId}
      empresaId={empresaId}
      empresaNombre={empresaNombre}
      organizacionId={carga.datos.organizacionId}
      inicial={carga.datos.identidad}
    />
  )
}
