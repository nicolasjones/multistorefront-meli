import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, CardHeader, CircularProgress, Stack, Typography } from '@mui/material'
import AddPhotoAlternateOutlinedIcon from '@mui/icons-material/AddPhotoAlternateOutlined'
import {
  ACEPTA_ADJUNTOS,
  MAX_ADJUNTOS,
  listarAdjuntos,
  mensajeDeErrorAdjunto,
  quitarAdjunto,
  subirAdjunto,
  urlsAdjuntos,
  validarArchivoAdjunto,
  type Adjunto,
} from '../../lib/reparacionAdjuntos'
import { VisorAdjuntoDialog } from './VisorAdjuntoDialog'

type Props = {
  reparacionId: string
  organizacionId: string | null
  // Agregar y quitar solo con `edicion` y la reparación no anulada (FR-007, FR-008).
  puedeEditar: boolean
  anulada: boolean
}

type Progreso = { nombre: string; estado: 'subiendo' | 'listo' | 'error'; mensaje?: string }

// Sección «Fotos y adjuntos» del detalle de la reparación (F-SVC-20).
export function AdjuntosReparacion({ reparacionId, organizacionId, puedeEditar, anulada }: Props) {
  const [adjuntos, setAdjuntos] = useState<Adjunto[] | null>(null)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [progreso, setProgreso] = useState<Progreso[]>([])
  const [subiendo, setSubiendo] = useState(false)
  const [abierto, setAbierto] = useState<Adjunto | null>(null)
  const [quitando, setQuitando] = useState(false)
  const [errorQuitar, setErrorQuitar] = useState<string | null>(null)
  const entrada = useRef<HTMLInputElement>(null)
  const vigente = useRef(true)

  useEffect(() => {
    vigente.current = true
    return () => {
      vigente.current = false
    }
  }, [])

  const cargar = useCallback(async () => {
    try {
      const lista = await listarAdjuntos(reparacionId)
      const firmadas = await urlsAdjuntos(lista.map((a) => a.ruta))
      if (!vigente.current) return
      setAdjuntos(lista)
      setUrls(firmadas)
      setErrorCarga(null)
    } catch (error) {
      if (vigente.current) setErrorCarga(mensajeDeErrorAdjunto(error, 'No pudimos cargar las fotos.'))
    }
  }, [reparacionId])

  useEffect(() => {
    setAdjuntos(null)
    setErrorCarga(null)
    void cargar()
  }, [cargar])

  const cantidad = adjuntos?.length ?? 0
  const lleno = cantidad >= MAX_ADJUNTOS
  const puedeAgregar = puedeEditar && !anulada && organizacionId !== null && adjuntos !== null

  async function elegirArchivos(archivos: File[]) {
    if (!organizacionId || archivos.length === 0) return
    setSubiendo(true)
    const resultados: Progreso[] = []
    const publicar = () => setProgreso([...resultados])
    let lugar = MAX_ADJUNTOS - cantidad
    for (const archivo of archivos) {
      const validacion = await validarArchivoAdjunto(archivo)
      if (!validacion.ok) {
        resultados.push({ nombre: archivo.name, estado: 'error', mensaje: validacion.mensaje })
        continue
      }
      if (lugar <= 0) {
        resultados.push({
          nombre: archivo.name,
          estado: 'error',
          mensaje: `«${archivo.name}»: la reparación ya tiene el máximo de ${MAX_ADJUNTOS} fotos y adjuntos.`,
        })
        continue
      }
      const indice = resultados.push({ nombre: archivo.name, estado: 'subiendo' }) - 1
      publicar()
      try {
        await subirAdjunto(organizacionId, reparacionId, archivo, validacion.mime)
        lugar -= 1
        resultados[indice] = { nombre: archivo.name, estado: 'listo' }
      } catch (error) {
        resultados[indice] = {
          nombre: archivo.name,
          estado: 'error',
          mensaje: `«${archivo.name}»: ${mensajeDeErrorAdjunto(error, 'no se pudo subir.')}`,
        }
      }
    }
    if (!vigente.current) return
    publicar()
    setSubiendo(false)
    if (entrada.current) entrada.current.value = ''
    await cargar()
  }

  async function quitar(adjunto: Adjunto) {
    setQuitando(true)
    setErrorQuitar(null)
    try {
      await quitarAdjunto(adjunto.id)
      if (!vigente.current) return
      setAbierto(null)
      await cargar()
    } catch (error) {
      if (vigente.current) setErrorQuitar(mensajeDeErrorAdjunto(error, 'No pudimos quitar la foto.'))
    } finally {
      if (vigente.current) setQuitando(false)
    }
  }

  const errores = progreso.filter((p) => p.estado === 'error')

  return (
    <Card component="section" aria-labelledby="adjuntos-titulo">
      <CardHeader
        title={<Typography id="adjuntos-titulo" component="h2" variant="t2">Fotos y adjuntos</Typography>}
        action={
          puedeAgregar ? (
            <>
              <input
                ref={entrada}
                hidden
                type="file"
                multiple
                accept={ACEPTA_ADJUNTOS}
                data-testid="entrada-adjuntos"
                aria-label="Elegir fotos"
                onChange={(evento) => void elegirArchivos(Array.from(evento.target.files ?? []))}
              />
              <Button
                variant="outlined"
                startIcon={<AddPhotoAlternateOutlinedIcon />}
                disabled={subiendo || lleno}
                onClick={() => entrada.current?.click()}
              >
                Agregar fotos
              </Button>
            </>
          ) : null
        }
      />
      <CardContent>
        <Stack spacing={2}>
          {anulada ? <Alert severity="info">La reparación está anulada: las fotos son de solo lectura.</Alert> : null}
          {puedeAgregar && lleno ? (
            <Alert severity="info">{`Llegaste al máximo de ${MAX_ADJUNTOS} fotos y adjuntos: quitá alguna para agregar otras.`}</Alert>
          ) : null}
          {progreso.some((p) => p.estado === 'subiendo') ? (
            <Stack component="ul" spacing={0.5} sx={{ listStyle: 'none', m: 0, p: 0 }} aria-label="Progreso de la carga" aria-live="polite">
              {progreso.map((p, i) => (
                <Typography component="li" variant="body2" key={`${p.nombre}-${i}`}>
                  {p.estado === 'subiendo' ? `Subiendo «${p.nombre}»…` : p.estado === 'listo' ? `«${p.nombre}» subida` : ''}
                </Typography>
              ))}
            </Stack>
          ) : null}
          {errores.length > 0 ? (
            <Alert severity="error" role="alert">
              <Stack component="ul" sx={{ m: 0, pl: 2 }}>
                {errores.map((p, i) => <li key={`${p.nombre}-${i}`}>{p.mensaje}</li>)}
              </Stack>
            </Alert>
          ) : null}

          {errorCarga ? (
            <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void cargar()}>Reintentar</Button>}>
              {errorCarga}
            </Alert>
          ) : adjuntos === null ? (
            <Stack direction="row" spacing={1} alignItems="center" role="status">
              <CircularProgress size={18} />
              <Typography variant="body2">Cargando fotos…</Typography>
            </Stack>
          ) : adjuntos.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {puedeAgregar
                ? 'Esta reparación todavía no tiene fotos. Agregá fotos del equipo para dejar constancia de su estado.'
                : 'Esta reparación no tiene fotos.'}
            </Typography>
          ) : (
            <Box
              component="ul"
              aria-label="Fotos del equipo"
              sx={{
                listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 1.5,
                gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(4, 1fr)', lg: 'repeat(6, 1fr)' },
              }}
            >
              {adjuntos.map((adjunto) => (
                <Box component="li" key={adjunto.id}>
                  <Box
                    component="button"
                    type="button"
                    onClick={() => {
                      setErrorQuitar(null)
                      setAbierto(adjunto)
                    }}
                    aria-label={`Ver ${adjunto.nombre_original}`}
                    sx={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%', borderRadius: 1, overflow: 'hidden', '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 } }}
                  >
                    {urls[adjunto.ruta] ? (
                      <Box
                        component="img"
                        src={urls[adjunto.ruta]}
                        alt={adjunto.nombre_original}
                        loading="lazy"
                        sx={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', display: 'block', bgcolor: 'action.hover' }}
                      />
                    ) : (
                      <Box sx={{ width: '100%', aspectRatio: '1 / 1', display: 'grid', placeItems: 'center', bgcolor: 'action.hover' }}>
                        <Typography variant="caption" color="text.secondary">Sin vista previa</Typography>
                      </Box>
                    )}
                  </Box>
                </Box>
              ))}
            </Box>
          )}
        </Stack>
      </CardContent>
      <VisorAdjuntoDialog
        adjunto={abierto}
        url={abierto ? urls[abierto.ruta] : undefined}
        puedeQuitar={puedeAgregar}
        quitando={quitando}
        error={errorQuitar}
        onCerrar={() => setAbierto(null)}
        onQuitar={(adjunto) => void quitar(adjunto)}
      />
    </Card>
  )
}
