import { useEffect, useRef, useState } from 'react'
import {
  Alert, Box, Button, Card, CardContent, Chip, Collapse, Dialog, DialogActions, DialogContent, DialogContentText,
  DialogTitle, List, ListItem, ListItemText, Stack, Typography,
} from '@mui/material'
import { useBorradorTienda } from '../../../../../hooks/useBorradorTienda'
import {
  ETIQUETA_AREA, descartarBorrador, formatearFechaVersion, publicarTienda, textoAvisoCambios, type BorradorTienda,
} from '../../../../../lib/tiendaBorrador'
import { EstadoCargaPagina, EstadoError } from '../../../../../components/estados/EstadosPagina'
import type { PropsPestanaTienda } from '../../pestanas'

// F-TDA-06 (US2, FR-053…FR-057, FR-065, FR-066): sección «Publicación» de «Dominio y publicación». Muestra el estado
// de la tienda y los cambios sin publicar, y publica o descarta el borrador con confirmación. Va después de «Dominio».
export const orden = 20

// Aviso a las demás secciones de la pestaña (la vista previa) de que lo publicado o el borrador cambió.
export const EVENTO_PUBLICACION = 'tienda-publicacion-cambio'

type Dialogo = 'publicar' | 'descartar' | null
type Aviso = { severidad: 'success' | 'info' | 'error'; texto: string }

function Cambios({ cambios }: { cambios: BorradorTienda['cambios'] }) {
  return (
    <List dense disablePadding aria-label="Cambios sin publicar por área">
      {cambios.detalle.map((area) => (
        <ListItem key={area.area} disableGutters>
          <ListItemText primary={ETIQUETA_AREA[area.area]} secondary={area.campos.join(', ')} />
        </ListItem>
      ))}
    </List>
  )
}

function SeccionPublicacion({ empresaId, empresaNombre, alAbrirDialogo, avisoInicial }: PropsPestanaTienda & {
  alAbrirDialogo: (abierto: boolean) => void
  avisoInicial: Aviso | null
}) {
  const { borrador, isLoading, isError, refetch } = useBorradorTienda(empresaId)
  const [dialogo, setDialogo] = useState<Dialogo>(null)
  const [verCambios, setVerCambios] = useState(false)
  const [procesando, setProcesando] = useState(false)
  const [errorDialogo, setErrorDialogo] = useState<string | null>(null)
  const [aviso, setAviso] = useState<Aviso | null>(avisoInicial)
  const enCurso = useRef(false)

  useEffect(() => {
    alAbrirDialogo(dialogo !== null)
  }, [dialogo, alAbrirDialogo])

  // Restaurar una versión (sección Versiones) deja un borrador nuevo: se relee el aviso de cambios (F-TDA-07, FR-072).
  useEffect(() => {
    const alRestaurar = (evento: Event) => {
      if ((evento as CustomEvent<{ origen?: string }>).detail?.origen === 'versiones') void refetch()
    }
    window.addEventListener(EVENTO_PUBLICACION, alRestaurar)
    return () => window.removeEventListener(EVENTO_PUBLICACION, alRestaurar)
  }, [refetch])

  const cerrar = () => {
    if (procesando) return
    setDialogo(null)
    setErrorDialogo(null)
  }

  const confirmar = async (accion: 'publicar' | 'descartar') => {
    if (enCurso.current) return
    enCurso.current = true
    setProcesando(true)
    setErrorDialogo(null)
    try {
      if (accion === 'publicar') await publicarTienda(empresaId)
      else await descartarBorrador(empresaId)
      setDialogo(null)
      setVerCambios(false)
      setAviso({ severidad: 'success', texto: accion === 'publicar' ? 'Store publicada' : 'Cambios descartados' })
      window.dispatchEvent(new CustomEvent(EVENTO_PUBLICACION, { detail: { empresaId } }))
      // Se relee el estado completo: la versión vigente y el aviso de cambios salen de la base.
      await refetch()
    } catch (error) {
      console.error('No se pudo completar la publicación de la tienda', error instanceof Error ? error.message : error)
      setErrorDialogo(accion === 'publicar'
        ? 'No pudimos publicar los cambios. Revisá tu conexión e intentá de nuevo: no se publicó nada.'
        : 'No pudimos descartar los cambios. Intentá de nuevo.')
    }
    enCurso.current = false
    setProcesando(false)
  }

  const hayBorrador = borrador?.hayBorrador ?? false
  const version = borrador?.versionVigente ?? null

  return (
    <Card component="section" aria-labelledby="titulo-publicacion">
      <CardContent>
        <Box sx={{ mb: 2 }}>
          <Typography id="titulo-publicacion" variant="h6" component="h2">Publicación</Typography>
          <Typography variant="body2" color="text.secondary">Qué ve hoy el público de la tienda de {empresaNombre} y qué falta publicar.</Typography>
        </Box>

        {isLoading && !borrador ? <EstadoCargaPagina /> : null}
        {isError ? <EstadoError descripcion="No pudimos cargar el estado de la publicación." reintentar={() => void refetch()} /> : null}

        {borrador ? (
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
              <Typography>{borrador.enLinea ? 'Estado: publicada' : 'Estado: fuera de línea'}</Typography>
              <Chip size="small" color={borrador.enLinea ? 'success' : 'warning'} label={borrador.enLinea ? 'En línea' : 'Fuera de línea'} />
            </Stack>
            {!borrador.enLinea ? (
              <Typography variant="body2" color="text.secondary">
                La empresa está desactivada: podés preparar y publicar cambios, pero los visitantes siguen viendo «Volvemos pronto».
              </Typography>
            ) : null}
            <Typography variant="body2" color="text.secondary">
              {version
                ? `Versión ${version.numero} · publicada el ${formatearFechaVersion(version.publicadaAt)}${version.publicadaPor ? ` por ${version.publicadaPor}` : ''}`
                : 'Todavía no hay versiones publicadas.'}
            </Typography>

            {hayBorrador ? (
              <Alert
                severity="info"
                role="status"
                action={
                  <Button color="inherit" size="small" aria-expanded={verCambios} aria-controls="detalle-cambios" onClick={() => setVerCambios((v) => !v)}>
                    Ver cambios
                  </Button>
                }
              >
                {textoAvisoCambios(borrador.cambios)}
              </Alert>
            ) : null}
            <Collapse in={hayBorrador && verCambios} unmountOnExit>
              <Box id="detalle-cambios">
                <Cambios cambios={borrador.cambios} />
              </Box>
            </Collapse>

            {aviso ? <Alert severity={aviso.severidad} role="status" onClose={() => setAviso(null)}>{aviso.texto}</Alert> : null}

            <Card variant="outlined" component="section" aria-label="Publicar cambios">
              <CardContent>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
                  <Typography>{hayBorrador ? 'Hay cambios sin publicar.' : 'No hay cambios sin publicar.'}</Typography>
                  <Stack direction="row" spacing={1}>
                    <Button color="inherit" disabled={!hayBorrador} onClick={() => setDialogo('descartar')}>Descartar</Button>
                    <Button variant="contained" disabled={!hayBorrador} onClick={() => setDialogo('publicar')}>Guardar y publicar</Button>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          </Stack>
        ) : null}
      </CardContent>

      <Dialog open={dialogo === 'publicar'} onClose={cerrar} aria-labelledby="titulo-dialogo-publicar" fullWidth maxWidth="xs">
        <DialogTitle id="titulo-dialogo-publicar">Publicar cambios</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Los cambios se ven de inmediato en {borrador?.dominio ?? 'la tienda'}. Podés volver a la versión anterior desde Dominio y publicación.
          </DialogContentText>
          {errorDialogo ? <Alert severity="error" role="alert" sx={{ mt: 2 }}>{errorDialogo}</Alert> : null}
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={cerrar} disabled={procesando}>Cancelar</Button>
          <Button variant="contained" onClick={() => void confirmar('publicar')} disabled={procesando}>
            {procesando ? 'Publicando…' : 'Publicar'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogo === 'descartar'} onClose={cerrar} aria-labelledby="titulo-dialogo-descartar" fullWidth maxWidth="xs">
        <DialogTitle id="titulo-dialogo-descartar">Descartar cambios</DialogTitle>
        <DialogContent>
          <DialogContentText>Se pierden los cambios sin publicar de esta store.</DialogContentText>
          {errorDialogo ? <Alert severity="error" role="alert" sx={{ mt: 2 }}>{errorDialogo}</Alert> : null}
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={cerrar} disabled={procesando}>Cancelar</Button>
          <Button color="error" variant="contained" onClick={() => void confirmar('descartar')} disabled={procesando}>
            {procesando ? 'Descartando…' : 'Descartar'}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  )
}

// Con otra empresa activa la sección se monta de cero (key): no queda ningún dato ni diálogo de la anterior. Si había
// un diálogo abierto, se cierra con aviso y no se aplica nada (Principio VIII, FR-065).
export default function Publicacion(props: PropsPestanaTienda) {
  const [dialogoAbierto, setDialogoAbierto] = useState(false)
  const [empresaVista, setEmpresaVista] = useState(props.empresaId)
  const [aviso, setAviso] = useState<Aviso | null>(null)

  if (empresaVista !== props.empresaId) {
    setEmpresaVista(props.empresaId)
    setAviso(dialogoAbierto ? { severidad: 'info', texto: 'Se cerró el diálogo porque cambió la empresa activa. No se aplicó nada.' } : null)
    setDialogoAbierto(false)
  }

  return <SeccionPublicacion key={props.empresaId} {...props} alAbrirDialogo={setDialogoAbierto} avisoInicial={aviso} />
}
