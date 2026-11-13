import { useEffect, useRef, useState } from 'react'
import {
  Alert, Box, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Table,
  TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material'
import { useBorradorTienda } from '../../../../../hooks/useBorradorTienda'
import { useVersionesTienda } from '../../../../../hooks/useVersionesTienda'
import { formatearFechaVersion, restaurarVersion, type VersionTienda } from '../../../../../lib/tiendaBorrador'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../../../../components/estados/EstadosPagina'
import type { PropsPestanaTienda } from '../../pestanas'
import { EVENTO_PUBLICACION } from './Publicacion'
import { SOLO_LECTORES } from '../../../../../components/base/solo-lectores'

// F-TDA-07 (US3, FR-071…FR-077): sección «Versiones» de «Dominio y publicación». Lista las publicaciones y permite
// cargar una anterior como borrador (no publica). Va después de «Publicación» y antes de la vista previa.
export const orden = 25


type Aviso = { severidad: 'success' | 'info' | 'error'; texto: string }

function SeccionVersiones({ empresaId, alAbrirDialogo, avisoInicial }: PropsPestanaTienda & {
  alAbrirDialogo: (abierto: boolean) => void
  avisoInicial: Aviso | null
}) {
  const { versiones, isLoading, isError, refetch } = useVersionesTienda(empresaId)
  const { borrador, refetch: releerBorrador } = useBorradorTienda(empresaId)
  const [elegida, setElegida] = useState<VersionTienda | null>(null)
  const [procesando, setProcesando] = useState(false)
  const [errorDialogo, setErrorDialogo] = useState<string | null>(null)
  const [aviso, setAviso] = useState<Aviso | null>(avisoInicial)
  const enCurso = useRef(false)

  useEffect(() => {
    alAbrirDialogo(elegida !== null)
  }, [elegida, alAbrirDialogo])

  // Publicar o descartar (sección Publicación) cambia las versiones y si hay borrador.
  useEffect(() => {
    const alCambiar = (evento: Event) => {
      const origen = (evento as CustomEvent<{ origen?: string }>).detail?.origen
      if (origen === 'versiones') return
      void refetch()
      void releerBorrador()
    }
    window.addEventListener(EVENTO_PUBLICACION, alCambiar)
    return () => window.removeEventListener(EVENTO_PUBLICACION, alCambiar)
  }, [refetch, releerBorrador])

  const cerrar = () => {
    if (procesando) return
    setElegida(null)
    setErrorDialogo(null)
  }

  const confirmar = async () => {
    if (!elegida || enCurso.current) return
    enCurso.current = true
    setProcesando(true)
    setErrorDialogo(null)
    try {
      await restaurarVersion(empresaId, elegida.numero)
      setElegida(null)
      setAviso({ severidad: 'success', texto: 'Versión restaurada como borrador' })
      // La sección Publicación y la vista previa releen el aviso de cambios y el borrador.
      window.dispatchEvent(new CustomEvent(EVENTO_PUBLICACION, { detail: { empresaId, origen: 'versiones' } }))
      await releerBorrador()
    } catch (error) {
      console.error('No se pudo restaurar la versión de la tienda', error instanceof Error ? error.message : error)
      setErrorDialogo('No pudimos restaurar la versión. Intentá de nuevo: el borrador quedó como estaba.')
    }
    enCurso.current = false
    setProcesando(false)
  }

  return (
    <Card component="section" aria-labelledby="titulo-versiones">
      <CardContent>
        <Box sx={{ mb: 2 }}>
          <Typography id="titulo-versiones" variant="h6" component="h2">Versiones</Typography>
          <Typography variant="body2" color="text.secondary">Las últimas publicaciones de la tienda. Restaurar carga la versión como borrador.</Typography>
        </Box>

        {aviso ? <Alert severity={aviso.severidad} role="status" sx={{ mb: 2 }} onClose={() => setAviso(null)}>{aviso.texto}</Alert> : null}

        {isLoading && !versiones ? <EstadoCargaPagina /> : null}
        {isError ? <EstadoError descripcion="No pudimos cargar las versiones." reintentar={() => void refetch()} /> : null}
        {versiones && versiones.length === 0 ? (
          <EstadoVacio titulo="Todavía no hay versiones" descripcion="Cuando publiques cambios, cada versión aparece acá." />
        ) : null}

        {versiones && versiones.length > 0 ? (
          <TableContainer tabIndex={0} role="region" aria-label="Versiones publicadas (se desplaza)" sx={{ overflowX: 'auto' }}>
            <Table size="small" aria-label="Versiones publicadas">
              <TableHead>
                <TableRow>
                  <TableCell>Versión</TableCell>
                  <TableCell>Fecha</TableCell>
                  <TableCell>Por</TableCell>
                  <TableCell>Cambios</TableCell>
                  <TableCell><Box component="span" sx={SOLO_LECTORES}>Acciones</Box></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {versiones.map((v) => (
                  <TableRow key={v.numero}>
                    <TableCell component="th" scope="row">{v.numero}</TableCell>
                    <TableCell>{formatearFechaVersion(v.publicadaAt)}</TableCell>
                    <TableCell>{v.publicadaPor ?? '—'}</TableCell>
                    <TableCell>{v.resumen}</TableCell>
                    <TableCell align="right">
                      {v.vigente ? null : (
                        <Button size="small" aria-label={`Restaurar versión ${v.numero}`} onClick={() => setElegida(v)}>Restaurar</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        ) : null}
      </CardContent>

      <Dialog open={elegida !== null} onClose={cerrar} aria-labelledby="titulo-dialogo-restaurar" fullWidth maxWidth="xs">
        <DialogTitle id="titulo-dialogo-restaurar">Restaurar versión</DialogTitle>
        <DialogContent>
          <DialogContentText>La versión elegida se carga como borrador. No se publica hasta que la confirmes.</DialogContentText>
          {borrador?.hayBorrador ? (
            <DialogContentText sx={{ mt: 1 }}>Los cambios sin publicar que hay ahora se reemplazan.</DialogContentText>
          ) : null}
          {errorDialogo ? <Alert severity="error" role="alert" sx={{ mt: 2 }}>{errorDialogo}</Alert> : null}
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={cerrar} disabled={procesando}>Cancelar</Button>
          <Button variant="contained" onClick={() => void confirmar()} disabled={procesando}>
            {procesando ? 'Restaurando…' : 'Restaurar'}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  )
}

// Con otra empresa activa la sección se monta de cero (key): ninguna versión ni diálogo de la anterior. Si había un
// diálogo abierto, se cierra con aviso y no se restaura nada (Principio VIII, FR-076).
export default function Versiones(props: PropsPestanaTienda) {
  const [dialogoAbierto, setDialogoAbierto] = useState(false)
  const [empresaVista, setEmpresaVista] = useState(props.empresaId)
  const [aviso, setAviso] = useState<Aviso | null>(null)

  if (empresaVista !== props.empresaId) {
    setEmpresaVista(props.empresaId)
    setAviso(dialogoAbierto ? { severidad: 'info', texto: 'Se cerró el diálogo porque cambió la empresa activa. No se restauró nada.' } : null)
    setDialogoAbierto(false)
  }

  return <SeccionVersiones key={props.empresaId} {...props} alAbrirDialogo={setDialogoAbierto} avisoInicial={aviso} />
}
