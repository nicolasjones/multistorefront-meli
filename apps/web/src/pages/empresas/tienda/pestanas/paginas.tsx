import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, FormControlLabel,
  IconButton, Stack, Switch, TextField, Tooltip, Typography,
} from '@mui/material'
import EditOutlined from '@mui/icons-material/EditOutlined'
import DeleteOutline from '@mui/icons-material/DeleteOutline'
import { useWarnAboutChange } from '@refinedev/core'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../../../components/estados/EstadosPagina'
import { CargaInfinita } from '../../../../components/pagina/CargaInfinita'
import {
  ErrorGuardadoPagina,
  LIMITE_CONTENIDO_PAGINA,
  LIMITE_TITULO_PAGINA,
  eliminarPagina,
  guardarPagina,
  largoPagina,
  listarPaginas,
  validarPagina,
  type ErroresPagina,
  type PaginaTienda,
} from '../../../../lib/tiendaPaginas'
import type { PropsPestanaTienda } from '../pestanas'

type Valores = { titulo: string; contenido: string; visible: boolean }

const VALORES_NUEVA: Valores = { titulo: '', contenido: '', visible: false }

// Diálogo crear/editar (FR-005). Se monta solo mientras está abierto: cada apertura parte de cero.
function DialogoPagina({
  empresaId, pagina, alCerrar, alGuardar,
}: {
  empresaId: string
  pagina: PaginaTienda | null
  alCerrar: () => void
  alGuardar: (guardada: PaginaTienda) => void
}) {
  const { setWarnWhen } = useWarnAboutChange()
  const inicial = useMemo<Valores>(
    () => (pagina ? { titulo: pagina.titulo, contenido: pagina.contenido, visible: pagina.visible } : VALORES_NUEVA),
    [pagina],
  )
  const [valores, setValores] = useState<Valores>(inicial)
  const [errores, setErrores] = useState<ErroresPagina>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  const hayCambios = valores.titulo !== inicial.titulo || valores.contenido !== inicial.contenido || valores.visible !== inicial.visible
  useEffect(() => {
    setWarnWhen(hayCambios)
    return () => setWarnWhen(false)
  }, [hayCambios, setWarnWhen])

  const guardar = async () => {
    const encontrados = validarPagina(valores)
    if (Object.keys(encontrados).length > 0) {
      setErrores(encontrados)
      setErrorGeneral(null)
      return
    }
    setGuardando(true)
    setErrores({})
    setErrorGeneral(null)
    try {
      alGuardar(await guardarPagina(empresaId, pagina?.id ?? null, valores))
    } catch (error) {
      console.error('No se pudo guardar la página de la tienda', error instanceof Error ? error.message : error)
      if (error instanceof ErrorGuardadoPagina && error.campo) setErrores({ [error.campo]: error.message })
      else setErrorGeneral('No pudimos guardar la página. Intentá de nuevo.')
      setGuardando(false)
    }
  }

  return (
    <Dialog open onClose={guardando ? undefined : alCerrar} fullWidth maxWidth="sm" aria-labelledby="dialogo-pagina-titulo">
      <DialogTitle id="dialogo-pagina-titulo">{pagina ? 'Editar página' : 'Nueva página'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Título"
            value={valores.titulo}
            onChange={(e) => { setValores({ ...valores, titulo: e.target.value }); setErrores({ ...errores, titulo: undefined }) }}
            error={Boolean(errores.titulo)}
            helperText={errores.titulo ?? `${largoPagina(valores.titulo)}/${LIMITE_TITULO_PAGINA}`}
            fullWidth
            size="small"
            autoFocus
            disabled={guardando}
          />
          <TextField
            label="Contenido"
            value={valores.contenido}
            onChange={(e) => { setValores({ ...valores, contenido: e.target.value }); setErrores({ ...errores, contenido: undefined }) }}
            error={Boolean(errores.contenido)}
            helperText={errores.contenido ?? `${largoPagina(valores.contenido)}/${LIMITE_CONTENIDO_PAGINA}. Texto simple: una línea en blanco separa párrafos. No se interpreta HTML.`}
            multiline
            minRows={6}
            fullWidth
            size="small"
            disabled={guardando}
          />
          <FormControlLabel
            control={<Switch checked={valores.visible} onChange={(e) => setValores({ ...valores, visible: e.target.checked })} disabled={guardando} />}
            label="Visible en la tienda"
          />
          {errorGeneral ? <Alert severity="error" role="alert">{errorGeneral}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={alCerrar} disabled={guardando}>Cancelar</Button>
        <Button variant="contained" onClick={() => void guardar()} disabled={guardando}>Guardar</Button>
      </DialogActions>
    </Dialog>
  )
}

function DialogoEliminar({
  empresaId, pagina, alCerrar, alEliminar,
}: {
  empresaId: string
  pagina: PaginaTienda
  alCerrar: () => void
  alEliminar: () => void
}) {
  const [eliminando, setEliminando] = useState(false)
  const [error, setError] = useState(false)

  const confirmar = async () => {
    setEliminando(true)
    setError(false)
    try {
      await eliminarPagina(empresaId, pagina.id)
      alEliminar()
    } catch (e) {
      console.error('No se pudo eliminar la página de la tienda', e instanceof Error ? e.message : e)
      setError(true)
      setEliminando(false)
    }
  }

  return (
    <Dialog open onClose={eliminando ? undefined : alCerrar} aria-labelledby="dialogo-eliminar-titulo">
      <DialogTitle id="dialogo-eliminar-titulo">Eliminar página</DialogTitle>
      <DialogContent>
        <DialogContentText>
          ¿Eliminás la página «{pagina.titulo}»? Deja de verse en la tienda y no se puede recuperar.
        </DialogContentText>
        {error ? <Alert severity="error" role="alert" sx={{ mt: 2 }}>No pudimos eliminar la página. Intentá de nuevo.</Alert> : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={alCerrar} disabled={eliminando}>Cancelar</Button>
        <Button color="error" variant="contained" onClick={() => void confirmar()} disabled={eliminando}>Eliminar</Button>
      </DialogActions>
    </Dialog>
  )
}

type Carga = {
  fase: 'cargando' | 'lista' | 'error'
  filas: PaginaTienda[]
  total: number
  cargandoMas: boolean
  falloMas: boolean
}

const CARGA_INICIAL: Carga = { fase: 'cargando', filas: [], total: 0, cargandoMas: false, falloMas: false }

function Paginas({ empresaId, empresaNombre }: PropsPestanaTienda) {
  const [carga, setCarga] = useState<Carga>(CARGA_INICIAL)
  const [intento, setIntento] = useState(0)
  const [dialogo, setDialogo] = useState<{ tipo: 'editar'; pagina: PaginaTienda | null } | { tipo: 'eliminar'; pagina: PaginaTienda } | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  // Primera tanda (y recarga tras guardar/eliminar): reinicia la lista desde el principio.
  useEffect(() => {
    let cancelada = false
    listarPaginas(empresaId, 0)
      .then(({ filas, total }) => { if (!cancelada) setCarga({ fase: 'lista', filas, total, cargandoMas: false, falloMas: false }) })
      .catch((error) => {
        console.error('No se pudieron cargar las páginas de la tienda', error instanceof Error ? error.message : error)
        if (!cancelada) setCarga({ ...CARGA_INICIAL, fase: 'error' })
      })
    return () => { cancelada = true }
  }, [empresaId, intento])

  const recargar = useCallback(() => {
    setCarga(CARGA_INICIAL)
    setIntento((n) => n + 1)
  }, [])

  const cargarMas = useCallback(() => {
    if (carga.cargandoMas) return
    setCarga((actual) => ({ ...actual, cargandoMas: true, falloMas: false }))
    listarPaginas(empresaId, carga.filas.length)
      .then(({ filas, total }) => setCarga((actual) => ({ ...actual, filas: [...actual.filas, ...filas], total, cargandoMas: false })))
      .catch((error) => {
        console.error('No se pudieron cargar más páginas', error instanceof Error ? error.message : error)
        setCarga((actual) => ({ ...actual, cargandoMas: false, falloMas: true }))
      })
  }, [carga.cargandoMas, carga.filas.length, empresaId])

  if (carga.fase === 'cargando') return <EstadoCargaPagina />
  if (carga.fase === 'error') {
    return <EstadoError descripcion="No pudimos cargar las páginas de la tienda." reintentar={recargar} />
  }

  const nueva = (
    <Button variant="contained" onClick={() => { setAviso(null); setDialogo({ tipo: 'editar', pagina: null }) }}>Nueva página</Button>
  )

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Páginas de texto de la tienda de {empresaNombre} (por ejemplo «Cómo comprar» o «Envíos»). Las visibles aparecen en el pie de la tienda.
      </Typography>
      {aviso ? <Alert severity="success" role="status" sx={{ mb: 2 }} onClose={() => setAviso(null)}>{aviso}</Alert> : null}
      {carga.total === 0 ? (
        <EstadoVacio titulo="Todavía no hay páginas." descripcion="Creá la primera: queda oculta hasta que la actives." accion={nueva} />
      ) : (
        <>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
            <Typography component="p" variant="body2" role="status" data-testid="paginas-total">
              {carga.total === 1 ? '1 página' : `${carga.total} páginas`}
            </Typography>
            {nueva}
          </Stack>
          <Box component="ul" aria-label="Páginas de la tienda" sx={{ listStyle: 'none', m: 0, p: 0, border: 1, borderColor: 'divider', borderRadius: (tema) => tema.shape.borderRadius }}>
            {carga.filas.map((fila) => (
              <Stack
                component="li"
                key={fila.id}
                direction="row"
                alignItems="center"
                spacing={1}
                sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider', '&:last-of-type': { borderBottom: 0 } }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>{fila.titulo}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>/pagina/{fila.slug}</Typography>
                </Box>
                <Chip size="small" label={fila.visible ? 'Visible' : 'Oculta'} color={fila.visible ? 'success' : 'default'} />
                <Tooltip title="Editar">
                  <IconButton aria-label={`Editar ${fila.titulo}`} onClick={() => { setAviso(null); setDialogo({ tipo: 'editar', pagina: fila }) }}>
                    <EditOutlined />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Eliminar">
                  <IconButton aria-label={`Eliminar ${fila.titulo}`} onClick={() => { setAviso(null); setDialogo({ tipo: 'eliminar', pagina: fila }) }}>
                    <DeleteOutline />
                  </IconButton>
                </Tooltip>
              </Stack>
            ))}
          </Box>
          <CargaInfinita
            hayMas={carga.filas.length < carga.total}
            cargando={carga.cargandoMas}
            hayError={carga.falloMas}
            onCargarMas={cargarMas}
          />
        </>
      )}
      {dialogo?.tipo === 'editar' ? (
        <DialogoPagina
          empresaId={empresaId}
          pagina={dialogo.pagina}
          alCerrar={() => setDialogo(null)}
          alGuardar={(guardada) => {
            setAviso(dialogo.pagina ? `Guardamos los cambios de «${guardada.titulo}».` : `Creamos la página «${guardada.titulo}». Queda oculta hasta que la actives.`)
            setDialogo(null)
            recargar()
          }}
        />
      ) : null}
      {dialogo?.tipo === 'eliminar' ? (
        <DialogoEliminar
          empresaId={empresaId}
          pagina={dialogo.pagina}
          alCerrar={() => setDialogo(null)}
          alEliminar={() => {
            setAviso(`Eliminamos la página «${dialogo.pagina.titulo}».`)
            setDialogo(null)
            recargar()
          }}
        />
      ) : null}
    </Box>
  )
}

// Pestaña «Páginas» (F-TDA-23, FR-004/FR-005). `key` por empresa: al cambiar la empresa activa se descarta
// todo (lista, diálogos abiertos, aviso) y se vuelve a leer (Principio VIII).
export default function PestanaPaginas(props: PropsPestanaTienda) {
  return <Paginas key={props.empresaId} {...props} />
}
